/**
 * Phase 3 roster integration tests.
 *
 * Runs against the throwaway database `ua_roster_test` (a clone of the local
 * `ua_dev` snapshot with migrations 0016 + 0017 applied). See
 * `packages/db/src/scripts/roster-testdb.ts`. The real `ua_dev` is never
 * touched, and neither is any remote database. The test wrapper loads only
 * `TEST_DATABASE_URL` from `apps/api/.env.test.local` before this process starts.
 *
 * Prepare / run / clean up:
 *   bun run --cwd packages/db testdb:roster-setup
 *   bun run --cwd apps/api test:roster
 *   bun run --cwd packages/db testdb:roster-teardown
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { count, eq, sql } from "drizzle-orm";

const TEST_DATABASE = "ua_roster_test";
const TEST_DATABASE_PORT = 8520;
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1"]);
const ORIGIN = "https://kingplapow.com";

if (process.env.ROSTER_TEST !== "1") {
  throw new Error("roster integration tests must run through the test:roster wrapper");
}
// Development Google bypass: lets the OAuth callback run end to end without a
// real Google round trip. `getDevGoogleProfile` throws if NODE_ENV is
// production, so the guard in the auth module stays honest.
process.env.NODE_ENV = "development";
process.env.AUTH_BYPASS_GOOGLE = "true";
process.env.GOOGLE_CLIENT_ID = "phase3-test-client";
process.env.GOOGLE_CLIENT_SECRET = "phase3-test-secret";
process.env.GOOGLE_HD = "psru.ac.th";
process.env.WEB_ORIGIN = ORIGIN;

const { app } = await import("../src/app");
const { getSession } = await import("../src/auth/session");
const { db, pool } = await import("@ua/db/client");
const {
  activities,
  attachmentUploads,
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
  setCookie: string;
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
  return { status: response.status, body, setCookie: response.headers.get("set-cookie") ?? "" };
}

function cookieValue(setCookie: string, name: string): string | null {
  for (const chunk of setCookie.split(/,\s*(?=[A-Za-z0-9_-]+=)/)) {
    const pair = chunk.split(";")[0];
    if (pair.startsWith(`${name}=`)) return pair.slice(name.length + 1);
  }
  return null;
}

function responseCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

function responseCookieValue(response: Response, name: string): string | null {
  for (const cookie of responseCookies(response)) {
    const pair = cookie.split(";", 1)[0];
    if (pair.startsWith(`${name}=`)) return pair.slice(name.length + 1);
  }
  return null;
}

function cookieHeader(sid: string): string {
  return `ua_session=${sid}`;
}

/** Create a live session row directly and return the cookie value. */
async function makeSession(userId: string, role: "student" | "staff" | "admin"): Promise<string> {
  const id = randomUUID();
  await db.insert(sessions).values({
    id,
    userId,
    authMethod: role === "student" ? "google" : "password",
    role,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return id;
}

// --- fixtures ---------------------------------------------------------------

const STAFF_ID = "p3-staff";
const ADMIN_ID = "p3-admin";
const ACTIVITY_ID = "p3-activity";
let staffCookie = "";
let adminCookie = "";
let studentCookie = "";

/**
 * Read-only dataset for the list/search/filter/sort tests. Never mutated by any
 * other test, so the expected counts below stay stable.
 * 6501000001 active / 6501000002 active / 6501000003 graduated
 * 6501000004 withdrawn / 6501000005 active+deleted / 6501000006 active+bound
 */
const SEED_STUDENTS = [
  { studentId: "6501000001", firstName: "ศักดิ์", lastName: "หนึ่ง", major: "วิศวกรรมคอมพิวเตอร์", admissionYear: 2566, status: "active" as const, email: "one@psru.ac.th", phone: "0810000001" },
  { studentId: "6501000002", firstName: "สมหญิง", lastName: "สอง", major: "วิศวกรรมคอมพิวเตอร์", admissionYear: 2566, status: "active" as const, email: "two@psru.ac.th", phone: "081-000-0002" },
  { studentId: "6501000003", firstName: "ปิยะ", lastName: "สาม", major: "บริหารธุรกิจ", admissionYear: 2565, status: "graduated" as const, email: null, phone: null },
  { studentId: "6501000004", firstName: "วิภา", lastName: "สี่", major: "บริหารธุรกิจ", admissionYear: 2564, status: "withdrawn" as const, email: null, phone: null },
  { studentId: "6501000005", firstName: "ธนกฤต", lastName: "ห้า", major: "วิศวกรรมคอมพิวเตอร์", admissionYear: 2566, status: "active" as const, email: "five@psru.ac.th", phone: null, deletedAt: new Date("2026-01-05T00:00:00Z") },
  { studentId: "6501000006", firstName: "สุดารัตน์", lastName: "หก", major: "วิศวกรรมซอฟต์แวร์", admissionYear: 2567, status: "active" as const, email: "bound@psru.ac.th", phone: null, emailBoundAt: new Date("2026-01-06T00:00:00Z") },
];

let nextId = 1;
function uniqueStudentId(): string {
  nextId += 1;
  return `6502000${String(nextId).padStart(3, "0")}`;
}

/** Create a student through the public API so each mutation test owns its row. */
async function createStudent(
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const studentId = (overrides.studentId as string) ?? uniqueStudentId();
  const created = await api("POST", "/api/roster/students", {
    cookie,
    body: {
      studentId,
      firstName: "ทดสอบ",
      lastName: "ระบบ",
      major: "วิศวกรรมคอมพิวเตอร์",
      admissionYear: 2568,
      ...overrides,
    },
  });
  expect(created.status).toBe(201);
  return studentId;
}

async function countRows(table: any, where?: any): Promise<number> {
  const [row] = await db.select({ n: count() }).from(table).where(where);
  return Number(row?.n ?? 0);
}

async function auditRows(targetId: string): Promise<any[]> {
  return db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.targetId, targetId))
    .then((rows) => rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()));
}

