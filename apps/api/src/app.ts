import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { auth } from "./auth";
import { generateCertificatePDFForEmail } from "./certificate";
import {
  requests,
  activities,
  requestAttachments,
  requestAttachmentRevisions,
  notifications,
  auditLogs,
  certificateCounters,
  students,
  staff,
} from "@ua/db/schema";
import { db } from "@ua/db/client";
import { eq, and, desc, sql, isNull, count, countDistinct, inArray } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { getSession } from "./auth/session";
import { hash, verify } from "@ua/db/auth-helpers";

const PUBLIC_API_URL = process.env.PUBLIC_API_URL || "http://localhost:3000";
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

const AVATAR_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;

function avatarPublicUrl(storagePath: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/avatars/${storagePath}`;
}

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

function formatBuddhistDate(d: Date): { day: number; month: string; year: number } {
  return {
    day: d.getDate(),
    month: THAI_MONTHS[d.getMonth()],
    year: d.getFullYear() + 543,
  };
}

async function sendStatusEmail(opts: {
  to: string;
  studentName: string;
  activityTitle: string;
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
    ? `สวัสดี คุณ${opts.studentName} คำร้องเข้าร่วม "${opts.activityTitle}" ของคุณได้รับการอนุมัติแล้ว\nกรุณาตรวจสอบใบรับรองที่แนบมาด้วย`
    : `สวัสดี คุณ${opts.studentName} คำร้องเข้าร่วม "${opts.activityTitle}" ของคุณถูกไม่อนุมัติ${opts.reason ? `\nเหตุผล: ${opts.reason}` : ""}`;
  try {
    const payload: Record<string, unknown> = {
      from: EMAIL_FROM,
      to: [opts.to],
      subject: `${th} — ระบบคำร้องกิจกรรม`,
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

function studentName(s: { firstName: string; lastName: string }): string {
  return `${s.firstName} ${s.lastName}`;
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
  .get("/health", () => ({ status: "ok", ts: Date.now() }))

  // ===== Activities =====
  .get("/api/activities", async ({ query, headers, set }) => {
    let includeInactive = (query as any).includeInactive === "true";
    if (includeInactive) {
      const user = await getSession(headers);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (user.role !== "admin") {
        set.status = 403;
        return { error: "admin_only" };
      }
    }
    const where = includeInactive
      ? undefined
      : eq(activities.isActive, true);
    const list = await db
      .select()
      .from(activities)
      .where(where)
      .orderBy(desc(activities.date));
    return list;
  })

  .post(
    "/api/activities",
    async ({ body, headers, set }) => {
      const user = await getSession(headers);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      const role = user.role;
      if (role !== "admin") {
        set.status = 403;
        return { error: "admin_only" };
      }

      const [created] = await db
        .insert(activities)
        .values({
          title: body.title,
          titleEn: body.titleEn,
          type: body.type,
          organizer: body.organizer,
          date: new Date(body.date),
          location: body.location,
          description: body.description ?? null,
          descriptionEn: body.descriptionEn ?? null,
          submissionDeadline: body.submissionDeadline
            ? new Date(body.submissionDeadline)
            : null,
          isActive: body.isActive ?? true,
        })
        .returning();
      await writeAuditLog({
        actorStaffId: user.id,
        action: "activity_create",
        targetType: "activity",
        targetId: created.id,
        metadata: { title: created.title },
      });
      return created;
    },
    {
      body: t.Object({
        title: t.String(),
        titleEn: t.String(),
        type: t.String(),
        organizer: t.String(),
        date: t.String(),
        location: t.String(),
        description: t.Optional(t.String()),
        descriptionEn: t.Optional(t.String()),
        submissionDeadline: t.Optional(t.String()),
        isActive: t.Optional(t.Boolean()),
      }),
    },
  )

  .patch(
    "/api/activities/:id",
    async ({ params, body, headers, set }) => {
      const user = await getSession(headers);
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
        .select({ id: activities.id })
        .from(activities)
        .where(eq(activities.id, params.id));
      if (existing.length === 0) {
        set.status = 404;
        return { error: "not_found" };
      }

      const [updated] = await db
        .update(activities)
        .set({
          title: body.title,
          titleEn: body.titleEn,
          type: body.type,
          organizer: body.organizer,
          date: body.date ? new Date(body.date) : undefined,
          location: body.location,
          description: body.description,
          descriptionEn: body.descriptionEn,
          submissionDeadline: body.submissionDeadline
            ? new Date(body.submissionDeadline)
            : body.submissionDeadline === null
              ? null
              : undefined,
          isActive: body.isActive,
          updatedAt: sql`now()`,
        })
        .where(eq(activities.id, params.id))
        .returning();
      await writeAuditLog({
        actorStaffId: user.id,
        action: "activity_update",
        targetType: "activity",
        targetId: params.id,
        metadata: { title: updated.title },
      });
      return updated;
    },
    {
      body: t.Object({
        title: t.Optional(t.String()),
        titleEn: t.Optional(t.String()),
        type: t.Optional(t.String()),
        organizer: t.Optional(t.String()),
        date: t.Optional(t.String()),
        location: t.Optional(t.String()),
        description: t.Optional(t.Nullable(t.String())),
        descriptionEn: t.Optional(t.Nullable(t.String())),
        submissionDeadline: t.Optional(t.Nullable(t.String())),
        isActive: t.Optional(t.Boolean()),
      }),
    },
  )

  .delete("/api/activities/:id", async ({ params, headers, set }) => {
    const user = await getSession(headers);
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
      .select({ id: activities.id })
      .from(activities)
      .where(eq(activities.id, params.id));
    if (existing.length === 0) {
      set.status = 404;
      return { error: "not_found" };
    }

    const [deleted] = await db
      .update(activities)
      .set({ isActive: false, updatedAt: sql`now()` })
      .where(eq(activities.id, params.id))
      .returning();
    await writeAuditLog({
      actorStaffId: user.id,
      action: "activity_delete",
      targetType: "activity",
      targetId: params.id,
      metadata: { title: deleted.title },
    });
    return deleted;
  })

  // ===== Upload (via server-side service_role) =====
  .post(
    "/api/upload",
    async ({ body, headers, set }) => {
      const user = await getSession(headers);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (user.role !== "student") {
        set.status = 403;
        return { error: "only_students" };
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
      const f = file as unknown as { name?: string; type?: string; size?: number; arrayBuffer?: () => Promise<ArrayBuffer> };
      const fileName = f.name || "file";
      const fileType = f.type || "application/octet-stream";
      const fileSize = f.size || 0;

      if (!ALLOWED_MIME.has(fileType)) {
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

      const ext = fileType === "image/jpeg" ? "jpg" : fileType.split("/")[1] || "bin";
      const path = `requests/${randomUUID()}.${ext}`;

      const { error } = await supabaseAdmin.storage
        .from("request-attachments")
        .upload(path, buffer, {
          contentType: fileType,
          cacheControl: "3600",
          upsert: false,
        });

      if (error) {
        set.status = 400;
        return { error: "upload_failed", message: error.message };
      }

      return {
        storagePath: path,
        fileName,
        fileType,
        fileSize,
        url: `${SUPABASE_URL}/storage/v1/object/public/request-attachments/${path}`,
      };
    },
    {
      body: t.Object({
        file: t.Any(),
      }),
    },
  )

  // ===== Requests =====
  .get("/api/requests", async ({ headers, query, set }) => {
    const user = await getSession(headers);
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
          activityName: requests.activityName,
          submittedAt: requests.submittedAt,
          reviewedAt: requests.reviewedAt,
          activity: {
            id: activities.id,
            title: activities.title,
            titleEn: activities.titleEn,
            type: activities.type,
            date: activities.date,
          },
        })
        .from(requests)
        .innerJoin(activities, eq(requests.activityId, activities.id))
        .where(where)
        .orderBy(desc(requests.submittedAt));
      return list;
    }

    if (role === "staff") {
      set.status = 403;
      return { error: "staff_cannot_access" };
    }

    const list = await db
      .select({
        id: requests.id,
        status: requests.status,
        note: requests.note,
        rejectionReason: requests.rejectionReason,
        activityName: requests.activityName,
        submittedAt: requests.submittedAt,
        reviewedAt: requests.reviewedAt,
        activity: {
          id: activities.id,
          title: activities.title,
          titleEn: activities.titleEn,
          type: activities.type,
          date: activities.date,
        },
        student: {
          id: students.studentId,
          name: sql`${students.firstName} || ' ' || ${students.lastName}`,
          email: students.email,
          faculty: students.major,
          studentId: students.studentId,
        },
      })
      .from(requests)
      .innerJoin(activities, eq(requests.activityId, activities.id))
      .innerJoin(students, eq(requests.studentId, students.studentId))
      .where(statusWhere)
      .orderBy(desc(requests.submittedAt));
    return list;
  })

  .get("/api/requests/:id", async ({ params, headers, set }) => {
    const user = await getSession(headers);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const role = user.role;

    const result = await db
      .select({
        id: requests.id,
        status: requests.status,
        note: requests.note,
        activityName: requests.activityName,
        submittedAt: requests.submittedAt,
        reviewedAt: requests.reviewedAt,
        activity: {
          id: activities.id,
          title: activities.title,
          titleEn: activities.titleEn,
          type: activities.type,
          date: activities.date,
          location: activities.location,
          organizer: activities.organizer,
          description: activities.description,
          descriptionEn: activities.descriptionEn,
        },
        student: {
          id: students.studentId,
          name: sql`${students.firstName} || ' ' || ${students.lastName}`,
          email: students.email,
          faculty: students.major,
          studentId: students.studentId,
        },
      })
      .from(requests)
      .innerJoin(activities, eq(requests.activityId, activities.id))
      .innerJoin(students, eq(requests.studentId, students.studentId))
      .where(eq(requests.id, params.id));

    if (result.length === 0) {
      set.status = 404;
      return { error: "not_found" };
    }

    const req = result[0];
    if (role === "student" && req.student.id !== user.id) {
      set.status = 403;
      return { error: "forbidden" };
    }

    if (role === "staff") {
      set.status = 403;
      return { error: "staff_cannot_access" };
    }

    const attachments = await db
      .select()
      .from(requestAttachments)
      .where(eq(requestAttachments.requestId, params.id))
      .orderBy(requestAttachments.slot);

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

    return { ...req, attachments: attachmentsWithRevisions };
  })

  .post(
    "/api/requests",
    async ({ body, headers, set }) => {
      const user = await getSession(headers);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      const role = user.role;
      if (role !== "student") {
        set.status = 403;
        return { error: "only_students" };
      }

      const activity = await db
        .select({
          id: activities.id,
          isActive: activities.isActive,
          submissionDeadline: activities.submissionDeadline,
        })
        .from(activities)
        .where(eq(activities.id, body.activityId));
      if (activity.length === 0) {
        set.status = 400;
        return { error: "invalid_activity" };
      }
      const act = activity[0];
      if (act.isActive === false) {
        set.status = 400;
        return { error: "activity_closed" };
      }
      if (act.submissionDeadline && new Date(act.submissionDeadline).getTime() < Date.now()) {
        set.status = 400;
        return { error: "deadline_passed" };
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
      if (attachments.length > 0 && !seenSlots.has(1)) {
        set.status = 400;
        return { error: "slot1_required" };
      }

      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(requests)
          .values({
            studentId: user.id,
            activityId: body.activityId,
            status: "pending",
            note: body.note ?? null,
          })
          .returning();

        for (const a of attachments) {
          const attId = crypto.randomUUID();
          await tx.insert(requestAttachments).values({
            id: attId,
            requestId: row.id,
            slot: a.slot,
            fileName: a.fileName,
            fileType: a.fileType,
            fileSize: a.fileSize,
            storagePath: a.storagePath,
          });
          const [rev] = await tx
            .insert(requestAttachmentRevisions)
            .values({
              attachmentId: attId,
              revisionNumber: 1,
              fileName: a.fileName,
              fileType: a.fileType,
              fileSize: a.fileSize,
              storagePath: a.storagePath,
            })
            .returning({ id: requestAttachmentRevisions.id });
          await tx
            .update(requestAttachments)
            .set({ currentRevisionId: rev.id })
            .where(eq(requestAttachments.id, attId));
        }
        return row;
      });

      return { id: created.id, status: created.status };
    },
    {
      body: t.Object({
        activityId: t.String(),
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
    async ({ params, body, headers, set }) => {
      const user = await getSession(headers);
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
          activityId: body.activityId ?? req.activityId,
          note: body.note ?? req.note,
          updatedAt: sql`now()`,
        })
        .where(eq(requests.id, params.id))
        .returning();
      return updated;
    },
    {
      body: t.Object({
        activityId: t.Optional(t.String()),
        note: t.Optional(t.String()),
      }),
    },
  )

  // ===== Staff review actions =====
  .post(
    "/api/requests/:id/approve",
    async ({ params, body, headers, set }) => {
    const user = await getSession(headers);
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
        .returning({ id: requests.id, certificateNumber: requests.certificateNumber });
      if (!claimed) return null;

      let requestNumber = claimed.certificateNumber;
      if (requestNumber == null) {
        const year = new Date().getFullYear() + 543;
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
          activityName: requests.activityName,
          certificateNumber: requests.certificateNumber,
          certificateYear: requests.certificateYear,
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

      return { ...row, requestNumber };
    });
    if (!approved) {
      set.status = 400;
      return { error: "already_reviewed" };
    }

    const detail = await db
      .select({
        studentId: requests.studentId,
        studentName: sql<string>`${students.firstName} || ' ' || ${students.lastName}`,
        studentEmail: students.email,
        studentFaculty: students.major,
        studentCode: students.studentId,
        studentPhone: students.phone,
        activityTitle: activities.title,
        activityTitleEn: activities.titleEn,
        activityName: requests.activityName,
      })
      .from(requests)
      .innerJoin(students, eq(requests.studentId, students.studentId))
      .innerJoin(activities, eq(requests.activityId, activities.id))
      .where(eq(requests.id, params.id));

    if (detail.length > 0) {
      const d = detail[0];
      const displayTitle = d.activityName ?? d.activityTitle;
      await notifyUser({
        studentId: d.studentId,
        title: "คำร้องได้รับการอนุมัติ",
        body: `คำร้องเข้าร่วม "${displayTitle}" ของคุณได้รับการอนุมัติแล้ว`,
        requestId: params.id,
      });
      await writeAuditLog({
        actorStaffId: user.id,
        action: "approve",
        targetType: "request",
        targetId: params.id,
        metadata: {
          status: "approved",
          activityName: d.activityName ?? null,
          certificateNumber: approved.requestNumber,
          certificateYear: approved.certificateYear,
        },
      });

      let attachment: { filename: string; content: string } | undefined;
      try {
        const now = new Date();
        const buddhist = formatBuddhistDate(now);
        const reviewedDate = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear() + 543}`;
        attachment = await generateCertificatePDFForEmail({
          requestNumber: approved.requestNumber,
          location: process.env.CERTIFICATE_LOCATION || "พิษณุโลก",
          dateDay: buddhist.day,
          dateMonth: buddhist.month,
          dateYear: buddhist.year,
          studentName: d.studentName,
          studentId: d.studentCode,
          faculty: d.studentFaculty,
          phone: d.studentPhone,
          approved: true,
          reason: null,
          reviewedDate,
        });
      } catch (e) {
        console.log(`[certificate] generation failed: ${e}`);
      }

      if (d.studentEmail) {
        await sendStatusEmail({
          to: d.studentEmail,
          studentName: d.studentName,
          activityTitle: displayTitle,
          status: "approved",
          attachments: attachment ? [attachment] : undefined,
        });
      }
    }
    return approved;
  },
  {})

  .post(
    "/api/requests/:id/reject",
    async ({ params, body, headers, set }) => {
      const user = await getSession(headers);
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
          note: body.reason ?? null,
          rejectionReason: body.reason ?? null,
          reviewedById: user.id,
          reviewedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(requests.id, params.id))
        .returning();
      if (!updated) {
        set.status = 404;
        return { error: "not_found" };
      }

      const detail = await db
        .select({
          studentId: requests.studentId,
          studentName: sql<string>`${students.firstName} || ' ' || ${students.lastName}`,
          studentEmail: students.email,
          activityTitle: activities.title,
          activityTitleEn: activities.titleEn,
          activityName: requests.activityName,
        })
        .from(requests)
        .innerJoin(students, eq(requests.studentId, students.studentId))
        .innerJoin(activities, eq(requests.activityId, activities.id))
        .where(eq(requests.id, params.id));

      if (detail.length > 0) {
        const d = detail[0];
        const displayTitle = d.activityName ?? d.activityTitle;
        await notifyUser({
          studentId: d.studentId,
          title: "คำร้องถูกไม่อนุมัติ",
          body: `คำร้องเข้าร่วม "${displayTitle}" ของคุณถูกไม่อนุมัติ${body.reason ? `\nเหตุผล: ${body.reason}` : ""}`,
          requestId: params.id,
        });
        await writeAuditLog({
          actorStaffId: user.id,
          action: "reject",
          targetType: "request",
          targetId: params.id,
          metadata: { status: "rejected", reason: body.reason ?? null, activityName: d.activityName ?? null },
        });
        if (d.studentEmail) {
          await sendStatusEmail({
            to: d.studentEmail,
            studentName: d.studentName,
            activityTitle: displayTitle,
            status: "rejected",
            reason: body.reason,
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
    async ({ params, body, headers, set }) => {
      const user = await getSession(headers);
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
    async ({ params, body, headers, set }) => {
      const user = await getSession(headers);
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
            const att = atts.find((x) => x.slot === a.slot);
            if (!att) {
              const attId = crypto.randomUUID();
              const [rev] = await tx
                .insert(requestAttachmentRevisions)
                .values({
                  attachmentId: attId,
                  revisionNumber: 1,
                  fileName: a.fileName,
                  fileType: a.fileType,
                  fileSize: a.fileSize,
                  storagePath: a.storagePath,
                  revisionState: "resubmitted",
                })
                .returning({ id: requestAttachmentRevisions.id });
              await tx.insert(requestAttachments).values({
                id: attId,
                requestId: params.id,
                slot: a.slot,
                currentRevisionId: rev.id,
                fileName: a.fileName,
                fileType: a.fileType,
                fileSize: a.fileSize,
                storagePath: a.storagePath,
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
                  fileName: a.fileName,
                  fileType: a.fileType,
                  fileSize: a.fileSize,
                  storagePath: a.storagePath,
                  revisionState: "resubmitted",
                })
                .returning({ id: requestAttachmentRevisions.id });
              await tx
                .update(requestAttachments)
                .set({
                  currentRevisionId: rev.id,
                  fileName: a.fileName,
                  fileType: a.fileType,
                  fileSize: a.fileSize,
                  storagePath: a.storagePath,
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
              updatedAt: sql`now()`,
            })
            .where(
              and(eq(requests.id, params.id), eq(requests.status, "revision_required")),
            )
            .returning({ id: requests.id });
          return !!claimed;
        });
      } catch (e) {
        if ((e as Error).message === "flagged_slots_not_replaced") {
          resubmitted = false;
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

  .get("/api/me", async ({ headers }) => {
    const user = await getSession(headers);
    if (!user) return { user: null };
    return { user };
  })

  .patch(
    "/api/me",
    async ({ headers, body, set }) => {
      const user = await getSession(headers);
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
    async ({ body, headers, set }) => {
      const user = await getSession(headers);
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

  .delete("/api/me/avatar", async ({ headers, set }) => {
    const user = await getSession(headers);
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
    async ({ body, headers, set }) => {
      const user = await getSession(headers);
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
      const ok = await verify(row.passwordHash, body.currentPassword);
      if (!ok) {
        set.status = 400;
        return { error: "wrong_password" };
      }
      if (!body.newPassword || body.newPassword.length < 8) {
        set.status = 400;
        return { error: "password_too_short" };
      }
      const passwordHash = await hash(body.newPassword, {
        memoryCost: 19456,
        timeCost: 2,
        outputLen: 32,
        parallelism: 1,
      });
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
  .get("/api/notifications", async ({ headers, set }) => {
    const user = await getSession(headers);
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

  .post("/api/notifications/:id/read", async ({ params, headers, set }) => {
    const user = await getSession(headers);
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

  .post("/api/notifications/read-all", async ({ headers, set }) => {
    const user = await getSession(headers);
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
  .get("/api/audit", async ({ headers, set }) => {
    const user = await getSession(headers);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const role = user.role;
    if (role !== "admin") {
      set.status = 403;
      return { error: "admin_only" };
    }
    return await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(200);
  })

  // ===== Staff management (admin only) =====
  .get("/api/admin/staff", async ({ headers, set }) => {
    const user = await getSession(headers);
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
        email: staff.email,
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
    async ({ body, headers, set }) => {
      const user = await getSession(headers);
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

      const passwordHash = await hash(body.password, {
        memoryCost: 19456,
        timeCost: 2,
        outputLen: 32,
        parallelism: 1,
      });

      const [created] = await db
        .insert(staff)
        .values({
          id: randomUUID(),
          email: (body.email ?? "").trim().toLowerCase(),
          staffCode,
          passwordHash,
          role,
          fullName: body.fullName.trim(),
          kind,
          isActive: body.isActive ?? true,
        })
        .returning({
          id: staff.id,
          email: staff.email,
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
        email: t.Optional(t.String()),
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
    async ({ params, body, headers, set }) => {
      const user = await getSession(headers);
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
        patch.passwordHash = await hash(body.password, {
          memoryCost: 19456,
          timeCost: 2,
          outputLen: 32,
          parallelism: 1,
        });
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
          email: staff.email,
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
        email: t.Optional(t.String()),
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
  .get("/api/stats", async ({ headers, set }) => {
    const user = await getSession(headers);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const role = user.role;
    if (role !== "admin") {
      set.status = 403;
      return { error: "admin_only" };
    }

    const all = await db
      .select({
        id: requests.id,
        status: requests.status,
        activityId: requests.activityId,
        activityTitle: activities.title,
        activityTitleEn: activities.titleEn,
        faculty: students.major,
      })
      .from(requests)
      .innerJoin(activities, eq(requests.activityId, activities.id))
      .innerJoin(students, eq(requests.studentId, students.studentId));

    const countBy = (status?: string) =>
      status ? all.filter((r) => r.status === status).length : all.length;

    const byActivityMap = new Map<string, { title: string; titleEn: string; total: number; pending: number; approved: number; rejected: number }>();
    const byFacultyMap = new Map<string, { faculty: string; total: number; pending: number; approved: number; rejected: number }>();

    for (const r of all) {
      const a = byActivityMap.get(r.activityId) ?? {
        id: r.activityId,
        title: r.activityTitle,
        titleEn: r.activityTitleEn,
        total: 0, pending: 0, approved: 0, rejected: 0,
      };
      a.total++;
      if (r.status === "pending") a.pending++;
      else if (r.status === "approved") a.approved++;
      else a.rejected++;
      byActivityMap.set(r.activityId, a);

      const f = r.faculty ?? "ไม่ระบุ";
      const b = byFacultyMap.get(f) ?? { faculty: f, total: 0, pending: 0, approved: 0, rejected: 0 };
      b.total++;
      if (r.status === "pending") b.pending++;
      else if (r.status === "approved") b.approved++;
      else b.rejected++;
      byFacultyMap.set(f, b);
    }

    return {
      total: countBy(),
      pending: countBy("pending"),
      approved: countBy("approved"),
      rejected: countBy("rejected"),
      byActivity: [...byActivityMap.values()],
      byFaculty: [...byFacultyMap.values()],
    };
  })

  // ===== Submission stats vs roster (staff + admin) =====
  .get("/api/stats/submission", async ({ headers, set }) => {
    const user = await getSession(headers);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const role = user.role;
    if (role !== "admin" && role !== "staff") {
      set.status = 403;
      return { error: "staff_admin_only" };
    }

    const submittedSub = db
      .selectDistinct({ studentId: requests.studentId })
      .from(requests)
      .as("submitted_students");

    const perMajor = await db
      .select({
        major: students.major,
        total: count(students.studentId).mapWith(Number),
        submitted: countDistinct(submittedSub.studentId).mapWith(Number),
      })
      .from(students)
      .leftJoin(submittedSub, eq(submittedSub.studentId, students.studentId))
      .where(eq(students.status, "active"))
      .groupBy(students.major)
      .orderBy(students.major);

    const groupRows = await db
      .selectDistinct({
        major: students.major,
        groupName: students.groupName,
      })
      .from(students)
      .where(
        and(
          eq(students.status, "active"),
          sql`${students.groupName} is not null`,
        ),
      )
      .orderBy(students.major, students.groupName);

    const groupsByMajor = new Map<string, string[]>();
    for (const g of groupRows) {
      const arr = groupsByMajor.get(g.major) ?? [];
      arr.push(g.groupName as string);
      groupsByMajor.set(g.major, arr);
    }

    const byMajor = perMajor.map((m) => ({
      major: m.major,
      total: m.total,
      submitted: m.submitted,
      notSubmitted: m.total - m.submitted,
      rate: m.total > 0 ? m.submitted / m.total : 0,
      groups: groupsByMajor.get(m.major) ?? [],
    }));

    const total = byMajor.reduce((sum, m) => sum + m.total, 0);
    const submitted = byMajor.reduce((sum, m) => sum + m.submitted, 0);
    const notSubmitted = total - submitted;
    const rate = total > 0 ? submitted / total : 0;

    return { total, submitted, notSubmitted, rate, byMajor };
  })

  // ===== Not-submitted roster list (staff + admin) =====
  .get(
    "/api/roster/not-submitted",
    async ({ headers, query, set }) => {
      const user = await getSession(headers);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      const role = user.role;
      if (role !== "admin" && role !== "staff") {
        set.status = 403;
        return { error: "staff_admin_only" };
      }

      const major = query.major?.trim() || undefined;
      const group = query.group?.trim() || undefined;
      const search = query.search?.trim() || undefined;
      const page = Math.max(1, Number(query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 50));

      const submittedSub = db
        .selectDistinct({ studentId: requests.studentId })
        .from(requests)
        .as("submitted_students");

      const conds: any[] = [
        eq(students.status, "active"),
        isNull(submittedSub.studentId),
      ];
      if (major) conds.push(eq(students.major, major));
      if (group) conds.push(eq(students.groupName, group));
      if (search) {
        const like = `%${search}%`;
        conds.push(sql`(${students.firstName} || ' ' || ${students.lastName} ILIKE ${like} OR ${students.studentId} ILIKE ${like})`);
      }

      const where = and(...conds);

      const countRes = await db
        .select({ n: sql<number>`count(*)` })
        .from(students)
        .leftJoin(submittedSub, eq(submittedSub.studentId, students.studentId))
        .where(where);

      const rows = await db
        .select({
          studentId: students.studentId,
          firstName: students.firstName,
          lastName: students.lastName,
          major: students.major,
          groupName: students.groupName,
          level: students.level,
        })
        .from(students)
        .leftJoin(submittedSub, eq(submittedSub.studentId, students.studentId))
        .where(where)
        .orderBy(students.major, students.groupName, students.studentId)
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return {
        total: Number(countRes[0]?.n ?? 0),
        page,
        pageSize,
        items: rows,
      };
    },
  );

export type App = typeof app;
