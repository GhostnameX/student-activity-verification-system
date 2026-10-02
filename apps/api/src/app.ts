import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { auth } from "./auth";
import { generateCertificatePDFForEmail } from "./certificate";
import {
  requests,
  requestAttachments,
  requestAttachmentRevisions,
  attachmentUploads,
  notifications,
  auditLogs,
  certificateCounters,
  requestCounters,
  students,
  staff,
} from "@ua/db/schema";
import { db } from "@ua/db/client";
import { eq, and, desc, sql, isNull, count, inArray } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { getSession } from "./auth/session";
import { sessionPlugin } from "./session-plugin";
import { hashPassword, verifyPassword } from "@ua/db/auth-helpers";
import { roster } from "./roster";
import { getSubmissionStats, listSubmissionStudents, type SubmissionState } from "./submission";

const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:5173";
const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "onboarding@resend.dev";

const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ATTACHMENT_SIGNED_URL_TTL_SECONDS = 10 * 60;

type AllowedUploadFileType = { mime: string; ext: string };

function detectAllowedUploadFileType(buffer: Buffer): AllowedUploadFileType | null {
  const startsWith = (...signature: number[]) =>
    buffer.length >= signature.length && signature.every((byte, index) => buffer[index] === byte);

  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return { mime: "image/png", ext: "png" };
  }
  if (startsWith(0xff, 0xd8, 0xff)) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  const gifSignature = buffer.subarray(0, 6).toString("ascii");
  if (gifSignature === "GIF87a" || gifSignature === "GIF89a") {
    return { mime: "image/gif", ext: "gif" };
  }
  if (startsWith(0x25, 0x50, 0x44, 0x46, 0x2d)) {
    return { mime: "application/pdf", ext: "pdf" };
  }
  return null;
}

const AVATAR_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;

class AttachmentOwnershipError extends Error {
  constructor(readonly slot: number) {
    super("attachment_ownership_invalid");
  }
}

class ResubmitStateChangedError extends Error {}