/** Full OAuth round trip using the dev Google bypass, as a real browser would. */
async function oauthLogin(email: string): Promise<{ status: number; location: string; sessionId: string | null }> {
  process.env.DEV_GOOGLE_EMAIL = email;
  const start = await app.handle(new Request(`${ORIGIN}/api/auth/google/url`));
  const startBody = (await start.json()) as { redirectUrl: string };
  const state = new URL(startBody.redirectUrl).searchParams.get("state") ?? "";
  const stateCookie = cookieValue(start.headers.get("set-cookie") ?? "", "ua_oauth_state");
  const callback = await app.handle(
    new Request(`${ORIGIN}/api/auth/google/callback?code=phase3-code&state=${encodeURIComponent(state)}`, {
      headers: { cookie: `ua_oauth_state=${stateCookie}` },
    }),
  );
  return {
    status: callback.status,
    location: callback.headers.get("location") ?? "",
    sessionId: cookieValue(callback.headers.get("set-cookie") ?? "", "ua_session"),
  };
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
    TRUNCATE students, staff, sessions, oauth_bind_sessions, oauth_login_states,
      audit_logs, requests, request_attachments,
      request_attachment_revisions, attachment_uploads, notifications, activities CASCADE
  `);

  await db.insert(activities).values({
    id: ACTIVITY_ID,
    title: "กิจกรรมทดสอบ Phase 3",
    titleEn: "Phase 3 test activity",
    type: "อบรม",
    organizer: "คณะวิศวกรรม",
    date: new Date("2026-09-01T00:00:00Z"),
    location: "ห้องทดสอบ",
  });

  await db.insert(staff).values([
    {
      id: STAFF_ID,
      staffCode: "P3STAFF",
      passwordHash: "$argon2id$v=19$m=1,t=1,p=1$placeholder$placeholder",
      role: "staff",
      fullName: "ผู้ดูแลระบบ Phase 3",
    },
    {
      id: ADMIN_ID,
      staffCode: "P3ADMIN",
      passwordHash: "$argon2id$v=19$m=1,t=1,p=1$placeholder$placeholder",
      role: "admin",
      fullName: "ผู้ดูแลระบบสูงสุด Phase 3",
    },
  ]);

  await db.insert(students).values(SEED_STUDENTS);

  staffCookie = cookieHeader(await makeSession(STAFF_ID, "staff"));
  adminCookie = cookieHeader(await makeSession(ADMIN_ID, "admin"));
  studentCookie = cookieHeader(await makeSession("6501000001", "student"));
});

afterAll(async () => {
  await pool.end();
});

// --- 1. authorization -------------------------------------------------------

describe("roster authorization", () => {
  test("staff and admin have equal access to the list", async () => {
    for (const cookie of [staffCookie, adminCookie]) {
      const res = await api("GET", "/api/roster/students?pageSize=100", { cookie });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    }
  });

  test("a student is rejected with 403 on every roster route", async () => {
    const cases: Array<[string, string, unknown?]> = [
      ["GET", "/api/roster/students", undefined],
      ["POST", "/api/roster/students", { studentId: "x", firstName: "x", lastName: "x", major: "x", admissionYear: 2568 }],
      ["PATCH", "/api/roster/students/6501000001", { firstName: "hacked" }],
      ["DELETE", "/api/roster/students/6501000001", undefined],
      ["POST", "/api/roster/students/6501000001/restore", undefined],
    ];
    for (const [method, path, body] of cases) {
      const res = await api(method, path, { cookie: studentCookie, body });
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
      expect(res.body.error).toBe("staff_admin_only");
    }
  });

  test("no session is rejected with 401", async () => {
    const res = await api("GET", "/api/roster/students");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });
});

describe("roster statistics authorization", () => {
  test("staff and admin can read submission stats and the not-submitted roster", async () => {
    for (const cookie of [staffCookie, adminCookie]) {
      const stats = await api("GET", "/api/stats/submission", { cookie });
      expect(stats.status).toBe(200);

      const roster = await api("GET", "/api/roster/not-submitted", { cookie });
      expect(roster.status).toBe(200);
    }
  });

  test("students receive 403 from both roster statistics endpoints", async () => {
    for (const path of ["/api/stats/submission", "/api/roster/not-submitted"]) {
      const res = await api("GET", path, { cookie: studentCookie });
      expect({ path, status: res.status, error: res.body.error }).toEqual({
        path,
        status: 403,
        error: "staff_admin_only",
      });
    }
  });

  test("missing sessions receive 401 from both roster statistics endpoints", async () => {
    for (const path of ["/api/stats/submission", "/api/roster/not-submitted"]) {
      const res = await api("GET", path);
      expect({ path, status: res.status, error: res.body.error }).toEqual({
        path,
        status: 401,
        error: "unauthorized",
      });
    }
  });
});

describe("roster statistics correctness", () => {
  test("submission stats exclude soft-deleted students while retaining active status semantics", async () => {
    const res = await api("GET", "/api/stats/submission", { cookie: staffCookie });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.submitted).toBe(0);
    expect(res.body.notSubmitted).toBe(3);
    expect(res.body.byMajor.reduce((sum: number, row: any) => sum + row.total, 0)).toBe(3);
  });

  test("not-submitted list excludes soft-deleted students and paginates", async () => {
    const first = await api("GET", "/api/roster/not-submitted?page=1&pageSize=2", {
      cookie: staffCookie,
    });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(first.body.items).toHaveLength(2);

    const second = await api("GET", "/api/roster/not-submitted?page=2&pageSize=2", {
      cookie: staffCookie,
    });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(second.body.items).toHaveLength(1);

    const ids = [...first.body.items, ...second.body.items].map((row: any) => row.studentId);
    expect(ids).not.toContain("6501000005");
    expect(ids.sort()).toEqual(["6501000001", "6501000002", "6501000006"]);
  });
});

// --- 2. listing -------------------------------------------------------------

describe("GET /api/roster/students", () => {
  test("paginates and reports a matching total", async () => {
    const first = await api("GET", "/api/roster/students?page=1&pageSize=3", { cookie: staffCookie });
    expect(first.status).toBe(200);
    expect(first.body.total).toBe(5);
    expect(first.body.page).toBe(1);
    expect(first.body.pageSize).toBe(3);
    expect(first.body.items.map((s: any) => s.studentId)).toEqual([
      "6501000001",
      "6501000002",
      "6501000003",
    ]);

    const second = await api("GET", "/api/roster/students?page=2&pageSize=3", { cookie: staffCookie });
    expect(second.body.items.map((s: any) => s.studentId)).toEqual(["6501000004", "6501000006"]);

    const overflow = await api("GET", "/api/roster/students?page=9&pageSize=3", { cookie: staffCookie });
    expect(overflow.body.total).toBe(5);
    expect(overflow.body.items).toEqual([]);
  });

  test("caps pageSize and rejects a nonsense page", async () => {
    const capped = await api("GET", "/api/roster/students?pageSize=9999", { cookie: staffCookie });
    expect(capped.body.pageSize).toBe(100);
    const negative = await api("GET", "/api/roster/students?page=-4&pageSize=0", { cookie: staffCookie });
    expect(negative.body.page).toBe(1);
    expect(negative.body.pageSize).toBe(50);
  });

  test("searches studentId, firstName, lastName, email and phone", async () => {
    const byId = await api("GET", "/api/roster/students?search=6501000003", { cookie: staffCookie });
    expect(byId.body.items.map((s: any) => s.studentId)).toEqual(["6501000003"]);

    const byFirstName = await api("GET", "/api/roster/students?search=" + encodeURIComponent("ปิยะ"), { cookie: staffCookie });
    expect(byFirstName.body.items.map((s: any) => s.studentId)).toEqual(["6501000003"]);

    const byLastName = await api("GET", "/api/roster/students?search=" + encodeURIComponent("ห้า"), { cookie: staffCookie });
    expect(byLastName.body.total).toBe(0);

    const byEmail = await api("GET", "/api/roster/students?search=two@psru.ac.th", { cookie: staffCookie });
    expect(byEmail.body.items.map((s: any) => s.studentId)).toEqual(["6501000002"]);

    // Phones are stored normalised, so a dashed query must still match.
    const byPhone = await api("GET", "/api/roster/students?search=" + encodeURIComponent("081-000-0002"), { cookie: staffCookie });
    expect(byPhone.body.items.map((s: any) => s.studentId)).toEqual(["6501000002"]);
  });

  test("filters by status and rejects an unknown status", async () => {
    const graduated = await api("GET", "/api/roster/students?status=graduated", { cookie: staffCookie });
    expect(graduated.body.items.map((s: any) => s.studentId)).toEqual(["6501000003"]);

    const active = await api("GET", "/api/roster/students?status=active", { cookie: staffCookie });
    expect(active.body.total).toBe(3);

    const invalid = await api("GET", "/api/roster/students?status=suspended", { cookie: staffCookie });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("invalid_status");
  });

  test("sorts by an allow-listed column in both directions", async () => {
    const asc = await api("GET", "/api/roster/students?sort=admissionYear&order=asc", { cookie: staffCookie });
    expect(asc.body.items.map((s: any) => s.studentId)).toEqual([
      "6501000004",
      "6501000003",
      "6501000001",
      "6501000002",
      "6501000006",
    ]);

    const desc = await api("GET", "/api/roster/students?sort=admissionYear&order=desc", { cookie: staffCookie });
    expect(desc.body.items[0].studentId).toBe("6501000006");

    // Anything outside the allow-list falls back to the default sort instead of
    // reaching the SQL layer.
    const injected = await api("GET", "/api/roster/students?sort=" + encodeURIComponent("studentId; DROP TABLE students"), { cookie: staffCookie });
    expect(injected.status).toBe(200);
    expect(injected.body.items[0].studentId).toBe("6501000001");
  });

  test("hides soft-deleted students unless includeDeleted is set", async () => {
    const hidden = await api("GET", "/api/roster/students?pageSize=100", { cookie: staffCookie });
    expect(hidden.body.total).toBe(5);
    expect(hidden.body.items.some((s: any) => s.studentId === "6501000005")).toBe(false);

    const shown = await api("GET", "/api/roster/students?includeDeleted=true&pageSize=100", { cookie: staffCookie });
    expect(shown.body.total).toBe(6);
    const deleted = shown.body.items.find((s: any) => s.studentId === "6501000005");
    expect(deleted.deletedAt).not.toBeNull();
  });
});

// --- 3. create --------------------------------------------------------------

describe("POST /api/roster/students", () => {
  test("creates a roster row with safe defaults and a create audit", async () => {
    const studentId = await createStudent(staffCookie, { email: "NEW.STUDENT@PSRU.AC.TH", phone: "+66-081-999-8888" });

    const listed = await api("GET", `/api/roster/students?search=${studentId}`, { cookie: staffCookie });
    const row = listed.body.items[0];
    expect(row.email).toBe("new.student@psru.ac.th");
    expect(row.phone).toBe("0819998888");
    expect(row.status).toBe("active");
    // A roster email is not a Google binding.
    expect(row.emailBoundAt).toBeNull();
    expect(row.deletedAt).toBeNull();

    const audit = await auditRows(studentId);
    expect(audit.length).toBe(1);
    expect(audit[0].action).toBe("student_create");
    expect(audit[0].targetType).toBe("student");
    expect(audit[0].actorStaffId).toBe(STAFF_ID);
  });

  test("admin and staff both create", async () => {
    const asAdmin = await createStudent(adminCookie);
    const asStaff = await createStudent(staffCookie);
    expect(asAdmin).not.toBe(asStaff);
  });

  test("rejects a duplicate studentId and a duplicate email", async () => {
    const sameId = await api("POST", "/api/roster/students", {
      cookie: staffCookie,
      body: { studentId: "6501000001", firstName: "ซ้ำ", lastName: "ซ้ำ", major: "x", admissionYear: 2568 },
    });
    expect(sameId.status).toBe(409);
    expect(sameId.body.error).toBe("duplicate_student_id");

    const sameEmail = await api("POST", "/api/roster/students", {
      cookie: staffCookie,
      body: {
        studentId: uniqueStudentId(),
        firstName: "ซ้ำ",
        lastName: "อีเมล",
        major: "x",
        admissionYear: 2568,
        email: "one@psru.ac.th",
      },
    });
    expect(sameEmail.status).toBe(409);
    expect(sameEmail.body.error).toBe("duplicate_email");
  });

  test("validates status, phone, email and required fields", async () => {
    const base = { studentId: uniqueStudentId(), firstName: "ชื่อ", lastName: "สกุล", major: "วิศวกรรม", admissionYear: 2568 };

    const badStatus = await api("POST", "/api/roster/students", {
      cookie: staffCookie,
      body: { ...base, studentId: uniqueStudentId(), status: "suspended" },
    });
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toBe("invalid_status");

    const badPhone = await api("POST", "/api/roster/students", {
      cookie: staffCookie,
      body: { ...base, studentId: uniqueStudentId(), phone: "12345" },
    });
    expect(badPhone.status).toBe(400);
    expect(badPhone.body.error).toBe("invalid_phone");

    const badEmail = await api("POST", "/api/roster/students", {
      cookie: staffCookie,
      body: { ...base, studentId: uniqueStudentId(), email: "not-an-email" },
    });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.error).toBe("invalid_email");

    const missingMajor = await api("POST", "/api/roster/students", {
      cookie: staffCookie,
      body: { studentId: uniqueStudentId(), firstName: "ชื่อ", lastName: "สกุล", admissionYear: 2568 },
    });
    expect(missingMajor.status).toBe(400);
    expect(missingMajor.body.error).toBe("invalid_major");

    const badYear = await api("POST", "/api/roster/students", {
      cookie: staffCookie,
      body: { ...base, studentId: uniqueStudentId(), admissionYear: 12 },
    });
    expect(badYear.status).toBe(400);
    expect(badYear.body.error).toBe("invalid_admission_year");
  });
});

// --- 4. update --------------------------------------------------------------

describe("PATCH /api/roster/students/:id", () => {
  test("changes only the submitted fields and audits only what changed", async () => {
    const studentId = await createStudent(staffCookie, { phone: "0811111111", status: "active" });

    const patched = await api("PATCH", `/api/roster/students/${studentId}`, {
      cookie: staffCookie,
      body: { lastName: "ใหม่", phone: "081-222-2222", status: "graduated" },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.lastName).toBe("ใหม่");
    expect(patched.body.phone).toBe("0812222222");
    expect(patched.body.status).toBe("graduated");
    // Untouched fields stay as created.
    expect(patched.body.firstName).toBe("ทดสอบ");
    expect(patched.body.major).toBe("วิศวกรรมคอมพิวเตอร์");

    const audit = await auditRows(studentId);
    const update = audit.find((row) => row.action === "student_update");
    expect(update).toBeDefined();
    expect(Object.keys(update.metadata).sort()).toEqual(["lastName", "phone", "status"]);
    expect(update.metadata.phone).toEqual({ old: "0811111111", new: "0812222222" });
    expect(update.metadata.status).toEqual({ old: "active", new: "graduated" });
    expect(update.metadata.lastName.old).toBe("ระบบ");
  });

  test("refuses to change studentId", async () => {
    const studentId = await createStudent(staffCookie);
    const res = await api("PATCH", `/api/roster/students/${studentId}`, {
      cookie: staffCookie,
      body: { studentId: "9999999999" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("student_id_immutable");
  });

  test("refuses to touch an email that is bound to a Google account", async () => {
    const res = await api("PATCH", "/api/roster/students/6501000006", {
      cookie: staffCookie,
      body: { email: "hijack@psru.ac.th" },
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("email_readonly_bound");

    // Even resending the identical bound value is rejected, so a client cannot
    // silently write to a field it does not own.
    const same = await api("PATCH", "/api/roster/students/6501000006", {
      cookie: staffCookie,
      body: { email: "bound@psru.ac.th" },
    });
    expect(same.status).toBe(409);
  });

  test("allows email changes while unbound and blocks a collision", async () => {
    const studentId = await createStudent(staffCookie);

    const ok = await api("PATCH", `/api/roster/students/${studentId}`, {
      cookie: staffCookie,
      body: { email: "free@psru.ac.th" },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.email).toBe("free@psru.ac.th");

    const collision = await api("PATCH", `/api/roster/students/${studentId}`, {
      cookie: staffCookie,
      body: { email: "one@psru.ac.th" },
    });
    expect(collision.status).toBe(409);
    expect(collision.body.error).toBe("duplicate_email");
  });

  test("returns 404 for an unknown student", async () => {
    const res = await api("PATCH", "/api/roster/students/0000000000", {
      cookie: staffCookie,
      body: { firstName: "ไม่มีอยู่" },
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("student_not_found");
  });
});

// --- 5. soft delete ---------------------------------------------------------

describe("DELETE /api/roster/students/:id", () => {
  test("soft deletes a student with history without touching dependent rows", async () => {
    const studentId = await createStudent(staffCookie, { status: "active" });

    await db.insert(requests).values({ id: `p3-req-${studentId}`, studentId, activityId: ACTIVITY_ID, status: "approved" });
    await db.insert(requestAttachments).values({ id: `p3-att-${studentId}`, requestId: `p3-req-${studentId}`, fileName: "proof.pdf", storagePath: `uploads/${studentId}/proof.pdf` });
    await db.insert(requestAttachmentRevisions).values({
      id: `p3-rev-${studentId}`,
      attachmentId: `p3-att-${studentId}`,
      revisionNumber: 1,
      fileName: "proof.pdf",
      fileType: "application/pdf",
      fileSize: 1024,
      storagePath: `uploads/${studentId}/proof.pdf`,
    });
    await db.insert(attachmentUploads).values({
      storagePath: `uploads/${studentId}/pending.png`,
      studentId,
      fileName: "pending.png",
      fileType: "image/png",
      fileSize: 2048,
    });
    await db.insert(notifications).values({
      id: `p3-notif-${studentId}`,
      studentId,
      type: "request_status_change",
      title: "อัปเดตสถานะ",
      body: "คำขอได้รับการอนุมัติ",
      requestId: `p3-req-${studentId}`,
    });

    const before = {
      requests: await countRows(requests, eq(requests.studentId, studentId)),
      attachments: await countRows(requestAttachments, eq(requestAttachments.requestId, `p3-req-${studentId}`)),
      revisions: await countRows(requestAttachmentRevisions, eq(requestAttachmentRevisions.attachmentId, `p3-att-${studentId}`)),
      uploads: await countRows(attachmentUploads, eq(attachmentUploads.studentId, studentId)),
      notifications: await countRows(notifications, eq(notifications.studentId, studentId)),
    };
    expect(before).toEqual({ requests: 1, attachments: 1, revisions: 1, uploads: 1, notifications: 1 });

    const deleted = await api("DELETE", `/api/roster/students/${studentId}`, { cookie: staffCookie });
    expect(deleted.status).toBe(200);
    expect(deleted.body.deletedAt).not.toBeNull();
    // Status is untouched by a soft delete.
    expect(deleted.body.status).toBe("active");

    // The row itself is still there: nothing was physically removed.
    const [row] = await db.select().from(students).where(eq(students.studentId, studentId));
    expect(row).toBeDefined();
    expect(row.deletedAt).not.toBeNull();

    const after = {
      requests: await countRows(requests, eq(requests.studentId, studentId)),
      attachments: await countRows(requestAttachments, eq(requestAttachments.requestId, `p3-req-${studentId}`)),
      revisions: await countRows(requestAttachmentRevisions, eq(requestAttachmentRevisions.attachmentId, `p3-att-${studentId}`)),
      uploads: await countRows(attachmentUploads, eq(attachmentUploads.studentId, studentId)),
      notifications: await countRows(notifications, eq(notifications.studentId, studentId)),
    };
    expect(after).toEqual(before);

    const audit = await auditRows(studentId);
    const softDelete = audit.find((row) => row.action === "student_soft_delete");
    expect(softDelete).toBeDefined();
    expect(softDelete.metadata.deletedAt).not.toBeNull();
  });

  test("rejects a second delete with 409", async () => {
    const studentId = await createStudent(staffCookie);
    const first = await api("DELETE", `/api/roster/students/${studentId}`, { cookie: adminCookie });
    expect(first.status).toBe(200);
    const second = await api("DELETE", `/api/roster/students/${studentId}`, { cookie: adminCookie });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("student_already_deleted");
  });

  test("revokes live student sessions in the same transaction", async () => {
    const studentId = await createStudent(staffCookie);
    const sid = await makeSession(studentId, "student");
    expect(await countRows(sessions, eq(sessions.id, sid))).toBe(1);

    const deleted = await api("DELETE", `/api/roster/students/${studentId}`, { cookie: staffCookie });
    expect(deleted.status).toBe(200);
    expect(await countRows(sessions, eq(sessions.id, sid))).toBe(0);

    // The revoked cookie is already dead.
    expect(await getSession({ cookie: cookieHeader(sid) })).toBeNull();
  });

  test("leaves staff sessions untouched when a student is deleted", async () => {
    const studentId = await createStudent(staffCookie);
    await api("DELETE", `/api/roster/students/${studentId}`, { cookie: staffCookie });
    expect(await getSession({ cookie: staffCookie })).not.toBeNull();
  });
});

// --- 6. the getSession invariant -------------------------------------------

describe("getSession defence in depth", () => {
  test("refuses a stale session belonging to a soft-deleted student and revokes it", async () => {
    const studentId = await createStudent(staffCookie);
    const sid = await makeSession(studentId, "student");

    // Simulate any other code path setting deleted_at (a future import, a manual
    // fix) without revoking sessions, and confirm getSession still locks out.
    await db.update(students).set({ deletedAt: new Date() }).where(eq(students.studentId, studentId));

    const user = await getSession({ cookie: cookieHeader(sid) });
    expect(user).toBeNull();
    expect(await countRows(sessions, eq(sessions.id, sid))).toBe(0);
  });

  test("still blocks non-active students and revokes their session", async () => {
    const studentId = await createStudent(staffCookie, { status: "withdrawn" });
    const sid = await makeSession(studentId, "student");
    expect(await getSession({ cookie: cookieHeader(sid) })).toBeNull();
    expect(await countRows(sessions, eq(sessions.id, sid))).toBe(0);
  });
});

// --- 7. restore -------------------------------------------------------------

describe("POST /api/roster/students/:id/restore", () => {
  test("clears deleted_at without touching the academic status", async () => {
    const studentId = await createStudent(staffCookie, { status: "withdrawn" });
    const sid = await makeSession(studentId, "student");
    await api("DELETE", `/api/roster/students/${studentId}`, { cookie: staffCookie });

    const restored = await api("POST", `/api/roster/students/${studentId}/restore`, { cookie: staffCookie });
    expect(restored.status).toBe(200);
    expect(restored.body.deletedAt).toBeNull();
    // The academic status is preserved exactly.
    expect(restored.body.status).toBe("withdrawn");

    const audit = await auditRows(studentId);
    const restore = audit.find((row) => row.action === "student_restore");
    expect(restore).toBeDefined();
    expect(restore.metadata.status).toBe("withdrawn");
    expect(restore.metadata.previousDeletedAt).not.toBeNull();
  });

  test("does not resurrect a revoked session and issues no new one", async () => {
    const studentId = await createStudent(staffCookie);
    const sid = await makeSession(studentId, "student");
    await api("DELETE", `/api/roster/students/${studentId}`, { cookie: staffCookie });
    await api("POST", `/api/roster/students/${studentId}/restore`, { cookie: staffCookie });

    expect(await countRows(sessions, eq(sessions.userId, studentId))).toBe(0);
    expect(await getSession({ cookie: cookieHeader(sid) })).toBeNull();
  });

  test("rejects restoring a student that is not deleted", async () => {
    const studentId = await createStudent(staffCookie);
    const res = await api("POST", `/api/roster/students/${studentId}/restore`, { cookie: adminCookie });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("not_deleted");
  });

  test("rejects a second restore with 409", async () => {
    const studentId = await createStudent(staffCookie);
    await api("DELETE", `/api/roster/students/${studentId}`, { cookie: staffCookie });
    const first = await api("POST", `/api/roster/students/${studentId}/restore`, { cookie: staffCookie });
    expect(first.status).toBe(200);
    const second = await api("POST", `/api/roster/students/${studentId}/restore`, { cookie: staffCookie });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("not_deleted");
  });

  test("returns 404 for an unknown student", async () => {
    const res = await api("POST", "/api/roster/students/0000000000/restore", { cookie: staffCookie });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("student_not_found");
  });
});

// --- 8. login behaviour around soft delete ----------------------------------

describe("OAuth bind cookie integration", () => {
  test("unbound callback emits separate state-clear and bind cookies that round-trip", async () => {
    const studentId = await createStudent(staffCookie, { phone: "0812345678" });
    const email = `bind.${randomUUID()}@psru.ac.th`;
    process.env.DEV_GOOGLE_EMAIL = email;

    const callback = await app.handle(
      new Request(`${ORIGIN}/api/auth/google/callback?code=bind-code`),
    );
    const callbackCookies = responseCookies(callback);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${ORIGIN}/auth/bind`);
    expect(callbackCookies).toHaveLength(2);
    expect(callbackCookies.filter((cookie) => cookie.startsWith("ua_oauth_state=;"))).toHaveLength(1);
    expect(callbackCookies.filter((cookie) => cookie.startsWith("ua_oauth_bind=") && !cookie.startsWith("ua_oauth_bind=;"))).toHaveLength(1);
    expect(callbackCookies.every((cookie) => !(cookie.includes("ua_oauth_state=") && cookie.includes("ua_oauth_bind=")))).toBe(true);

    const bindToken = responseCookieValue(callback, "ua_oauth_bind");
    expect(bindToken).not.toBeNull();
    const bindCookie = `ua_oauth_bind=${bindToken}`;
    const status = await api("GET", "/api/auth/google/bind/session", { cookie: bindCookie });
    expect(status.status).toBe(200);
    expect(status.body.valid).toBe(true);

    const bound = await app.handle(
      new Request(`${ORIGIN}/api/auth/google/bind`, {
        method: "POST",
        headers: {
          cookie: bindCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ studentId, phone: "0812345678" }),
      }),
    );
    const boundCookies = responseCookies(bound);
    expect(bound.status).toBe(200);
    expect(boundCookies).toHaveLength(2);
    expect(boundCookies.filter((cookie) => cookie.startsWith("ua_oauth_bind=;"))).toHaveLength(1);
    expect(boundCookies.filter((cookie) => cookie.startsWith("ua_session=") && !cookie.startsWith("ua_session=;"))).toHaveLength(1);
    expect(boundCookies.every((cookie) => !(cookie.includes("ua_oauth_bind=") && cookie.includes("ua_session=")))).toBe(true);
  });
});

