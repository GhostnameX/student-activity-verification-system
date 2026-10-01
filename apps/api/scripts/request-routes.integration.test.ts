/**
 * Request routes × role integration tests (audit S-6).
 *
 * Runs against the throwaway database `ua_roster_test` through the
 * `test:requests` wrapper (apps/api/scripts/with-test-db.ts), exactly like the
 * roster tests: only `TEST_DATABASE_URL` from `apps/api/.env.test.local` is
 * loaded, `DATABASE_URL` is blanked, and the fixture setup refuses to run unless
 * the connection is loopback:8520/ua_roster_test.
 *
 * Prepare / run:
 *   bun run --cwd packages/db testdb:roster-setup
 *   bun run --cwd apps/api test:requests
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";

const TEST_DATABASE = "ua_roster_test";
const TEST_DATABASE_PORT = 8520;
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1"]);
const ORIGIN = "https://kingplapow.com";

if (process.env.ROSTER_TEST !== "1") {
  throw new Error("request integration tests must run through the test:requests wrapper");
}
process.env.NODE_ENV = "development";
process.env.WEB_ORIGIN = ORIGIN;
process.env.GOOGLE_CLIENT_ID = "requests-test-client";
process.env.GOOGLE_CLIENT_SECRET = "requests-test-secret";
process.env.GOOGLE_HD = "psru.ac.th";
// No outbound email in tests, even if the developer shell has a key.
delete process.env.RESEND_API_KEY;

const { app } = await import("../src/app");
const { db, pool } = await import("@ua/db/client");
const {
  auditLogs,
  notifications,
  requestAttachmentRevisions,
  requestAttachments,
  requests,
  sessions,
  staff,
  students,
} = await import("@ua/db/schema");

// --- HTTP helper ------------------------------------------------------------

interface ApiResult {
  status: number;
  body: any;
}

async function api(
  method: string,
  path: string,
  options: { cookie?: string; body?: unknown } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await app.handle(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  );
  const text = await response.text();
  let body: any = text;
  if (text !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
}

async function makeSession(userId: string, role: "student" | "staff" | "admin"): Promise<string> {
  const id = randomUUID();
  await db.insert(sessions).values({
    id,
    userId,
    authMethod: role === "student" ? "google" : "password",
    role,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return `ua_session=${id}`;
}

// --- fixtures ---------------------------------------------------------------

const STAFF_ID = "rr-staff";
const STAFF2_ID = "rr-staff-2";
const ADMIN_ID = "rr-admin";
const STUDENT_A = "6503000001";
const STUDENT_B = "6503000002";

let staffCookie = "";
let admin = "";
let studentA = "";
let studentB = "";

// Students have no email so approve never tries to render/send a certificate.
const SEED_STUDENTS = [
  { studentId: STUDENT_A, firstName: "เอ", lastName: "ทดสอบ", major: "วิศวกรรมคอมพิวเตอร์", admissionYear: 2567, status: "active" as const, email: null, phone: null },
  { studentId: STUDENT_B, firstName: "บี", lastName: "ทดสอบ", major: "วิศวกรรมคอมพิวเตอร์", admissionYear: 2567, status: "active" as const, email: null, phone: null },
];

interface SeededRequest {
  id: string;
  attachmentId: string;
  revisionId: string;
}

/** Insert a request with one slot-1 attachment (one revision) straight into the DB. */
async function seedRequest(
  studentId: string,
  status: "pending" | "approved" | "rejected" | "revision_required" = "pending",
): Promise<SeededRequest> {
  const id = `rr-req-${randomUUID()}`;
  const attachmentId = `rr-att-${randomUUID()}`;
  await db.insert(requests).values({ id, studentId, status, note: "note" });
  await db.insert(requestAttachments).values({
    id: attachmentId,
    requestId: id,
    slot: 1,
    fileName: "proof.pdf",
    fileType: "application/pdf",
    fileSize: 1234,
    storagePath: `requests/${randomUUID()}.pdf`,
  });
  const [rev] = await db
    .insert(requestAttachmentRevisions)
    .values({
      attachmentId,
      revisionNumber: 1,
      fileName: "proof.pdf",
      fileType: "application/pdf",
      fileSize: 1234,
      storagePath: `requests/${randomUUID()}.pdf`,
    })
    .returning({ id: requestAttachmentRevisions.id });
  await db
    .update(requestAttachments)
    .set({ currentRevisionId: rev.id })
    .where(eq(requestAttachments.id, attachmentId));
  return { id, attachmentId, revisionId: rev.id };
}

async function statusOf(id: string): Promise<string> {
  const [row] = await db.select({ status: requests.status }).from(requests).where(eq(requests.id, id));
  return row.status;
}

