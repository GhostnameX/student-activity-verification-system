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
  attachmentUploads,
  auditLogs,
  notifications,
  requestAttachmentRevisions,
  requestAttachments,
  requestRevisionNotes,
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

  test("staff can read the reviewer list but gets no student email (round 2, D1)", async () => {
    const r = await seedRequest(STUDENT_A);
    const res = await api("GET", "/api/requests", { cookie: staffCookie });
    expect(res.status).toBe(200);
    const row = res.body.find((x: any) => x.id === r.id);
    expect(row.student.studentId).toBe(STUDENT_A);
    expect(row.student.email).toBeNull();
    expect(row.staffCheckedAt).toBeNull();
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

  test("staff can read the detail and its attachments, read-only (round 2, D1)", async () => {
    const r = await seedRequest(STUDENT_A);
    const res = await api("GET", `/api/requests/${r.id}`, { cookie: staffCookie });
    expect(res.status).toBe(200);
    expect(res.body.attachments).toHaveLength(1);
    expect(res.body.student.email).toBeNull();
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

  test("staff can get a signed URL (round 2, D1)", async () => {
    const r = await seedRequest(STUDENT_A);
    const res = await api("GET", `/api/attachments/${r.attachmentId}/signed-url?revisionId=${r.revisionId}`, {
      cookie: staffCookie,
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.url).toBe("string");
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
        body: { slots: [1], note: "ขาดหลักฐานหน้า 1" },
      });
      expect({ status, route: "revise", code: revise.status }).toEqual({ status, route: "revise", code: 400 });
      expect(await statusOf(r.id)).toBe(status);
    }
  });

  test("request-revision flags the slot and resubmit is refused until the file is replaced", async () => {
    const r = await seedRequest(STUDENT_A);
    const flag = await api("POST", `/api/requests/${r.id}/request-revision`, {
      cookie: admin,
      body: { slots: [1], note: "ขาดหลักฐานหน้า 1" },
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

  test("request-revision without a note, or with a blank note, is 400 and changes nothing", async () => {
    const r = await seedRequest(STUDENT_A);
    for (const body of [{ slots: [1] }, { slots: [1], note: "" }, { slots: [1], note: "   " }, { slots: [1], note: "   " }]) {
      const res = await api("POST", `/api/requests/${r.id}/request-revision`, { cookie: admin, body });
      expect({ status: res.status, error: res.body.error }).toEqual({ status: 400, error: "note_required" });
    }
    expect(await statusOf(r.id)).toBe("pending");
    expect(await db.select().from(requestRevisionNotes).where(eq(requestRevisionNotes.requestId, r.id))).toHaveLength(0);
  });

  test("a note longer than 1000 characters is 400; exactly 1000 (after trimming) is accepted", async () => {
    const tooLong = await seedRequest(STUDENT_A);
    const res = await api("POST", `/api/requests/${tooLong.id}/request-revision`, {
      cookie: admin,
      body: { slots: [1], note: "ก".repeat(1001) },
    });
    expect({ status: res.status, error: res.body.error }).toEqual({ status: 400, error: "note_too_long" });
    expect(await statusOf(tooLong.id)).toBe("pending");

    const edge = await seedRequest(STUDENT_A);
    const ok = await api("POST", `/api/requests/${edge.id}/request-revision`, {
      cookie: admin,
      body: { slots: [1], note: `  ${"ก".repeat(1000)}  ` },
    });
    expect(ok.status).toBe(200);
    const [row] = await db.select().from(requestRevisionNotes).where(eq(requestRevisionNotes.requestId, edge.id));
    expect(row.note).toHaveLength(1000);
  });

  test("a successful revision stores the note, flags the slots and notifies the student with the reason", async () => {
    const r = await seedRequest(STUDENT_A);
    const res = await api("POST", `/api/requests/${r.id}/request-revision`, {
      cookie: admin,
      body: { slots: [1], note: "  รูปไม่ชัด กรุณาถ่ายใหม่  " },
    });
    expect(res.status).toBe(200);
    expect(await statusOf(r.id)).toBe("revision_required");

    const rows = await db.select().from(requestRevisionNotes).where(eq(requestRevisionNotes.requestId, r.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBe("รูปไม่ชัด กรุณาถ่ายใหม่");
    expect(rows[0].slots).toEqual([1]);
    expect(rows[0].authorStaffId).toBe(ADMIN_ID);

    const notes = await db.select().from(notifications).where(eq(notifications.requestId, r.id));
    expect(notes).toHaveLength(1);
    expect(notes[0].studentId).toBe(STUDENT_A);
    expect(notes[0].title).toBe("คำร้องต้องแก้ไขเอกสาร");
    expect(notes[0].body).toContain("รูปไม่ชัด กรุณาถ่ายใหม่");

    const audit = await db.select().from(auditLogs).where(eq(auditLogs.targetId, r.id));
    expect(audit.some((a) => a.action === "request_revision")).toBe(true);
  });

  test("GET detail returns the note history newest first; author name only for staff/admin; other students get 403", async () => {
    const r = await seedRequest(STUDENT_A);
    await db.insert(requestRevisionNotes).values([
      { requestId: r.id, authorStaffId: ADMIN_ID, note: "รอบแรก", slots: [1], createdAt: new Date("2026-10-01T01:00:00Z") },
      { requestId: r.id, authorStaffId: ADMIN_ID, note: "รอบสอง", slots: [1, 2], createdAt: new Date("2026-10-02T01:00:00Z") },
    ]);

    const asAdmin = await api("GET", `/api/requests/${r.id}`, { cookie: admin });
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.revisionNotes.map((n: any) => n.note)).toEqual(["รอบสอง", "รอบแรก"]);
    expect(asAdmin.body.revisionNotes[0].authorName).toBeTruthy();

    const asStaff = await api("GET", `/api/requests/${r.id}`, { cookie: staffCookie });
    expect(asStaff.status).toBe(200);
    expect(asStaff.body.revisionNotes).toHaveLength(2);
    expect(asStaff.body.revisionNotes[0].authorName).toBeTruthy();

    const asOwner = await api("GET", `/api/requests/${r.id}`, { cookie: studentA });
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.revisionNotes.map((n: any) => n.note)).toEqual(["รอบสอง", "รอบแรก"]);
    for (const n of asOwner.body.revisionNotes) expect(n.authorName).toBeNull();
    expect(JSON.stringify(asOwner.body)).not.toContain("authorStaffId");

    // the student's list carries the latest reason only, with no author
    await db.update(requests).set({ status: "revision_required" }).where(eq(requests.id, r.id));
    const list = await api("GET", "/api/requests", { cookie: studentA });
    const mine = list.body.find((x: any) => x.id === r.id);
    expect(mine.latestRevisionNote.note).toBe("รอบสอง");
    expect(mine.latestRevisionNote.slots).toEqual([1, 2]);
    expect(JSON.stringify(mine.latestRevisionNote)).not.toContain("author");

    const asOther = await api("GET", `/api/requests/${r.id}`, { cookie: studentB });
    expect(asOther.status).toBe(403);
    expect(JSON.stringify(asOther.body)).not.toContain("รอบสอง");
  });

  test("a staff session still cannot call request-revision (403), even with a note", async () => {
    const r = await seedRequest(STUDENT_A);
    const res = await api("POST", `/api/requests/${r.id}/request-revision`, {
      cookie: staffCookie,
      body: { slots: [1], note: "ลองส่งเอง" },
    });
    expect({ status: res.status, error: res.body.error }).toEqual({ status: 403, error: "admin_only" });
    expect(await statusOf(r.id)).toBe("pending");
    expect(await db.select().from(requestRevisionNotes).where(eq(requestRevisionNotes.requestId, r.id))).toHaveLength(0);
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

// --- 5. staff document check (round 2, D1-D5) --------------------------------

describe("POST /api/requests/:id/staff-check", () => {
  test("staff check on a pending request sets the columns and nothing else", async () => {
    const r = await seedRequest(STUDENT_A);
    const [before] = await db.select().from(requests).where(eq(requests.id, r.id));

    const res = await api("POST", `/api/requests/${r.id}/staff-check`, { cookie: staffCookie });
    expect(res.status).toBe(200);
    expect(res.body.staffCheckedAt).toBeTruthy();

    const [after] = await db.select().from(requests).where(eq(requests.id, r.id));
    expect(after.staffCheckedAt).not.toBeNull();
    expect(after.staffCheckedById).toBe(STAFF_ID);
    // the admin decision and everything else is untouched
    expect(after.status).toBe("pending");
    expect(after.reviewedAt).toBeNull();
    expect(after.reviewedById).toBeNull();
    expect(after.certificateNumber).toBeNull();
    expect(after.requestSequence).toBe(before.requestSequence);
    const [rev] = await db
      .select()
      .from(requestAttachmentRevisions)
      .where(eq(requestAttachmentRevisions.id, r.revisionId));
    expect(rev.revisionState).toBe("unchanged");
  });

  test("writes a staff_check audit row and notifies the owning student only", async () => {
    const r = await seedRequest(STUDENT_B);
    const res = await api("POST", `/api/requests/${r.id}/staff-check`, { cookie: staffCookie });
    expect(res.status).toBe(200);

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.targetId, r.id));
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("staff_check");
    expect(audits[0].actorStaffId).toBe(STAFF_ID);

    const notes = await db.select().from(notifications).where(eq(notifications.requestId, r.id));
    expect(notes).toHaveLength(1);
    expect(notes[0].studentId).toBe(STUDENT_B);
    expect(notes[0].staffId).toBeNull();
    expect(notes[0].title).toBe("เจ้าหน้าที่ตรวจสอบเอกสารแล้ว");
  });

  test("a second check is 409 even from another staff member, and keeps the first checker", async () => {
    const r = await seedRequest(STUDENT_A);
    expect((await api("POST", `/api/requests/${r.id}/staff-check`, { cookie: staffCookie })).status).toBe(200);

    const staff2Cookie = await makeSession(STAFF2_ID, "staff");
    for (const cookie of [staffCookie, staff2Cookie]) {
      const again = await api("POST", `/api/requests/${r.id}/staff-check`, { cookie });
      expect({ status: again.status, error: again.body.error }).toEqual({ status: 409, error: "already_checked" });
    }
    const [row] = await db.select().from(requests).where(eq(requests.id, r.id));
    expect(row.staffCheckedById).toBe(STAFF_ID);
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.targetId, r.id));
    expect(audits).toHaveLength(1);
  });

  test("concurrent checks: exactly one wins", async () => {
    const r = await seedRequest(STUDENT_A);
    const staff2Cookie = await makeSession(STAFF2_ID, "staff");
    const results = await Promise.all([
      api("POST", `/api/requests/${r.id}/staff-check`, { cookie: staffCookie }),
      api("POST", `/api/requests/${r.id}/staff-check`, { cookie: staff2Cookie }),
    ]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
  });

  test("non-pending requests are 400 not_pending and stay unchecked", async () => {
    for (const status of ["approved", "rejected", "revision_required"] as const) {
      const r = await seedRequest(STUDENT_A, status);
      const res = await api("POST", `/api/requests/${r.id}/staff-check`, { cookie: staffCookie });
      expect({ status, code: res.status, error: res.body.error }).toEqual({
        status,
        code: 400,
        error: "not_pending",
      });
      const [row] = await db.select().from(requests).where(eq(requests.id, r.id));
      expect(row.staffCheckedAt).toBeNull();
    }
  });

  test("unknown id is 404", async () => {
    const res = await api("POST", "/api/requests/does-not-exist/staff-check", { cookie: staffCookie });
    expect(res.status).toBe(404);
  });

  test("student and admin get 403 staff_only and nothing is written", async () => {
    const r = await seedRequest(STUDENT_A);
    for (const cookie of [studentA, admin]) {
      const res = await api("POST", `/api/requests/${r.id}/staff-check`, { cookie });
      expect({ status: res.status, error: res.body.error }).toEqual({ status: 403, error: "staff_only" });
    }
    const [row] = await db.select().from(requests).where(eq(requests.id, r.id));
    expect(row.staffCheckedAt).toBeNull();
    expect(row.staffCheckedById).toBeNull();
  });

  test("visibility: admin sees the checker name, the student only the time", async () => {
    const r = await seedRequest(STUDENT_A);
    await api("POST", `/api/requests/${r.id}/staff-check`, { cookie: staffCookie });

    const adminDetail = await api("GET", `/api/requests/${r.id}`, { cookie: admin });
    expect(adminDetail.body.staffCheckedAt).toBeTruthy();
    expect(adminDetail.body.staffCheckedByName).toBe("เจ้าหน้าที่ทดสอบ");

    const studentDetail = await api("GET", `/api/requests/${r.id}`, { cookie: studentA });
    expect(studentDetail.body.staffCheckedAt).toBeTruthy();
    expect(studentDetail.body.staffCheckedByName).toBeUndefined();

    const studentList = await api("GET", "/api/requests", { cookie: studentA });
    const row = studentList.body.find((x: any) => x.id === r.id);
    expect(row.staffCheckedAt).toBeTruthy();
    expect(row.staffCheckedByName).toBeUndefined();

    const adminList = await api("GET", "/api/requests", { cookie: admin });
    expect(adminList.body.find((x: any) => x.id === r.id).staffCheckedByName).toBe("เจ้าหน้าที่ทดสอบ");
  });

  test("admin can still decide a checked request; approve keeps the check record", async () => {
    const r = await seedRequest(STUDENT_A);
    await api("POST", `/api/requests/${r.id}/staff-check`, { cookie: staffCookie });
    const ok = await api("POST", `/api/requests/${r.id}/approve`, { cookie: admin });
    expect(ok.status).toBe(200);
    const [row] = await db.select().from(requests).where(eq(requests.id, r.id));
    expect(row.status).toBe("approved");
    expect(row.staffCheckedById).toBe(STAFF_ID);
  });

  test("request-revision keeps the check until the student resubmits, then resubmit clears it (D3)", async () => {
    const r = await seedRequest(STUDENT_A);
    await api("POST", `/api/requests/${r.id}/staff-check`, { cookie: staffCookie });
    const flag = await api("POST", `/api/requests/${r.id}/request-revision`, {
      cookie: admin,
      body: { slots: [1], note: "ขาดหลักฐานหน้า 1" },
    });
    expect(flag.status).toBe(200);
    const [flagged] = await db.select().from(requests).where(eq(requests.id, r.id));
    expect(flagged.staffCheckedAt).not.toBeNull();

    // Replace the flagged file the way the resubmit route expects: a consumed-once upload.
    const storagePath = `requests/${randomUUID()}.pdf`;
    await db.insert(attachmentUploads).values({
      storagePath,
      studentId: STUDENT_A,
      fileName: "fixed.pdf",
      fileType: "application/pdf",
      fileSize: 999,
    });
    const resubmit = await api("POST", `/api/requests/${r.id}/resubmit`, {
      cookie: studentA,
      body: {
        attachments: [
          { slot: 1, fileName: "fixed.pdf", fileType: "application/pdf", fileSize: 999, storagePath },
        ],
      },
    });
    expect(resubmit.status).toBe(200);

    const [after] = await db.select().from(requests).where(eq(requests.id, r.id));
    expect(after.status).toBe("pending");
    expect(after.staffCheckedAt).toBeNull();
    expect(after.staffCheckedById).toBeNull();

    // and the cleared request can be checked again
    const again = await api("POST", `/api/requests/${r.id}/staff-check`, { cookie: staffCookie });
    expect(again.status).toBe(200);
  });
});

describe("staff stays read-only on every decision and edit route", () => {
  test("approve / reject / request-revision / resubmit / create / patch all refuse staff", async () => {
    const r = await seedRequest(STUDENT_A);
    const cases: Array<[string, string, unknown, number, string]> = [
      ["POST", `/api/requests/${r.id}/approve`, undefined, 403, "admin_only"],
      ["POST", `/api/requests/${r.id}/reject`, { reason: "x" }, 403, "admin_only"],
      ["POST", `/api/requests/${r.id}/request-revision`, { slots: [1] }, 403, "admin_only"],
      ["POST", `/api/requests/${r.id}/resubmit`, {}, 403, "only_students"],
      ["POST", "/api/requests", { attachments: [] }, 403, "only_students"],
      ["PATCH", `/api/requests/${r.id}`, { note: "x" }, 403, "forbidden"],
    ];
    for (const [method, path, body, status, error] of cases) {
      const res = await api(method, path, { cookie: staffCookie, body });
      expect({ method, path, status: res.status, error: res.body.error }).toEqual({
        method,
        path,
        status,
        error,
      });
    }
    const [row] = await db.select().from(requests).where(eq(requests.id, r.id));
    expect(row.status).toBe("pending");
    expect(row.note).toBe("note");
    expect(row.staffCheckedAt).toBeNull();
  });

  test("staff cannot reach the audit log or stats", async () => {
    for (const path of ["/api/audit", "/api/stats"]) {
      const res = await api("GET", path, { cookie: staffCookie });
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
  });
});

describe("GET /api/audit actor", () => {
  test("rows carry the staff member name (audit W-1)", async () => {
    const r = await seedRequest(STUDENT_A);
    await api("POST", `/api/requests/${r.id}/staff-check`, { cookie: staffCookie });
    const res = await api("GET", "/api/audit", { cookie: admin });
    expect(res.status).toBe(200);
    const row = res.body.find((x: any) => x.targetId === r.id && x.action === "staff_check");
    expect(row.actorStaffId).toBe(STAFF_ID);
    expect(row.actorName).toBe("เจ้าหน้าที่ทดสอบ");
  });
});
