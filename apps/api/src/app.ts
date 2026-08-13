import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { auth } from "./auth";
import { generateCertificatePDFForEmail } from "./certificate";
import {
  requests,
  activities,
  requestAttachments,
  users,
  notifications,
  auditLogs,
  certificateCounters,
  students,
} from "@ua/db/schema";
import { db } from "@ua/db/client";
import { eq, and, desc, sql, isNull } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

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
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(auditLogs).values({
    actorId: opts.actorId,
    action: opts.action,
    targetType: opts.targetType,
    targetId: opts.targetId,
    metadata: opts.metadata ?? null,
  }).catch((e) => console.log(`[audit] write failed: ${e}`));
}

async function notifyUser(opts: {
  userId: string;
  title: string;
  body: string;
  requestId?: string;
}) {
  await db.insert(notifications).values({
    userId: opts.userId,
    type: "request_status_change",
    title: opts.title,
    body: opts.body,
    requestId: opts.requestId ?? null,
  }).catch((e) => console.log(`[notify] insert failed: ${e}`));
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
  .mount(auth.handler)
  .get("/health", () => ({ status: "ok", ts: Date.now() }))

  // ===== Activities =====
  .get("/api/activities", async ({ query, set }) => {
    const includeInactive = (query as any).includeInactive === "true";
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
      const session = await auth.api.getSession({ headers });
      if (!session?.user?.id) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      const role = (session.user as any).role ?? "student";
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
        actorId: session.user.id,
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
      const session = await auth.api.getSession({ headers });
      if (!session?.user?.id) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      const role = (session.user as any).role ?? "student";
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
        actorId: session.user.id,
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
    const session = await auth.api.getSession({ headers });
    if (!session?.user?.id) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const role = (session.user as any).role ?? "student";
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
      actorId: session.user.id,
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
      const session = await auth.api.getSession({ headers });
      if (!session?.user?.id) {
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
    const session = await auth.api.getSession({ headers });
    if (!session?.user?.id) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const role = (session.user as any).role ?? "student";
    const statusFilter = (query as any).status as string | undefined;
    const validStatuses = ["pending", "approved", "rejected"];
    const statusWhere = statusFilter && validStatuses.includes(statusFilter)
      ? eq(requests.status, statusFilter as "pending" | "approved" | "rejected")
      : undefined;

    if (role === "student") {
      const where = and(eq(requests.studentId, session.user.id), statusWhere);
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
          id: users.id,
          name: users.name,
          email: users.email,
          faculty: users.faculty,
          studentId: users.studentId,
        },
      })
      .from(requests)
      .innerJoin(activities, eq(requests.activityId, activities.id))
      .innerJoin(users, eq(requests.studentId, users.id))
      .where(statusWhere)
      .orderBy(desc(requests.submittedAt));
    return list;
  })

  .get("/api/requests/:id", async ({ params, headers, set }) => {
    const session = await auth.api.getSession({ headers });
    if (!session?.user?.id) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const role = (session.user as any).role ?? "student";

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
          id: users.id,
          name: users.name,
          email: users.email,
          faculty: users.faculty,
          studentId: users.studentId,
        },
      })
      .from(requests)
      .innerJoin(activities, eq(requests.activityId, activities.id))
      .innerJoin(users, eq(requests.studentId, users.id))
      .where(eq(requests.id, params.id));

    if (result.length === 0) {
      set.status = 404;
      return { error: "not_found" };
    }

    const req = result[0];
    if (role === "student" && req.student.id !== session.user.id) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const attachments = await db
      .select()
      .from(requestAttachments)
      .where(eq(requestAttachments.requestId, params.id));

    return { ...req, attachments };
  })

  .post(
    "/api/requests",
    async ({ body, headers, set }) => {
      const session = await auth.api.getSession({ headers });
      if (!session?.user?.id) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      const role = (session.user as any).role ?? "student";
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

      const [created] = await db
        .insert(requests)
        .values({
          studentId: session.user.id,
          activityId: body.activityId,
          status: "pending",
          note: body.note ?? null,
        })
        .returning();

      if (body.attachments && body.attachments.length > 0) {
        await db.insert(requestAttachments).values(
          body.attachments.map((a) => ({
            requestId: created.id,
            fileName: a.fileName,
            fileType: a.fileType,
            fileSize: a.fileSize,
            storagePath: a.storagePath,
          })),
        );
      }

      return { id: created.id, status: created.status };
    },
    {
      body: t.Object({
        activityId: t.String(),
        note: t.Optional(t.String()),
        attachments: t.Optional(
          t.Array(
            t.Object({
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
      const session = await auth.api.getSession({ headers });
      if (!session?.user?.id) {
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
      if (req.studentId !== session.user.id) {
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
    const session = await auth.api.getSession({ headers });
    if (!session?.user?.id) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const role = (session.user as any).role ?? "student";
    if (role !== "staff" && role !== "admin") {
      set.status = 403;
      return { error: "staff_only" };
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
          activityName: body.activityName ?? null,
          reviewedById: session.user.id,
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
      return { ...row, requestNumber };
    });
    if (!approved) {
      set.status = 400;
      return { error: "already_reviewed" };
    }

    const detail = await db
      .select({
        studentId: requests.studentId,
        studentName: users.name,
        studentEmail: users.email,
        studentFaculty: users.faculty,
        studentCode: users.studentId,
        studentPhone: users.phone,
        activityTitle: activities.title,
        activityTitleEn: activities.titleEn,
        activityName: requests.activityName,
      })
      .from(requests)
      .innerJoin(users, eq(requests.studentId, users.id))
      .innerJoin(activities, eq(requests.activityId, activities.id))
      .where(eq(requests.id, params.id));

    if (detail.length > 0) {
      const d = detail[0];
      const displayTitle = d.activityName ?? d.activityTitle;
      await notifyUser({
        userId: d.studentId,
        title: "คำร้องได้รับการอนุมัติ",
        body: `คำร้องเข้าร่วม "${displayTitle}" ของคุณได้รับการอนุมัติแล้ว`,
        requestId: params.id,
      });
      await writeAuditLog({
        actorId: session.user.id,
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

      await sendStatusEmail({
        to: d.studentEmail,
        studentName: d.studentName,
        activityTitle: displayTitle,
        status: "approved",
        attachments: attachment ? [attachment] : undefined,
      });
    }
    return approved;
  },
  {
    body: t.Object({
      activityName: t.Optional(t.String()),
    }),
  })

  .post(
    "/api/requests/:id/reject",
    async ({ params, body, headers, set }) => {
      const session = await auth.api.getSession({ headers });
      if (!session?.user?.id) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      const role = (session.user as any).role ?? "student";
      if (role !== "staff" && role !== "admin") {
        set.status = 403;
        return { error: "staff_only" };
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
          activityName: body.activityName ?? null,
          reviewedById: session.user.id,
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
          studentName: users.name,
          studentEmail: users.email,
          activityTitle: activities.title,
          activityTitleEn: activities.titleEn,
          activityName: requests.activityName,
        })
        .from(requests)
        .innerJoin(users, eq(requests.studentId, users.id))
        .innerJoin(activities, eq(requests.activityId, activities.id))
        .where(eq(requests.id, params.id));

      if (detail.length > 0) {
        const d = detail[0];
        const displayTitle = d.activityName ?? d.activityTitle;
        await notifyUser({
          userId: d.studentId,
          title: "คำร้องถูกไม่อนุมัติ",
          body: `คำร้องเข้าร่วม "${displayTitle}" ของคุณถูกไม่อนุมัติ${body.reason ? `\nเหตุผล: ${body.reason}` : ""}`,
          requestId: params.id,
        });
        await writeAuditLog({
          actorId: session.user.id,
          action: "reject",
          targetType: "request",
          targetId: params.id,
          metadata: { status: "rejected", reason: body.reason ?? null, activityName: d.activityName ?? null },
        });
        await sendStatusEmail({
          to: d.studentEmail,
          studentName: d.studentName,
          activityTitle: displayTitle,
          status: "rejected",
          reason: body.reason,
        });
      }
      return updated;
    },
    {
      body: t.Object({
        reason: t.Optional(t.String()),
        activityName: t.Optional(t.String()),
      }),
    },
  )

  .get("/api/me", async ({ headers }) => {
    const session = await auth.api.getSession({ headers });
    if (!session?.user) return { user: null };
    const [me] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        faculty: users.faculty,
        studentId: users.studentId,
        phone: users.phone,
      })
      .from(users)
      .where(eq(users.id, session.user.id));
    if (!me) return { user: null };
    return { user: me };
  })

  .patch(
    "/api/me",
    async ({ headers, body, set }) => {
      const session = await auth.api.getSession({ headers });
      if (!session?.user?.id) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      const raw = (body.phone ?? "").trim();
      if (raw !== "") {
        const digits = raw.replace(/[-\s]/g, "");
        if (!/^\d{9,10}$/.test(digits)) {
          set.status = 400;
          return { error: "invalid_phone" };
        }
      }
      const phone = raw === "" ? null : raw;
      await db
        .update(users)
        .set({ phone, updatedAt: sql`now()` })
        .where(eq(users.id, session.user.id));
      return { phone };
    },
    {
      body: t.Object({
        phone: t.Optional(t.String()),
      }),
    },
  )

  // ===== Notifications =====
  .get("/api/notifications", async ({ headers, set }) => {
    const session = await auth.api.getSession({ headers });
    if (!session?.user?.id) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    return await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, session.user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
  })

  .post("/api/notifications/:id/read", async ({ params, headers, set }) => {
    const session = await auth.api.getSession({ headers });
    if (!session?.user?.id) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const [updated] = await db
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(
        and(
          eq(notifications.id, params.id),
          eq(notifications.userId, session.user.id),
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
    const session = await auth.api.getSession({ headers });
    if (!session?.user?.id) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    await db
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(
        and(
          eq(notifications.userId, session.user.id),
          isNull(notifications.readAt),
        ),
      );
    return { ok: true };
  })

  // ===== Audit log (admin only) =====
  .get("/api/audit", async ({ headers, set }) => {
    const session = await auth.api.getSession({ headers });
    if (!session?.user?.id) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const role = (session.user as any).role ?? "student";
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

  // ===== Stats (admin only) =====
  .get("/api/stats", async ({ headers, set }) => {
    const session = await auth.api.getSession({ headers });
    if (!session?.user?.id) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const role = (session.user as any).role ?? "student";
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
        faculty: users.faculty,
      })
      .from(requests)
      .innerJoin(activities, eq(requests.activityId, activities.id))
      .innerJoin(users, eq(requests.studentId, users.id));

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
    const session = await auth.api.getSession({ headers });
    if (!session?.user?.id) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const role = (session.user as any).role ?? "student";
    if (role !== "admin" && role !== "staff") {
      set.status = 403;
      return { error: "staff_admin_only" };
    }

    const eligible = await db
      .select({
        studentId: students.studentId,
        major: students.major,
      })
      .from(students)
      .where(eq(students.status, "active"));

    const submittedRows = await db
      .selectDistinct({ studentId: users.studentId })
      .from(requests)
      .innerJoin(users, eq(requests.studentId, users.id))
      .where(sql`${users.studentId} is not null`);
    const submittedSet = new Set(
      submittedRows.map((r) => r.studentId as string),
    );

    const byMajorMap = new Map<
      string,
      { major: string; total: number; submitted: number }
    >();
    for (const s of eligible) {
      const m = byMajorMap.get(s.major) ?? {
        major: s.major,
        total: 0,
        submitted: 0,
      };
      m.total++;
      if (submittedSet.has(s.studentId)) m.submitted++;
      byMajorMap.set(s.major, m);
    }

    const submitted = eligible.filter((s) =>
      submittedSet.has(s.studentId),
    ).length;
    const total = eligible.length;
    const notSubmitted = total - submitted;
    const rate = total > 0 ? submitted / total : 0;

    return {
      total,
      submitted,
      notSubmitted,
      rate,
      byMajor: [...byMajorMap.values()].map((m) => ({
        ...m,
        notSubmitted: m.total - m.submitted,
        rate: m.total > 0 ? m.submitted / m.total : 0,
      })),
    };
  })

  // ===== Not-submitted roster list (staff + admin) =====
  .get(
    "/api/roster/not-submitted",
    async ({ headers, query, set }) => {
      const session = await auth.api.getSession({ headers });
      if (!session?.user?.id) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      const role = (session.user as any).role ?? "student";
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
        .select({ studentId: users.studentId })
        .from(requests)
        .innerJoin(users, eq(requests.studentId, users.id))
        .where(sql`${users.studentId} is not null`)
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