beforeAll(async () => {
  const identity = await pool.query<{
    database: string;
    serverAddress: string | null;
    serverPort: number | null;
  }>(`
    select
      current_database() as database,
      host(inet_server_addr()) as "serverAddress",
      inet_server_port() as "serverPort"
  `);
  const actual = identity.rows[0];
  if (
    !actual ||
    actual.database !== TEST_DATABASE ||
    actual.serverAddress === null ||
    !LOOPBACK_ADDRESSES.has(actual.serverAddress) ||
    Number(actual.serverPort) !== TEST_DATABASE_PORT
  ) {
    const display = actual
      ? `${actual.serverAddress ?? "unknown"}:${actual.serverPort ?? "unknown"}/${actual.database}`
      : "unknown";
    throw new Error(
      `[test-db] REFUSED destructive fixture: actual database is ${display}; expected loopback:${TEST_DATABASE_PORT}/${TEST_DATABASE}`,
    );
  }

  await db.execute(sql`
    TRUNCATE students, staff, sessions, audit_logs, requests, request_attachments,
      request_attachment_revisions, attachment_uploads, notifications CASCADE
  `);

  const placeholderHash = "$argon2id$v=19$m=1,t=1,p=1$placeholder$placeholder";
  await db.insert(staff).values([
    { id: STAFF_ID, staffCode: "RRSTAFF", passwordHash: placeholderHash, role: "staff", fullName: "เจ้าหน้าที่ทดสอบ" },
    { id: STAFF2_ID, staffCode: "RRSTAFF2", passwordHash: placeholderHash, role: "staff", fullName: "เจ้าหน้าที่ทดสอบ สอง" },
    { id: ADMIN_ID, staffCode: "RRADMIN", passwordHash: placeholderHash, role: "admin", fullName: "ผู้ดูแลทดสอบ" },
  ]);
  await db.insert(students).values(SEED_STUDENTS);

  staffCookie = await makeSession(STAFF_ID, "staff");
  admin = await makeSession(ADMIN_ID, "admin");
  studentA = await makeSession(STUDENT_A, "student");
  studentB = await makeSession(STUDENT_B, "student");
});

afterAll(async () => {
  await pool.end();
});

// --- 1. unauthenticated ------------------------------------------------------

describe("requests routes without a session", () => {
  test("every request route answers 401", async () => {
    const r = await seedRequest(STUDENT_A);
    const cases: Array<[string, string, unknown?]> = [
      ["GET", "/api/requests"],
      ["GET", `/api/requests/${r.id}`],
      ["GET", `/api/attachments/${r.attachmentId}/signed-url`],
      ["POST", "/api/requests", { attachments: [] }],
      ["PATCH", `/api/requests/${r.id}`, { note: "x" }],
      ["POST", `/api/requests/${r.id}/approve`],
      ["POST", `/api/requests/${r.id}/reject`, {}],
      ["POST", `/api/requests/${r.id}/request-revision`, { slots: [1] }],
      ["POST", `/api/requests/${r.id}/resubmit`, {}],
    ];
    for (const [method, path, body] of cases) {
      const res = await api(method, path, { body });
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 401 });
    }
  });
});

// --- 2. read access ----------------------------------------------------------