// Mock storage is test/development only. Production with GATE_SMOKE_MOCK_STORAGE=1
// by mistake must still fail closed (never skip real upload).
const allowMockStorage =
  process.env.GATE_SMOKE_MOCK_STORAGE === "1" &&
  (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development");

function avatarPublicUrl(storagePath: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/avatars/${storagePath}`;
}

const THAI_TZ = "Asia/Bangkok";

export function thaiDateParts(d: Date = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: THAI_TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function thaiBuddhistYear(d: Date = new Date()): number {
  return thaiDateParts(d).year + 543;
}

function requestNumberLabel(sequence: number | null, year: number | null): string | null {
  if (sequence === null || sequence === undefined || year === null || year === undefined) return null;
  return `${String(sequence).padStart(3, "0")}/${year}`;
}

async function sendStatusEmail(opts: {
  to: string;
  studentName: string;
  status: "approved" | "rejected";
  reason?: string | null;
  attachments?: Array<{ filename: string; content: string }>;
}) {
  if (!RESEND_API_KEY) {
    console.log(`[email] skipped (no RESEND_API_KEY) -> ${opts.to} (${opts.status})`);
    return { skipped: true };
  }
  const th = opts.status === "approved"
    ? "คำร้องของคุณได้รับการอนุมัติ"
    : "คำร้องของคุณถูกไม่อนุมัติ";
  const body = opts.status === "approved"
    ? `สวัสดี คุณ${opts.studentName} คำร้องของคุณได้รับการอนุมัติแล้ว\nกรุณาตรวจสอบใบรับรองที่แนบมาด้วย`
    : `สวัสดี คุณ${opts.studentName} คำร้องของคุณถูกไม่อนุมัติ${opts.reason ? `\nเหตุผล: ${opts.reason}` : ""}`;
  try {
    const payload: Record<string, unknown> = {
      from: EMAIL_FROM,
      to: [opts.to],
      subject: `${th} — ระบบพิจารณาคำร้องขอฝึกประสบการณ์วิชาชีพ`,
      text: body,
    };
    if (opts.attachments && opts.attachments.length > 0) {
      payload.attachments = opts.attachments;
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.log(`[email] send failed: ${res.status} ${await res.text()}`);
      return { error: res.status };
    }
    return { ok: true };
  } catch (e) {
    console.log(`[email] exception: ${e}`);
    return { error: "exception" };
  }
}

async function writeAuditLog(opts: {
  actorStaffId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(auditLogs).values({
    actorStaffId: opts.actorStaffId,
    action: opts.action,
    targetType: opts.targetType,
    targetId: opts.targetId,
    metadata: opts.metadata ?? null,
  }).catch((e) => console.log(`[audit] write failed: ${e}`));
}

async function notifyUser(opts: {
  studentId: string;
  title: string;
  body: string;
  requestId?: string;
}) {
  await db.insert(notifications).values({
    studentId: opts.studentId,
    type: "request_status_change",
    title: opts.title,
    body: opts.body,
    requestId: opts.requestId ?? null,
  }).catch((e) => console.log(`[notify] insert failed: ${e}`));
}

const submissionListQuery = {
  query: t.Object({
    major: t.Optional(t.String()),
    group: t.Optional(t.String()),
    search: t.Optional(t.String()),
    page: t.Optional(t.String()),
    pageSize: t.Optional(t.String()),
  }),
};

function submissionListHandler(state: SubmissionState) {
  return async ({ user, query, set }: { user: any; query: Record<string, string | undefined>; set: any }) => {
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (user.role !== "admin" && user.role !== "staff") {
      set.status = 403;
      return { error: "staff_admin_only" };
    }
    return listSubmissionStudents({
      state,
      major: query.major?.trim() || undefined,
      group: query.group?.trim() || undefined,
      search: query.search?.trim() || undefined,
      page: Math.max(1, Math.floor(Number(query.page)) || 1),
      pageSize: Math.min(100, Math.max(1, Math.floor(Number(query.pageSize)) || 50)),
    });
  };
}

export const app = new Elysia()
  .use(
    cors({
      origin: WEB_ORIGIN,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  )
  .use(auth)
  .use(roster)
  .use(sessionPlugin)
.get("/health", () => ({ status: "ok", ts: Date.now() }))

  // ===== Upload (via server-side service_role) =====
  .post(
    "/api/upload",
    async ({ body, user, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (user.role !== "student") {
        set.status = 403;
        return { error: "only_students" };
      }
      if (!allowMockStorage && !supabaseAdmin) {
        set.status = 500;
        return { error: "storage_not_configured" };
      }

      const file = body.file;
      if (!file || typeof file !== "object" || !("type" in file)) {
        set.status = 400;
        return { error: "no_file" };
      }
      const f = file as unknown as { name?: string; type?: string; size?: number; arrayBuffer?: () => Promise<ArrayBuffer> };
      const fileName = f.name || "file";
      const declaredFileType = f.type || "application/octet-stream";
      const fileSize = f.size || 0;

      if (!ALLOWED_MIME.has(declaredFileType)) {
        set.status = 400;
        return { error: "unsupported_type", allowed: [...ALLOWED_MIME] };
      }
      if (fileSize > MAX_FILE_SIZE) {
        set.status = 400;
        return { error: "file_too_large", max: MAX_FILE_SIZE };
      }

      const buffer = f.arrayBuffer ? Buffer.from(await f.arrayBuffer()) : null;
      if (!buffer) {
        set.status = 400;
        return { error: "cannot_read_file" };
      }

      const detectedFileType = detectAllowedUploadFileType(buffer);
      if (
        !detectedFileType
        || !ALLOWED_MIME.has(detectedFileType.mime)
        || detectedFileType.mime !== declaredFileType
      ) {
        set.status = 400;
        return { error: "file_type_mismatch" };
      }

      const fileType = detectedFileType.mime;
      const ext = detectedFileType.ext;
      const path = `requests/${randomUUID()}.${ext}`;

      // Real storage vs mock: mock only in test/dev (allowMockStorage).
      // Branch structure lets TypeScript narrow supabaseAdmin without non-null assertion.
      if (allowMockStorage) {
        // skip real upload — test files never reach the storage bucket
      } else {
        if (!supabaseAdmin) {
          set.status = 500;
          return { error: "storage_not_configured" };
        }
        const { error } = await supabaseAdmin.storage
          .from("request-attachments")
          .upload(path, buffer, {
            contentType: fileType,
            cacheControl: String(ATTACHMENT_SIGNED_URL_TTL_SECONDS),
            upsert: false,
          });

        if (error) {
          set.status = 400;
          return { error: "upload_failed", message: error.message };
        }
      }

      try {
        await db.insert(attachmentUploads).values({
          storagePath: path,
          studentId: user.id,
          fileName,
          fileType,
          fileSize,
        });
      } catch (e) {
        console.error(`[upload] failed to record ownership: ${e}`);
        if (!allowMockStorage && supabaseAdmin) {
          const { error: cleanupError } = await supabaseAdmin.storage
            .from("request-attachments")
            .remove([path]);
          if (cleanupError) console.error(`[upload] failed to remove untracked object: ${cleanupError.message}`);
        }
        set.status = 500;
        return { error: "upload_tracking_failed" };
      }

      return {
        storagePath: path,
        fileName,
        fileType,
        fileSize,
      };
    },
    {
      body: t.Object({
        file: t.Any(),
      }),
    },
  )

  .get(
    "/api/attachments/:id/signed-url",
    async ({ params, query, user, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }

      const [attachment] = await db
        .select({
          id: requestAttachments.id,
          requestId: requestAttachments.requestId,
          storagePath: requestAttachments.storagePath,
          studentId: requests.studentId,
        })
        .from(requestAttachments)
        .innerJoin(requests, eq(requestAttachments.requestId, requests.id))
        .where(eq(requestAttachments.id, params.id))
        .limit(1);

      if (!attachment) {
        set.status = 404;
        return { error: "attachment_not_found" };
      }
      // staff may read attachments (round 2, D1); only the owner among students
      if (user.role === "student" && attachment.studentId !== user.id) {
        set.status = 403;
        return { error: "forbidden" };
      }

      let storagePath = attachment.storagePath;
      if (query.revisionId) {
        const [revision] = await db
          .select({ storagePath: requestAttachmentRevisions.storagePath })
          .from(requestAttachmentRevisions)
          .where(
            and(
              eq(requestAttachmentRevisions.id, query.revisionId),
              eq(requestAttachmentRevisions.attachmentId, attachment.id),
            ),
          )
          .limit(1);
        if (!revision) {
          set.status = 404;
          return { error: "attachment_revision_not_found" };
        }
        storagePath = revision.storagePath;
      }

      if (!storagePath) {
        set.status = 404;
        return { error: "attachment_file_not_found" };
      }

      let signedUrl: string;
      if (allowMockStorage) {
        signedUrl = `https://mock-storage.local/request-attachments/${encodeURIComponent(storagePath)}?token=gate-smoke`;
      } else {
        if (!supabaseAdmin) {
          set.status = 500;
          return { error: "storage_not_configured" };
        }
        const { data, error } = await supabaseAdmin.storage
          .from("request-attachments")
          .createSignedUrl(storagePath, ATTACHMENT_SIGNED_URL_TTL_SECONDS);
        if (error || !data?.signedUrl) {
          console.error(`[attachments] failed to create signed URL: ${error?.message ?? "missing URL"}`);
          set.status = 502;
          return { error: "signed_url_failed" };
        }
        signedUrl = data.signedUrl;
      }

      set.headers["Cache-Control"] = "private, no-store";
      return {
        url: signedUrl,
        expiresIn: ATTACHMENT_SIGNED_URL_TTL_SECONDS,
      };
    },
    {
      query: t.Object({
        revisionId: t.Optional(t.String()),
      }),
    },
  )

  // ===== Requests =====
  .get("/api/requests", async ({ user, query, set }) => {
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const role = user.role;
    const statusFilter = (query as any).status as string | undefined;
    const validStatuses = ["pending", "approved", "rejected", "revision_required"];
    const statusWhere = statusFilter && validStatuses.includes(statusFilter)
      ? eq(requests.status, statusFilter as "pending" | "approved" | "rejected")
      : undefined;

    if (role === "student") {
      const where = and(eq(requests.studentId, user.id), statusWhere);
      const list = await db
        .select({
          id: requests.id,
          status: requests.status,
          note: requests.note,
          rejectionReason: requests.rejectionReason,
          requestSequence: requests.requestSequence,
          requestYear: requests.requestYear,
          submittedAt: requests.submittedAt,
          reviewedAt: requests.reviewedAt,
          staffCheckedAt: requests.staffCheckedAt,
        })
        .from(requests)
        .where(where)
        .orderBy(desc(requests.submittedAt));
      return list.map((r) => ({
        ...r,
        requestNumber: requestNumberLabel(r.requestSequence, r.requestYear),
      }));
    }

    // admin and staff share the reviewer list; staff is read-only and gets no
    // student contact fields (round 2, D1). Both see who checked the documents.
    const list = await db
      .select({
        id: requests.id,
        status: requests.status,
        note: requests.note,
        rejectionReason: requests.rejectionReason,
        requestSequence: requests.requestSequence,
        requestYear: requests.requestYear,
        submittedAt: requests.submittedAt,
        reviewedAt: requests.reviewedAt,
        staffCheckedAt: requests.staffCheckedAt,
        staffCheckedByName: staff.fullName,
        student: {
          id: students.studentId,
          name: sql`${students.firstName} || ' ' || ${students.lastName}`,
          email: students.email,
          faculty: students.major,
          studentId: students.studentId,
        },
      })
      .from(requests)
      .innerJoin(students, eq(requests.studentId, students.studentId))
      .leftJoin(staff, eq(requests.staffCheckedById, staff.id))
      .where(statusWhere)
      .orderBy(desc(requests.submittedAt));
    return list.map((r) => ({
      ...r,
      student: role === "staff" ? { ...r.student, email: null } : r.student,
      requestNumber: requestNumberLabel(r.requestSequence, r.requestYear),
    }));
  })

  .get("/api/requests/:id", async ({ params, user, set }) => {
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const role = user.role;

    // ดึง request detail + attachments พร้อมกัน แทนที่จะรอทีละ query
    const [result, attachments] = await Promise.all([
      db
        .select({
          id: requests.id,
          status: requests.status,
          note: requests.note,
          requestSequence: requests.requestSequence,
          requestYear: requests.requestYear,
          submittedAt: requests.submittedAt,
          reviewedAt: requests.reviewedAt,
          staffCheckedAt: requests.staffCheckedAt,
          staffCheckedByName: staff.fullName,
          student: {
            id: students.studentId,
            name: sql`${students.firstName} || ' ' || ${students.lastName}`,
            email: students.email,
            faculty: students.major,
            studentId: students.studentId,
          },
        })
        .from(requests)
        .innerJoin(students, eq(requests.studentId, students.studentId))
        .leftJoin(staff, eq(requests.staffCheckedById, staff.id))
        .where(eq(requests.id, params.id)),

      db
        .select()
        .from(requestAttachments)
        .where(eq(requestAttachments.requestId, params.id))
        .orderBy(requestAttachments.slot),
    ]);

    if (result.length === 0) {
      set.status = 404;
      return { error: "not_found" };
    }

    const req = result[0];
    if (role === "student" && req.student.id !== user.id) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const attachmentIds = attachments.map((a) => a.id);
    const revisions = attachmentIds.length > 0
      ? await db
          .select()
          .from(requestAttachmentRevisions)
          .where(inArray(requestAttachmentRevisions.attachmentId, attachmentIds))
          .orderBy(desc(requestAttachmentRevisions.revisionNumber))
      : [];

    const attachmentsWithRevisions = attachments.map((a) => ({
      ...a,
      revisions: revisions.filter((r) => r.attachmentId === a.id),
    }));

    // The student sees when the documents were checked, not who checked them;
    // staff get no student contact fields.
    const { staffCheckedByName: _checker, ...withoutChecker } = req;
    const visible =
      role === "student"
        ? withoutChecker
        : role === "staff"
          ? { ...req, student: { ...req.student, email: null } }
          : req;
    return {
      ...visible,
      requestNumber: requestNumberLabel(req.requestSequence, req.requestYear),
      attachments: attachmentsWithRevisions,
    };
  })

  .post(
    "/api/requests",
    async ({ body, user, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      const role = user.role;
      if (role !== "student") {
        set.status = 403;
        return { error: "only_students" };
      }

      const attachments = body.attachments ?? [];
      const seenSlots = new Set<number>();
      for (const a of attachments) {
        if (a.slot !== 1 && a.slot !== 2) {
          set.status = 400;
          return { error: "slot_must_be_1_or_2" };
        }
        if (seenSlots.has(a.slot)) {
          set.status = 400;
          return { error: "duplicate_slot", slot: a.slot };
        }
        seenSlots.add(a.slot);
      }
      if (!seenSlots.has(1)) {
        set.status = 400;
        return { error: "slot1_required" };
      }

      const requestYear = thaiBuddhistYear();
      let created;
      try {
        created = await db.transaction(async (tx) => {
          await tx
            .insert(requestCounters)
            .values({ year: requestYear, lastNumber: 0 })
            .onConflictDoNothing();

          const [counter] = await tx
            .update(requestCounters)
            .set({ lastNumber: sql`${requestCounters.lastNumber} + 1` })
            .where(eq(requestCounters.year, requestYear))
            .returning({ lastNumber: requestCounters.lastNumber });
          if (!counter) throw new Error("request_counter_missing");

          const [row] = await tx
            .insert(requests)
            .values({
              studentId: user.id,
              status: "pending",
              note: body.note ?? null,
              requestSequence: counter.lastNumber,
              requestYear,
            })
            .returning();

          for (const a of attachments) {
            const [upload] = await tx
              .update(attachmentUploads)
              .set({ requestId: row.id, consumedAt: sql`now()` })
              .where(
                and(
                  eq(attachmentUploads.storagePath, a.storagePath),
                  eq(attachmentUploads.studentId, user.id),
                  isNull(attachmentUploads.consumedAt),
                ),
              )
              .returning({
                storagePath: attachmentUploads.storagePath,
                fileName: attachmentUploads.fileName,
                fileType: attachmentUploads.fileType,
                fileSize: attachmentUploads.fileSize,
              });
            if (!upload) throw new AttachmentOwnershipError(a.slot);

            const attId = crypto.randomUUID();
            await tx.insert(requestAttachments).values({
              id: attId,
              requestId: row.id,
              slot: a.slot,
              fileName: upload.fileName,
              fileType: upload.fileType,
              fileSize: upload.fileSize,
              storagePath: upload.storagePath,
            });
            const [rev] = await tx
              .insert(requestAttachmentRevisions)
              .values({
                attachmentId: attId,
                revisionNumber: 1,
                fileName: upload.fileName,
                fileType: upload.fileType,
                fileSize: upload.fileSize,
                storagePath: upload.storagePath,
              })
              .returning({ id: requestAttachmentRevisions.id });
            await tx
              .update(requestAttachments)
              .set({ currentRevisionId: rev.id })
              .where(eq(requestAttachments.id, attId));
          }
          return row;
        });
      } catch (e) {
        if (e instanceof AttachmentOwnershipError) {
          set.status = 400;
          return { error: "attachment_ownership_invalid", slot: e.slot };
        }
        throw e;
      }

      return {
        id: created.id,
        status: created.status,
        requestNumber: requestNumberLabel(created.requestSequence, created.requestYear),
      };
    },
    {
      body: t.Object({
        note: t.Optional(t.String()),
        attachments: t.Optional(
          t.Array(
            t.Object({
              slot: t.Integer(),
              fileName: t.String(),
              fileType: t.String(),
              fileSize: t.Number(),
              storagePath: t.String(),
            }),
          ),
        ),
      }),
    },
  )

  .patch(
    "/api/requests/:id",
    async ({ params, body, user, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }

      const existing = await db
        .select()
        .from(requests)
        .where(eq(requests.id, params.id));
      if (existing.length === 0) {
        set.status = 404;
        return { error: "not_found" };
      }
      const req = existing[0];
      if (req.studentId !== user.id) {
        set.status = 403;
        return { error: "forbidden" };
      }
      if (req.status !== "pending") {
        set.status = 400;
        return { error: "already_reviewed" };
      }

      const [updated] = await db
        .update(requests)
        .set({
          note: body.note ?? req.note,
          updatedAt: sql`now()`,
        })
        .where(eq(requests.id, params.id))
        .returning();
      return updated;
    },
    {
      body: t.Object({
        note: t.Optional(t.String()),
      }),
    },
  )

  // ===== Staff document check (round 2, D1-D5) =====
  // Staff-only on purpose (admin cannot check on staff's behalf). Touches only the
  // staff_checked_* columns: never status, reviewed_*, counters or attachment state.
  .post("/api/requests/:id/staff-check", async ({ params, user, set }) => {
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (user.role !== "staff") {
      set.status = 403;
      return { error: "staff_only" };
    }

    const [existing] = await db
      .select({
        status: requests.status,
        studentId: requests.studentId,
        staffCheckedAt: requests.staffCheckedAt,
      })
      .from(requests)
      .where(eq(requests.id, params.id));
    if (!existing) {
      set.status = 404;
      return { error: "not_found" };
    }
    if (existing.status !== "pending") {
      set.status = 400;
      return { error: "not_pending" };
    }
    if (existing.staffCheckedAt) {
      set.status = 409;
      return { error: "already_checked" };
    }

    const checked = await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(requests)
        .set({ staffCheckedAt: sql`now()`, staffCheckedById: user.id })
        .where(
          and(
            eq(requests.id, params.id),
            eq(requests.status, "pending"),
            isNull(requests.staffCheckedAt),
          ),
        )
        .returning({ staffCheckedAt: requests.staffCheckedAt });
      if (!claimed) return null;
      // REQUIREMENTS §8: check + audit log + student notification commit together or not at all.
      await tx.insert(auditLogs).values({
        actorStaffId: user.id,
        action: "staff_check",
        targetType: "request",
        targetId: params.id,
        metadata: { status: "pending" },
      });
      await tx.insert(notifications).values({
        studentId: existing.studentId,
        type: "request_status_change",
        title: "เจ้าหน้าที่ตรวจสอบเอกสารแล้ว",
        body: "เจ้าหน้าที่ตรวจสอบเอกสารในคำร้องของคุณแล้ว อยู่ระหว่างรอการพิจารณา",
        requestId: params.id,
      });
      return claimed;
    });
    if (!checked) {
      // Lost a race: another check or a decision committed between the read and the claim.
      const [current] = await db
        .select({ status: requests.status })
        .from(requests)
        .where(eq(requests.id, params.id));
      if (current && current.status !== "pending") {
        set.status = 400;
        return { error: "not_pending" };
      }
      set.status = 409;
      return { error: "already_checked" };
    }

    return { id: params.id, staffCheckedAt: checked.staffCheckedAt };
  })

  // ===== Staff review actions =====
  .post(
    "/api/requests/:id/approve",
    async ({ params, user, set }) => {
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const role = user.role;
    if (role !== "admin") {
      set.status = 403;
      return { error: "admin_only" };
    }

    const existing = await db
      .select({ status: requests.status })
      .from(requests)
      .where(eq(requests.id, params.id));
    if (existing.length === 0) {
      set.status = 404;
      return { error: "not_found" };
    }
    if (existing[0].status !== "pending") {
      set.status = 400;
      return { error: "already_reviewed" };
    }

    const approved = await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(requests)
        .set({
          status: "approved",
          reviewedById: user.id,
          reviewedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(requests.id, params.id), eq(requests.status, "pending")))
        .returning({
          id: requests.id,
          requestSequence: requests.requestSequence,
          requestYear: requests.requestYear,
          certificateNumber: requests.certificateNumber,
        });
      if (!claimed) return null;

      let requestNumber = claimed.certificateNumber;
      if (requestNumber == null) {
        const year = thaiBuddhistYear();
        await tx
          .insert(certificateCounters)
          .values({ year, lastNumber: 0 })
          .onConflictDoNothing();
        const [counter] = await tx
          .update(certificateCounters)
          .set({ lastNumber: sql`${certificateCounters.lastNumber} + 1` })
          .where(eq(certificateCounters.year, year))
          .returning({ lastNumber: certificateCounters.lastNumber });
        requestNumber = counter.lastNumber;
        await tx
          .update(requests)
          .set({ certificateNumber: requestNumber, certificateYear: year })
          .where(eq(requests.id, params.id));
      }

      const [row] = await tx
        .select({
          id: requests.id,
          studentId: requests.studentId,
          requestSequence: requests.requestSequence,
          requestYear: requests.requestYear,
          certificateNumber: requests.certificateNumber,
          certificateYear: requests.certificateYear,
          submittedAt: requests.submittedAt,
          reviewedAt: requests.reviewedAt,
        })
        .from(requests)
        .where(eq(requests.id, params.id));

      const atts = await tx
        .select({ currentRevisionId: requestAttachments.currentRevisionId })
        .from(requestAttachments)
        .where(eq(requestAttachments.requestId, params.id));
      const approvedRevIds = atts
        .map((a) => a.currentRevisionId)
        .filter((id): id is string => !!id);
      if (approvedRevIds.length > 0) {
        await tx
          .update(requestAttachmentRevisions)
          .set({ revisionState: "approved" })
          .where(inArray(requestAttachmentRevisions.id, approvedRevIds));
      }

      // ดึง student detail ใน transaction เดียวกัน ไม่ต้อง SELECT ซ้ำหลัง commit
      const [studentDetail] = await tx
        .select({
          studentId: students.studentId,
          studentName: sql<string>`${students.firstName} || ' ' || ${students.lastName}`,
          studentEmail: students.email,
          studentFaculty: students.major,
          studentCode: students.studentId,
          studentPhone: students.phone,
        })
        .from(students)
        .where(eq(students.studentId, row.studentId))
        .limit(1);

      return { ...row, requestNumber, studentDetail: studentDetail ?? null };
    });
    if (!approved) {
      set.status = 400;
      return { error: "already_reviewed" };
    }

    if (approved.studentDetail) {
      const d = approved.studentDetail;
      // ส่ง notification + audit log ก่อน return เพราะสำคัญ
      await Promise.all([
        notifyUser({
          studentId: d.studentId,
          title: "คำร้องได้รับการอนุมัติ",
          body: "คำร้องของคุณได้รับการอนุมัติแล้ว",
          requestId: params.id,
        }),
        writeAuditLog({
          actorStaffId: user.id,
          action: "approve",
          targetType: "request",
          targetId: params.id,
          metadata: {
            status: "approved",
            requestNumber: requestNumberLabel(approved.requestSequence, approved.requestYear),
            certificateNumber: approved.requestNumber,
            certificateYear: approved.certificateYear,
          },
        }),
      ]);

      // PDF + email หนักและไม่ urgent — รัน background ไม่ block response
      if (d.studentEmail) {
        setImmediate(async () => {
          let attachment: { filename: string; content: string } | undefined;
          try {
            if (approved.certificateYear == null) throw new Error("approved request has no certificate year");
            if (approved.reviewedAt == null) throw new Error("approved request has no reviewed_at");
            attachment = await generateCertificatePDFForEmail({
              requestNumber: approved.requestSequence ?? approved.requestNumber,
              requestYear: approved.requestYear ?? approved.certificateYear,
              certificateNumber: approved.requestNumber,
              certificateYear: approved.certificateYear,
              location: process.env.CERTIFICATE_LOCATION || "พิษณุโลก",
              studentName: d.studentName,
              studentId: d.studentCode,
              faculty: d.studentFaculty,
              phone: d.studentPhone,
              approved: true,
              reason: null,
              submittedAt: approved.submittedAt,
              reviewedAt: approved.reviewedAt,
            });
          } catch (e) {
            console.log(`[certificate] generation failed: ${e}`);
          }
          await sendStatusEmail({
            to: d.studentEmail!,
            studentName: d.studentName,
            status: "approved",
            attachments: attachment ? [attachment] : undefined,
          }).catch((e) => console.log(`[email] send failed: ${e}`));
        });
      }
    }
    return approved;
  },
  {})

  .post(
    "/api/requests/:id/reject",
    async ({ params, body, user, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      const role = user.role;
      if (role !== "admin") {
        set.status = 403;
        return { error: "admin_only" };
      }

      const existing = await db
        .select({ status: requests.status })
        .from(requests)
        .where(eq(requests.id, params.id));
      if (existing.length === 0) {
        set.status = 404;
        return { error: "not_found" };
      }
      if (existing[0].status !== "pending") {
        set.status = 400;
        return { error: "already_reviewed" };
      }

      const [updated] = await db
        .update(requests)
        .set({
          status: "rejected",
          rejectionReason: body.reason ?? null,
          reviewedById: user.id,
          reviewedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(requests.id, params.id), eq(requests.status, "pending")))
        .returning();
      if (!updated) {
        set.status = 400;
        return { error: "already_reviewed" };
      }

      const detail = await db
        .select({
          studentId: requests.studentId,
          studentName: sql<string>`${students.firstName} || ' ' || ${students.lastName}`,
          studentEmail: students.email,
        })
        .from(requests)
        .innerJoin(students, eq(requests.studentId, students.studentId))
        .where(eq(requests.id, params.id));

      if (detail.length > 0) {
        const d = detail[0];
        // best-effort หลัง commit เหมือน approve: สถานะ rejected ถูกบันทึกแล้ว ความล้มเหลวตรงนี้ต้องไม่ทำให้คำขอพัง
        await Promise.all([
          notifyUser({
            studentId: d.studentId,
            title: "คำร้องถูกไม่อนุมัติ",
            body: `คำร้องของคุณถูกไม่อนุมัติ${body.reason ? `\nเหตุผล: ${body.reason}` : ""}`,
            requestId: params.id,
          }),
          writeAuditLog({
            actorStaffId: user.id,
            action: "reject",
            targetType: "request",
            targetId: params.id,
            metadata: { status: "rejected", reason: body.reason ?? null },
          }),
        ]).catch((e) => console.log(`[reject] notify/audit failed: ${e}`));
        if (d.studentEmail) {
          const to = d.studentEmail;
          setImmediate(() => {
            sendStatusEmail({
              to,
              studentName: d.studentName,
              status: "rejected",
              reason: body.reason,
            }).catch((e) => console.log(`[email] send failed: ${e}`));
          });
        }
      }
      return updated;
    },
    {
      body: t.Object({
        reason: t.Optional(t.String()),
      }),
    },
  )

  .post(
    "/api/requests/:id/request-revision",
    async ({ params, body, user, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (user.role !== "admin") {
        set.status = 403;
        return { error: "admin_only" };
      }

      const existing = await db
        .select({ status: requests.status })
        .from(requests)
        .where(eq(requests.id, params.id));
      if (existing.length === 0) {
        set.status = 404;
        return { error: "not_found" };
      }
      if (existing[0].status !== "pending") {
        set.status = 400;
        return { error: "not_pending" };
      }

      const flagSlots = body.slots;
      if (!flagSlots || flagSlots.length === 0) {
        set.status = 400;
        return { error: "no_slots_flagged" };
      }
      for (const s of flagSlots) {
        if (s !== 1 && s !== 2) {
          set.status = 400;
          return { error: "invalid_slot", slot: s };
        }
      }

      const atts = await db
        .select({
          id: requestAttachments.id,
          slot: requestAttachments.slot,
          currentRevisionId: requestAttachments.currentRevisionId,
        })
        .from(requestAttachments)
        .where(eq(requestAttachments.requestId, params.id));

      const flagged = new Set(flagSlots);
      const toFlag = atts.filter(
        (a) => a.slot !== null && flagged.has(a.slot) && a.currentRevisionId,
      );
      if (toFlag.length === 0) {
        set.status = 400;
        return { error: "no_revision_to_flag" };
      }

      const done = await db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(requests)
          .set({
            status: "revision_required",
            reviewedById: user.id,
            reviewedAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(and(eq(requests.id, params.id), eq(requests.status, "pending")))
          .returning({ id: requests.id });
        if (!claimed) return false;

        const revIds = toFlag.map((a) => a.currentRevisionId as string);
        await tx
          .update(requestAttachmentRevisions)
          .set({ revisionState: "needs_revision" })
          .where(inArray(requestAttachmentRevisions.id, revIds));

        return true;
      });
      if (!done) {
        set.status = 400;
        return { error: "not_pending" };
      }

      await writeAuditLog({
        actorStaffId: user.id,
        action: "request_revision",
        targetType: "request",
        targetId: params.id,
        metadata: {
          status: "revision_required",
          slots: flagSlots,
        },
      });

      return { status: "revision_required", slots: flagSlots };
    },
    {
      body: t.Object({
        slots: t.Array(t.Integer()),
      }),
    },
  )

  .post(
    "/api/requests/:id/resubmit",
    async ({ params, body, user, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (user.role !== "student") {
        set.status = 403;
        return { error: "only_students" };
      }

      const existing = await db
        .select()
        .from(requests)
        .where(eq(requests.id, params.id));
      if (existing.length === 0) {
        set.status = 404;
        return { error: "not_found" };
      }
      const reqRow = existing[0];
      if (reqRow.studentId !== user.id) {
        set.status = 403;
        return { error: "forbidden" };
      }
      if (reqRow.status !== "revision_required") {
        set.status = 400;
        return { error: "not_revision_required" };
      }

      const replacements = body.attachments ?? [];
      const seen = new Set<number>();
      for (const a of replacements) {
        if (a.slot !== 1 && a.slot !== 2) {
          set.status = 400;
          return { error: "invalid_slot", slot: a.slot };
        }
        if (seen.has(a.slot)) {
          set.status = 400;
          return { error: "duplicate_slot", slot: a.slot };
        }
        seen.add(a.slot);
      }

      let resubmitted = false;
      try {
        resubmitted = await db.transaction(async (tx) => {
          const atts = await tx
            .select()
            .from(requestAttachments)
            .where(eq(requestAttachments.requestId, params.id));

          for (const a of replacements) {
            const [upload] = await tx
              .update(attachmentUploads)
              .set({ requestId: params.id, consumedAt: sql`now()` })
              .where(
                and(
                  eq(attachmentUploads.storagePath, a.storagePath),
                  eq(attachmentUploads.studentId, user.id),
                  isNull(attachmentUploads.consumedAt),
                ),
              )
              .returning({
                storagePath: attachmentUploads.storagePath,
                fileName: attachmentUploads.fileName,
                fileType: attachmentUploads.fileType,
                fileSize: attachmentUploads.fileSize,
              });
            if (!upload) throw new AttachmentOwnershipError(a.slot);

            const att = atts.find((x) => x.slot === a.slot);
            if (!att) {
              const attId = crypto.randomUUID();
              const [rev] = await tx
                .insert(requestAttachmentRevisions)
                .values({
                  attachmentId: attId,
                  revisionNumber: 1,
                  fileName: upload.fileName,
                  fileType: upload.fileType,
                  fileSize: upload.fileSize,
                  storagePath: upload.storagePath,
                  revisionState: "resubmitted",
                })
                .returning({ id: requestAttachmentRevisions.id });
              await tx.insert(requestAttachments).values({
                id: attId,
                requestId: params.id,
                slot: a.slot,
                currentRevisionId: rev.id,
                fileName: upload.fileName,
                fileType: upload.fileType,
                fileSize: upload.fileSize,
                storagePath: upload.storagePath,
              });
            } else {
              const [maxRev] = await tx
                .select({
                  max: sql<number>`MAX(${requestAttachmentRevisions.revisionNumber})`,
                })
                .from(requestAttachmentRevisions)
                .where(eq(requestAttachmentRevisions.attachmentId, att.id));
              const nextNum = (maxRev?.max ?? 0) + 1;
              const [rev] = await tx
                .insert(requestAttachmentRevisions)
                .values({
                  attachmentId: att.id,
                  revisionNumber: nextNum,
                  fileName: upload.fileName,
                  fileType: upload.fileType,
                  fileSize: upload.fileSize,
                  storagePath: upload.storagePath,
                  revisionState: "resubmitted",
                })
                .returning({ id: requestAttachmentRevisions.id });
              await tx
                .update(requestAttachments)
                .set({
                  currentRevisionId: rev.id,
                  fileName: upload.fileName,
                  fileType: upload.fileType,
                  fileSize: upload.fileSize,
                  storagePath: upload.storagePath,
                })
                .where(eq(requestAttachments.id, att.id));
            }
          }

          const after = await tx
            .select({ currentRevisionId: requestAttachments.currentRevisionId })
            .from(requestAttachments)
            .where(eq(requestAttachments.requestId, params.id));
          const revIds = after
            .map((a) => a.currentRevisionId)
            .filter((id): id is string => !!id);
          if (revIds.length > 0) {
            const flagged = await tx
              .select({ id: requestAttachmentRevisions.id })
              .from(requestAttachmentRevisions)
              .where(
                and(
                  inArray(requestAttachmentRevisions.id, revIds),
                  eq(requestAttachmentRevisions.revisionState, "needs_revision"),
                ),
              );
            if (flagged.length > 0) {
              throw new Error("flagged_slots_not_replaced");
            }
          }

          const [claimed] = await tx
            .update(requests)
            .set({
              status: "pending",
              reviewedById: null,
              reviewedAt: null,
              // documents changed: staff must check again (D3)
              staffCheckedAt: null,
              staffCheckedById: null,
              updatedAt: sql`now()`,
            })
            .where(
              and(eq(requests.id, params.id), eq(requests.status, "revision_required")),
            )
            .returning({ id: requests.id });
          if (!claimed) throw new ResubmitStateChangedError();
          return true;
        });
      } catch (e) {
        if (e instanceof AttachmentOwnershipError) {
          set.status = 400;
          return { error: "attachment_ownership_invalid", slot: e.slot };
        }
        if ((e as Error).message === "flagged_slots_not_replaced") {
          resubmitted = false;
        } else if (e instanceof ResubmitStateChangedError) {
          set.status = 400;
          return { error: "not_revision_required" };
        } else {
          throw e;
        }
      }

      if (!resubmitted) {
        set.status = 400;
        return { error: "flagged_slots_not_replaced" };
      }

      return { status: "pending" };
    },
    {
      body: t.Object({
        attachments: t.Optional(
          t.Array(
            t.Object({
              slot: t.Integer(),
              fileName: t.String(),
              fileType: t.String(),
              fileSize: t.Number(),
              storagePath: t.String(),
            }),
          ),
        ),
      }),
    },
  )

  .get("/api/me", async ({ user }) => {
    if (!user) return { user: null };
    return { user };
  })

  .patch(
    "/api/me",
    async ({ user, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }

      let phone: string | null = null;
      if (body.phone !== undefined) {
        const raw = body.phone.trim();
        if (raw !== "") {
          const digits = raw.replace(/[-\s]/g, "");
          if (!/^\d{9,10}$/.test(digits)) {
            set.status = 400;
            return { error: "invalid_phone" };
          }
        }
        phone = raw === "" ? null : raw;
        if (user.role === "student") {
          await db
            .update(students)
            .set({ phone, updatedAt: sql`now()` })
            .where(eq(students.studentId, user.id));
        }
      }

      let name: string | null = null;
      if (body.name !== undefined) {
        const rawName = body.name.trim();
        if (!rawName || rawName.length > 100) {
          set.status = 400;
          return { error: "invalid_name" };
        }
        if (user.role === "student") {
          set.status = 403;
          return { error: "student_name_locked" };
        }
        await db
          .update(staff)
          .set({ fullName: rawName, updatedAt: sql`now()` })
          .where(eq(staff.id, user.id));
        name = rawName;
        await writeAuditLog({
          actorStaffId: user.id,
          action: "staff_change_name",
          targetType: "staff",
          targetId: user.id,
          metadata: { fullName: rawName },
        });
      }

      return { phone, name };
    },
    {
      body: t.Object({
        phone: t.Optional(t.String()),
        name: t.Optional(t.String()),
      }),
    },
  )

  // ===== Profile avatar =====
  .post(
    "/api/me/avatar",
    async ({ body, user, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (!supabaseAdmin) {
        set.status = 500;
        return { error: "storage_not_configured" };
      }

      const file = body.file;
      if (!file || typeof file !== "object" || !("type" in file)) {
        set.status = 400;
        return { error: "no_file" };
      }
      const f = file as unknown as {
        name?: string;
        type?: string;
        size?: number;
        arrayBuffer?: () => Promise<ArrayBuffer>;
      };
      const fileType = f.type || "application/octet-stream";
      const fileSize = f.size || 0;
      if (!AVATAR_MIME.has(fileType)) {
        set.status = 400;
        return { error: "unsupported_type", allowed: [...AVATAR_MIME] };
      }
      if (fileSize > MAX_AVATAR_SIZE) {
        set.status = 400;
        return { error: "file_too_large", max: MAX_AVATAR_SIZE };
      }
      const buffer = f.arrayBuffer ? Buffer.from(await f.arrayBuffer()) : null;
      if (!buffer) {
        set.status = 400;
        return { error: "cannot_read_file" };
      }

      const ext = fileType === "image/jpeg" ? "jpg" : fileType.split("/")[1] || "png";
      const path = `${user.id}/${randomUUID()}.${ext}`;

      const existing =
        user.role === "student"
          ? await db
              .select({ avatarUrl: students.avatarUrl })
              .from(students)
              .where(eq(students.studentId, user.id))
              .limit(1)
          : await db
              .select({ avatarUrl: staff.avatarUrl })
              .from(staff)
              .where(eq(staff.id, user.id))
              .limit(1);
      if (existing[0]?.avatarUrl) {
        await supabaseAdmin.storage
          .from("avatars")
          .remove([existing[0].avatarUrl])
          .catch(() => {});
      }

      const { error } = await supabaseAdmin.storage
        .from("avatars")
        .upload(path, buffer, {
          contentType: fileType,
          cacheControl: "3600",
          upsert: false,
        });
      if (error) {
        set.status = 400;
        return { error: "upload_failed", message: error.message };
      }

      if (user.role === "student") {
        await db
          .update(students)
          .set({ avatarUrl: path, updatedAt: sql`now()` })
          .where(eq(students.studentId, user.id));
      } else {
        await db
          .update(staff)
          .set({ avatarUrl: path, updatedAt: sql`now()` })
          .where(eq(staff.id, user.id));
      }

      return { avatarUrl: path, url: avatarPublicUrl(path) };
    },
    {
      body: t.Object({
        file: t.Any(),
      }),
    },
  )

  .delete("/api/me/avatar", async ({ user, set }) => {
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const existing =
      user.role === "student"
        ? await db
            .select({ avatarUrl: students.avatarUrl })
            .from(students)
            .where(eq(students.studentId, user.id))
            .limit(1)
        : await db
            .select({ avatarUrl: staff.avatarUrl })
            .from(staff)
            .where(eq(staff.id, user.id))
            .limit(1);
    const path = existing[0]?.avatarUrl;
    if (path && supabaseAdmin) {
      await supabaseAdmin.storage.from("avatars").remove([path]).catch(() => {});
    }
    if (user.role === "student") {
      await db
        .update(students)
        .set({ avatarUrl: null, updatedAt: sql`now()` })
        .where(eq(students.studentId, user.id));
    } else {
      await db
        .update(staff)
        .set({ avatarUrl: null, updatedAt: sql`now()` })
        .where(eq(staff.id, user.id));
    }
    return { ok: true };
  })

  // ===== Change own password (staff + admin) =====
  .post(
    "/api/me/password",
    async ({ body, user, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (user.role === "student") {
        set.status = 403;
        return { error: "student_no_password" };
      }
      const [row] = await db
        .select()
        .from(staff)
        .where(eq(staff.id, user.id))
        .limit(1);
      if (!row) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      const ok = await verifyPassword(row.passwordHash, body.currentPassword);
      if (!ok) {
        set.status = 400;
        return { error: "wrong_password" };
      }
      if (!body.newPassword || body.newPassword.length < 8) {
        set.status = 400;
        return { error: "password_too_short" };
      }
      const passwordHash = await hashPassword(body.newPassword);
      await db
        .update(staff)
        .set({ passwordHash, updatedAt: sql`now()` })
        .where(eq(staff.id, user.id));
      await writeAuditLog({
        actorStaffId: user.id,
        action: "staff_change_password_self",
        targetType: "staff",
        targetId: user.id,
      });
      return { ok: true };
    },
    {
      body: t.Object({
        currentPassword: t.String(),
        newPassword: t.String(),
      }),
    },
  )

  // ===== Notifications =====
  .get("/api/notifications", async ({ user, set }) => {
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const userIdCol = user.role === "student" ? notifications.studentId : notifications.staffId;
    return await db
      .select()
      .from(notifications)
      .where(eq(userIdCol, user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
  })

  .post("/api/notifications/:id/read", async ({ params, user, set }) => {
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const [updated] = await db
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(
        and(
          eq(notifications.id, params.id),
          eq(user.role === "student" ? notifications.studentId : notifications.staffId, user.id),
        ),
      )
      .returning();
    if (!updated) {
      set.status = 404;
      return { error: "not_found" };
    }
    return updated;
  })

  .post("/api/notifications/read-all", async ({ user, set }) => {
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    await db
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(
        and(
          eq(user.role === "student" ? notifications.studentId : notifications.staffId, user.id),
          isNull(notifications.readAt),
        ),
      );
    return { ok: true };
  })

  // ===== Audit log (admin only) =====
  .get("/api/audit", async ({ user, set }) => {
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const role = user.role;
    if (role !== "admin") {
      set.status = 403;
      return { error: "admin_only" };
    }
    const rows = await db
      .select({ log: auditLogs, actorName: staff.fullName })
      .from(auditLogs)
      .leftJoin(staff, eq(auditLogs.actorStaffId, staff.id))
      .orderBy(desc(auditLogs.createdAt))
      .limit(200);
    return rows.map((r) => ({ ...r.log, actorName: r.actorName }));
  })

  // ===== Staff management (admin only) =====
  .get("/api/admin/staff", async ({ user, set }) => {
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (user.role !== "admin") {
      set.status = 403;
      return { error: "admin_only" };
    }
    const rows = await db
      .select({
        id: staff.id,
        staffCode: staff.staffCode,
        fullName: staff.fullName,
        role: staff.role,
        isActive: staff.isActive,
        kind: staff.kind,
        createdAt: staff.createdAt,
        updatedAt: staff.updatedAt,
      })
      .from(staff)
      .orderBy(desc(staff.createdAt));
    return rows;
  })

  .post(
    "/api/admin/staff",
    async ({ body, user, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (user.role !== "admin") {
        set.status = 403;
        return { error: "admin_only" };
      }

      const staffCode = body.staffCode.trim().toLowerCase();
      if (!staffCode) {
        set.status = 400;
        return { error: "invalid_staff_code" };
      }
      if (!body.password || body.password.length < 8) {
        set.status = 400;
        return { error: "password_too_short" };
      }
      const role = body.role === "admin" ? "admin" : "staff";
      const kind = body.kind === "emergency" ? "emergency" : "main";

      const dup = await db
        .select({ id: staff.id })
        .from(staff)
        .where(eq(staff.staffCode, staffCode));
      if (dup.length > 0) {
        set.status = 400;
        return { error: "staff_code_taken" };
      }

      const passwordHash = await hashPassword(body.password);

      const [created] = await db
        .insert(staff)
        .values({
          id: randomUUID(),
          staffCode,
          passwordHash,
          role,
          fullName: body.fullName.trim(),
          kind,
          isActive: body.isActive ?? true,
        })
        .returning({
          id: staff.id,
          staffCode: staff.staffCode,
          fullName: staff.fullName,
          role: staff.role,
          isActive: staff.isActive,
          kind: staff.kind,
        });

      await writeAuditLog({
        actorStaffId: user.id,
        action: "staff_create",
        targetType: "staff",
        targetId: created.id,
        metadata: { staffCode: created.staffCode, fullName: created.fullName, role: created.role, kind: created.kind },
      });
      return created;
    },
    {
      body: t.Object({
        staffCode: t.String(),
        fullName: t.String(),
        password: t.String(),
        role: t.Optional(t.Union([t.Literal("staff"), t.Literal("admin")])),
        kind: t.Optional(t.Union([t.Literal("main"), t.Literal("emergency")])),
        isActive: t.Optional(t.Boolean()),
      }),
    },
  )

  .patch(
    "/api/admin/staff/:id",
    async ({ params, body, user, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (user.role !== "admin") {
        set.status = 403;
        return { error: "admin_only" };
      }

      const existing = await db
        .select()
        .from(staff)
        .where(eq(staff.id, params.id));
      if (existing.length === 0) {
        set.status = 404;
        return { error: "not_found" };
      }
      const target = existing[0];

      const patch: Record<string, unknown> = { updatedAt: sql`now()` };

      if (body.staffCode !== undefined) {
        const code = body.staffCode.trim().toLowerCase();
        if (!code) {
          set.status = 400;
          return { error: "invalid_staff_code" };
        }
        if (code !== target.staffCode) {
          const dup = await db
            .select({ id: staff.id })
            .from(staff)
            .where(eq(staff.staffCode, code));
          if (dup.length > 0) {
            set.status = 400;
            return { error: "staff_code_taken" };
          }
          patch.staffCode = code;
          await writeAuditLog({
            actorStaffId: user.id,
            action: "staff_change_code",
            targetType: "staff",
            targetId: target.id,
            metadata: { staffCode: code },
          });
        }
      }

      if (body.fullName !== undefined && body.fullName.trim() !== "") {
        patch.fullName = body.fullName.trim();
      }
      if (body.role !== undefined && (body.role === "admin" || body.role === "staff")) {
        if (body.role !== target.role) {
          patch.role = body.role;
          await writeAuditLog({
            actorStaffId: user.id,
            action: "staff_change_role",
            targetType: "staff",
            targetId: target.id,
            metadata: { role: body.role },
          });
        }
      }
      if (body.kind !== undefined && (body.kind === "main" || body.kind === "emergency")) {
        if (body.kind !== target.kind) {
          patch.kind = body.kind;
          await writeAuditLog({
            actorStaffId: user.id,
            action: "staff_change_kind",
            targetType: "staff",
            targetId: target.id,
            metadata: { kind: body.kind },
          });
        }
      }
      if (body.isActive !== undefined && body.isActive !== target.isActive) {
        if (!body.isActive && user.id === target.id) {
          set.status = 400;
          return { error: "cannot_disable_self" };
        }
        patch.isActive = body.isActive;
        await writeAuditLog({
          actorStaffId: user.id,
          action: body.isActive ? "staff_enable" : "staff_disable",
          targetType: "staff",
          targetId: target.id,
          metadata: { isActive: body.isActive },
        });
      }
      if (body.password !== undefined) {
        if (body.password.length < 8) {
          set.status = 400;
          return { error: "password_too_short" };
        }
        patch.passwordHash = await hashPassword(body.password);
        await writeAuditLog({
          actorStaffId: user.id,
          action: "staff_reset_password",
          targetType: "staff",
          targetId: target.id,
        });
      }

      const [updated] = await db
        .update(staff)
        .set(patch)
        .where(eq(staff.id, params.id))
        .returning({
          id: staff.id,
          staffCode: staff.staffCode,
          fullName: staff.fullName,
          role: staff.role,
          isActive: staff.isActive,
          kind: staff.kind,
        });
      return updated;
    },
    {
      body: t.Object({
        staffCode: t.Optional(t.String()),
        fullName: t.Optional(t.String()),
        password: t.Optional(t.String()),
        role: t.Optional(t.Union([t.Literal("staff"), t.Literal("admin")])),
        kind: t.Optional(t.Union([t.Literal("main"), t.Literal("emergency")])),
        isActive: t.Optional(t.Boolean()),
      }),
    },
  )

  // ===== Stats (admin only) =====
  .get("/api/stats", async ({ user, set }) => {
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const role = user.role;
    if (role !== "admin") {
      set.status = 403;
      return { error: "admin_only" };
    }

    // นับ total + per-status ใน DB แทนที่จะโหลดทุก row มา filter ใน JS
    const [statusRows, facultyRows] = await Promise.all([
      db
        .select({
          status: requests.status,
          n: count(requests.id).mapWith(Number),
        })
        .from(requests)
        .groupBy(requests.status),

      db
        .select({
          faculty: sql<string>`COALESCE(${students.major}, 'ไม่ระบุ')`,
          status: requests.status,
          n: count(requests.id).mapWith(Number),
        })
        .from(requests)
        .innerJoin(students, eq(requests.studentId, students.studentId))
        .groupBy(sql`COALESCE(${students.major}, 'ไม่ระบุ')`, requests.status),
    ]);

    // total = pending + revisionRequired + approved + rejected (every status has its own field)
    let total = 0, pending = 0, revisionRequired = 0, approved = 0, rejected = 0;
    for (const r of statusRows) {
      total += r.n;
      if (r.status === "pending") pending = r.n;
      else if (r.status === "revision_required") revisionRequired = r.n;
      else if (r.status === "approved") approved = r.n;
      else if (r.status === "rejected") rejected = r.n;
    }

    const byFacultyMap = new Map<
      string,
      { faculty: string; total: number; pending: number; revisionRequired: number; approved: number; rejected: number }
    >();
    for (const r of facultyRows) {
      const f = r.faculty;
      const b = byFacultyMap.get(f) ?? { faculty: f, total: 0, pending: 0, revisionRequired: 0, approved: 0, rejected: 0 };
      b.total += r.n;
      if (r.status === "pending") b.pending += r.n;
      else if (r.status === "revision_required") b.revisionRequired += r.n;
      else if (r.status === "approved") b.approved += r.n;
      else if (r.status === "rejected") b.rejected += r.n;
      byFacultyMap.set(f, b);
    }

    return {
      total,
      pending,
      revisionRequired,
      approved,
      rejected,
      byFaculty: [...byFacultyMap.values()],
    };
  })

  // ===== Submission stats vs roster (staff + admin) =====
  .get("/api/stats/submission", async ({ user, set }) => {
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const role = user.role;
    if (role !== "admin" && role !== "staff") {
      set.status = 403;
      return { error: "staff_admin_only" };
    }

    return getSubmissionStats();
  })

  // ===== Submitted / not-submitted roster lists (staff + admin) =====
  // Both share submission.ts with /api/stats/submission, so list length == card number.
  .get("/api/roster/not-submitted", submissionListHandler("not_submitted"), submissionListQuery)
  .get("/api/roster/submitted", submissionListHandler("submitted"), submissionListQuery);

export type App = typeof app;
