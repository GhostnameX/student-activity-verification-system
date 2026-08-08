import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { auth } from "./auth";
import { requests, activities, requestAttachments, users } from "@ua/db/schema";
import { db } from "@ua/db/client";
import { eq, and, desc, sql } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const PUBLIC_API_URL = process.env.PUBLIC_API_URL || "http://localhost:3000";
const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:5173";
const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);
const MAX_FILE_SIZE = 5 * 1024 * 1024;

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
  .get("/api/activities", async ({ set }) => {
    const list = await db
      .select()
      .from(activities)
      .orderBy(desc(activities.date));
    return list;
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
    const statusFilter = (query as any).status;

    if (role === "student") {
      const where = eq(requests.studentId, session.user.id);
      const list = await db
        .select({
          id: requests.id,
          status: requests.status,
          note: requests.note,
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
        .select({ id: activities.id })
        .from(activities)
        .where(eq(activities.id, body.activityId));
      if (activity.length === 0) {
        set.status = 400;
        return { error: "invalid_activity" };
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
  .post("/api/requests/:id/approve", async ({ params, headers, set }) => {
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

    const [updated] = await db
      .update(requests)
      .set({
        status: "approved",
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
    return updated;
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

      const [updated] = await db
        .update(requests)
        .set({
          status: "rejected",
          note: body.reason ?? null,
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
      return updated;
    },
    {
      body: t.Object({
        reason: t.Optional(t.String()),
      }),
    },
  )

  .get("/api/me", async ({ headers }) => {
    const session = await auth.api.getSession({ headers });
    if (!session?.user) return { user: null };
    return { user: session.user };
  })

  .listen({
    port: Number(process.env.PORT || process.env.API_PORT || 3000),
    hostname: "0.0.0.0",
  });

console.log(
  `🦊 API running at http://localhost:${Number(process.env.PORT || process.env.API_PORT || 3000)}`,
);

export type App = typeof app;