describe("GET /api/requests", () => {
  test("a student sees only their own requests", async () => {
    const mine = await seedRequest(STUDENT_A);
    const theirs = await seedRequest(STUDENT_B);

    const res = await api("GET", "/api/requests", { cookie: studentA });
    expect(res.status).toBe(200);
    const ids = res.body.map((r: any) => r.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    // A student never receives the reviewer-only fields.
    for (const row of res.body) {
      expect(row.student).toBeUndefined();
    }
  });

  test("an admin sees every request with the student attached", async () => {
    const a = await seedRequest(STUDENT_A);
    const b = await seedRequest(STUDENT_B);

    const res = await api("GET", "/api/requests", { cookie: admin });
    expect(res.status).toBe(200);
    const ids = res.body.map((r: any) => r.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(res.body.find((r: any) => r.id === a.id).student.studentId).toBe(STUDENT_A);
  });

  test("staff is refused with 403 (current behaviour, changes with staff read access)", async () => {
    const res = await api("GET", "/api/requests", { cookie: staffCookie });
    expect({ status: res.status, error: res.body.error }).toEqual({
      status: 403,
      error: "staff_cannot_access",
    });
  });
});

describe("GET /api/requests/:id", () => {
  test("owner and admin can read; another student cannot", async () => {
    const r = await seedRequest(STUDENT_A);

    const owner = await api("GET", `/api/requests/${r.id}`, { cookie: studentA });
    expect(owner.status).toBe(200);
    expect(owner.body.attachments).toHaveLength(1);
    expect(owner.body.attachments[0].revisions).toHaveLength(1);

    const adminRes = await api("GET", `/api/requests/${r.id}`, { cookie: admin });
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.student.studentId).toBe(STUDENT_A);

    const other = await api("GET", `/api/requests/${r.id}`, { cookie: studentB });
    expect({ status: other.status, error: other.body.error }).toEqual({ status: 403, error: "forbidden" });
  });

  test("unknown id is 404", async () => {
    const res = await api("GET", "/api/requests/does-not-exist", { cookie: admin });
    expect(res.status).toBe(404);
  });

  test("staff is refused with 403 (current behaviour, changes with staff read access)", async () => {
    const r = await seedRequest(STUDENT_A);
    const res = await api("GET", `/api/requests/${r.id}`, { cookie: staffCookie });
    expect({ status: res.status, error: res.body.error }).toEqual({
      status: 403,
      error: "staff_cannot_access",
    });
  });
});

describe("GET /api/attachments/:id/signed-url", () => {
  test("owner and admin get a URL; another student is refused", async () => {
    const r = await seedRequest(STUDENT_A);
    const path = `/api/attachments/${r.attachmentId}/signed-url`;

    const owner = await api("GET", path, { cookie: studentA });
    expect(owner.status).toBe(200);
    expect(typeof owner.body.url).toBe("string");

    const adminRes = await api("GET", `${path}?revisionId=${r.revisionId}`, { cookie: admin });
    expect(adminRes.status).toBe(200);

    const other = await api("GET", path, { cookie: studentB });
    expect({ status: other.status, error: other.body.error }).toEqual({ status: 403, error: "forbidden" });
  });

  test("a revision id from another attachment is not served", async () => {
    const a = await seedRequest(STUDENT_A);
    const b = await seedRequest(STUDENT_B);
    const res = await api("GET", `/api/attachments/${a.attachmentId}/signed-url?revisionId=${b.revisionId}`, {
      cookie: admin,
    });
    expect({ status: res.status, error: res.body.error }).toEqual({
      status: 404,
      error: "attachment_revision_not_found",
    });
  });

  test("staff is refused with 403 (current behaviour, changes with staff read access)", async () => {
    const r = await seedRequest(STUDENT_A);
    const res = await api("GET", `/api/attachments/${r.attachmentId}/signed-url`, { cookie: staffCookie });
    expect({ status: res.status, error: res.body.error }).toEqual({
      status: 403,
      error: "staff_cannot_access",
    });
  });
});

// --- 3. write access ---------------------------------------------------------

describe("creating and editing a request", () => {
  test("only students may create; staff and admin get 403 only_students", async () => {
    for (const cookie of [staffCookie, admin]) {
      const res = await api("POST", "/api/requests", { cookie, body: { attachments: [] } });
      expect({ status: res.status, error: res.body.error }).toEqual({ status: 403, error: "only_students" });
    }
  });

  test("PATCH is owner-only and pending-only", async () => {
    const r = await seedRequest(STUDENT_A);

    const other = await api("PATCH", `/api/requests/${r.id}`, { cookie: studentB, body: { note: "x" } });
    expect(other.status).toBe(403);

    // staff/admin are not the owner, so they are refused too
    for (const cookie of [staffCookie, admin]) {
      const res = await api("PATCH", `/api/requests/${r.id}`, { cookie, body: { note: "x" } });
      expect(res.status).toBe(403);
    }

    const ok = await api("PATCH", `/api/requests/${r.id}`, { cookie: studentA, body: { note: "updated" } });
    expect(ok.status).toBe(200);
    expect(ok.body.note).toBe("updated");

    const done = await seedRequest(STUDENT_A, "approved");
    const late = await api("PATCH", `/api/requests/${done.id}`, { cookie: studentA, body: { note: "x" } });
    expect({ status: late.status, error: late.body.error }).toEqual({ status: 400, error: "already_reviewed" });
  });
});

// --- 4. decision routes ------------------------------------------------------

describe("decision routes are admin-only", () => {
  test("student and staff get 403 admin_only and the status never moves", async () => {
    const r = await seedRequest(STUDENT_A);
    const cases: Array<[string, unknown]> = [
      [`/api/requests/${r.id}/approve`, undefined],
      [`/api/requests/${r.id}/reject`, { reason: "no" }],
      [`/api/requests/${r.id}/request-revision`, { slots: [1] }],
    ];
    for (const cookie of [studentA, staffCookie]) {
      for (const [path, body] of cases) {
        const res = await api("POST", path, { cookie, body });
        expect({ path, status: res.status, error: res.body.error }).toEqual({
          path,
          status: 403,
          error: "admin_only",
        });
      }
    }
    expect(await statusOf(r.id)).toBe("pending");
    const [row] = await db.select().from(requests).where(eq(requests.id, r.id));
    expect(row.reviewedById).toBeNull();
    expect(row.reviewedAt).toBeNull();
  });

  test("resubmit is student-only: staff and admin get 403 only_students", async () => {
    const r = await seedRequest(STUDENT_A, "revision_required");
    for (const cookie of [staffCookie, admin]) {
      const res = await api("POST", `/api/requests/${r.id}/resubmit`, { cookie, body: {} });
      expect({ status: res.status, error: res.body.error }).toEqual({ status: 403, error: "only_students" });
    }
    const other = await api("POST", `/api/requests/${r.id}/resubmit`, { cookie: studentB, body: {} });
    expect({ status: other.status, error: other.body.error }).toEqual({ status: 403, error: "forbidden" });
  });
});

describe("state machine", () => {
  test("admin approve: pending → approved, audit + notification written, second approve is 400", async () => {
    const r = await seedRequest(STUDENT_A);
    const ok = await api("POST", `/api/requests/${r.id}/approve`, { cookie: admin });
    expect(ok.status).toBe(200);
    expect(await statusOf(r.id)).toBe("approved");

    const [row] = await db.select().from(requests).where(eq(requests.id, r.id));
    expect(row.reviewedById).toBe(ADMIN_ID);
    expect(row.reviewedAt).not.toBeNull();
    expect(row.certificateNumber).not.toBeNull();

    const [rev] = await db
      .select()
      .from(requestAttachmentRevisions)
      .where(eq(requestAttachmentRevisions.id, r.revisionId));
    expect(rev.revisionState).toBe("approved");

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.targetId, r.id));
    expect(audits.map((a) => a.action)).toEqual(["approve"]);
    const notes = await db.select().from(notifications).where(eq(notifications.requestId, r.id));
    expect(notes).toHaveLength(1);
    expect(notes[0].studentId).toBe(STUDENT_A);

    const again = await api("POST", `/api/requests/${r.id}/approve`, { cookie: admin });
    expect({ status: again.status, error: again.body.error }).toEqual({ status: 400, error: "already_reviewed" });
  });

  test("approve / reject / request-revision all refuse non-pending requests", async () => {
    for (const status of ["approved", "rejected", "revision_required"] as const) {
      const r = await seedRequest(STUDENT_A, status);
      const approve = await api("POST", `/api/requests/${r.id}/approve`, { cookie: admin });
      expect({ status, route: "approve", code: approve.status }).toEqual({ status, route: "approve", code: 400 });
      const reject = await api("POST", `/api/requests/${r.id}/reject`, { cookie: admin, body: {} });
      expect({ status, route: "reject", code: reject.status }).toEqual({ status, route: "reject", code: 400 });
      const revise = await api("POST", `/api/requests/${r.id}/request-revision`, {
        cookie: admin,
        body: { slots: [1] },
      });
      expect({ status, route: "revise", code: revise.status }).toEqual({ status, route: "revise", code: 400 });
      expect(await statusOf(r.id)).toBe(status);
    }
  });

  test("request-revision flags the slot and resubmit is refused until the file is replaced", async () => {
    const r = await seedRequest(STUDENT_A);
    const flag = await api("POST", `/api/requests/${r.id}/request-revision`, {
      cookie: admin,
      body: { slots: [1] },
    });
    expect(flag.status).toBe(200);
    expect(await statusOf(r.id)).toBe("revision_required");

    const [rev] = await db
      .select()
      .from(requestAttachmentRevisions)
      .where(eq(requestAttachmentRevisions.id, r.revisionId));
    expect(rev.revisionState).toBe("needs_revision");

    const early = await api("POST", `/api/requests/${r.id}/resubmit`, { cookie: studentA, body: {} });
    expect({ status: early.status, error: early.body.error }).toEqual({
      status: 400,
      error: "flagged_slots_not_replaced",
    });
    expect(await statusOf(r.id)).toBe("revision_required");
  });

  test("resubmit on a pending request is 400 not_revision_required", async () => {
    const r = await seedRequest(STUDENT_A);
    const res = await api("POST", `/api/requests/${r.id}/resubmit`, { cookie: studentA, body: {} });
    expect({ status: res.status, error: res.body.error }).toEqual({
      status: 400,
      error: "not_revision_required",
    });
  });
});