describe("OAuth login with roster state", () => {
  test("an active student can sign in and gets a session", async () => {
    const studentId = await createStudent(staffCookie, { email: "login.active@psru.ac.th" });
    const result = await oauthLogin("login.active@psru.ac.th");
    expect(result.status).toBe(302);
    expect(result.location).not.toContain("error=");
    expect(result.sessionId).not.toBeNull();

    const user = await getSession({ cookie: cookieHeader(result.sessionId!) });
    expect(user?.studentId).toBe(studentId);
  });

  test("a soft-deleted student cannot sign in", async () => {
    const studentId = await createStudent(staffCookie, { email: "login.deleted@psru.ac.th" });
    const deleted = await api("DELETE", `/api/roster/students/${studentId}`, { cookie: staffCookie });
    expect(deleted.status).toBe(200);

    const result = await oauthLogin("login.deleted@psru.ac.th");
    expect(result.status).toBe(302);
    expect(result.location).toContain("error=not_in_roster");
    expect(result.sessionId).toBeNull();
  });

  test("graduated and withdrawn students still cannot sign in after a restore", async () => {
    for (const status of ["graduated", "withdrawn"]) {
      const email = `login.${status}@psru.ac.th`;
      const studentId = await createStudent(staffCookie, { email, status });
      await api("DELETE", `/api/roster/students/${studentId}`, { cookie: staffCookie });
      const restored = await api("POST", `/api/roster/students/${studentId}/restore`, { cookie: staffCookie });
      expect(restored.body.status).toBe(status);

      const result = await oauthLogin(email);
      expect(result.status).toBe(302);
      expect(result.location).toContain("error=not_in_roster");
    }
  });

  test("an active student can sign in again after a restore", async () => {
    const email = "login.restored@psru.ac.th";
    const studentId = await createStudent(staffCookie, { email });
    await api("DELETE", `/api/roster/students/${studentId}`, { cookie: staffCookie });
    const restored = await api("POST", `/api/roster/students/${studentId}/restore`, { cookie: staffCookie });
    expect(restored.status).toBe(200);

    const result = await oauthLogin(email);
    expect(result.status).toBe(302);
    expect(result.location).not.toContain("error=");
    expect(result.sessionId).not.toBeNull();
  });
});
