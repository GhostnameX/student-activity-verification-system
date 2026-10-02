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
import { count, eq, inArray, sql } from "drizzle-orm";

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
const { createPostgresOAuthStateStore } = await import("../src/auth/oauth-state-store");
const { hashOAuthState } = await import("../src/auth/oauth-security");
const { db, pool } = await import("@ua/db/client");
const {
  attachmentUploads,
  auditLogs,
  notifications,
  oauthBindSessions,
  oauthLoginStates,
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
  const response = await rawApi(method, path, options);
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

async function rawApi(
  method: string,
  path: string,
  options: { cookie?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  return app.handle(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  );
}

function parseCsv(csv: string): string[][] {
  const text = csv.startsWith("\uFEFF") ? csv.slice(1) : csv;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\r" && text[index + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
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
let staffCookie = "";
let adminCookie = "";
let studentCookie = "";
const oauthStateHashes: string[] = [];

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
      request_attachment_revisions, attachment_uploads, notifications CASCADE
  `);

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
  if (oauthStateHashes.length > 0) {
    await db.delete(oauthLoginStates).where(inArray(oauthLoginStates.stateHash, oauthStateHashes));
  }
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
      ["GET", "/api/roster/export.csv", undefined],
      ["POST", "/api/roster/students", { studentId: "x", firstName: "x", lastName: "x", major: "x", admissionYear: 2568 }],
      ["PATCH", "/api/roster/students/6501000001", { firstName: "hacked" }],
      ["DELETE", "/api/roster/students/6501000001", undefined],
      ["POST", "/api/roster/students/6501000001/restore", undefined],
      ["POST", "/api/roster/students/bulk-delete", { studentIds: ["6501000001"] }],
      ["POST", "/api/roster/students/bulk-restore", { studentIds: ["6501000005"] }],
    ];
    for (const [method, path, body] of cases) {
      const res = await api(method, path, { cookie: studentCookie, body });
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
      expect(res.body.error).toBe("staff_admin_only");
    }
  });

  test("no session is rejected with 401", async () => {
    const cases: Array<[string, string, unknown?]> = [
      ["GET", "/api/roster/students", undefined],
      ["GET", "/api/roster/export.csv", undefined],
      ["POST", "/api/roster/students/bulk-delete", { studentIds: ["6501000001"] }],
      ["POST", "/api/roster/students/bulk-restore", { studentIds: ["6501000005"] }],
    ];
    for (const [method, path, body] of cases) {
      const res = await api(method, path, { body });
      expect({ path, status: res.status, error: res.body.error }).toEqual({
        path,
        status: 401,
        error: "unauthorized",
      });
    }
  });

  test("staff and admin have equal bulk permissions", async () => {
    for (const cookie of [staffCookie, adminCookie]) {
      const remove = await api("POST", "/api/roster/students/bulk-delete", {
        cookie,
        body: { studentIds: ["6501000005"] },
      });
      expect(remove.status).toBe(200);
      expect(remove.body.conflicted).toEqual([{ studentId: "6501000005", reason: "already_deleted" }]);

      const restore = await api("POST", "/api/roster/students/bulk-restore", {
        cookie,
        body: { studentIds: ["6501000001"] },
      });
      expect(restore.status).toBe(200);
      expect(restore.body.conflicted).toEqual([{ studentId: "6501000001", reason: "already_active" }]);
    }
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

describe("GET /api/roster/export.csv", () => {
  test("exports every active non-deleted roster row with a dated attachment filename", async () => {
    const response = await rawApi("GET", "/api/roster/export.csv?status=active", { cookie: staffCookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="student-roster-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");

    const rows = parseCsv(await response.text());
    expect(rows[0]).toEqual([
      "studentId", "firstName", "lastName", "major", "groupName", "level",
      "admissionYear", "status", "email", "phone",
    ]);
    expect(rows.slice(1).map((row) => row[0])).toEqual(["6501000001", "6501000002", "6501000006"]);
    expect(rows.slice(1).every((row) => row[7] === "active")).toBe(true);
  });

  test("uses the same search, status and sort filters as the roster list", async () => {
    const bySearch = await rawApi(
      "GET",
      "/api/roster/export.csv?search=" + encodeURIComponent("ปิยะ"),
      { cookie: staffCookie },
    );
    expect(parseCsv(await bySearch.text()).slice(1).map((row) => row[0])).toEqual(["6501000003"]);

    const graduated = await rawApi(
      "GET",
      "/api/roster/export.csv?status=graduated&sort=admissionYear&order=desc",
      { cookie: adminCookie },
    );
    const graduatedRows = parseCsv(await graduated.text());
    expect(graduatedRows.slice(1).map((row) => [row[0], row[7]])).toEqual([["6501000003", "graduated"]]);
  });

  test("includes soft-deleted rows and an explicit deleted column only when requested", async () => {
    const response = await rawApi("GET", "/api/roster/export.csv?includeDeleted=true", { cookie: staffCookie });
    const rows = parseCsv(await response.text());
    expect(rows[0].at(-1)).toBe("deleted");
    expect(rows).toHaveLength(7);
    const deleted = rows.find((row) => row[0] === "6501000005");
    expect(deleted?.at(-1)).toBe("true");
    expect(rows.find((row) => row[0] === "6501000001")?.at(-1)).toBe("false");
  });

  test("emits UTF-8 BOM, preserves Thai, escapes CSV, and neutralizes spreadsheet formulas", async () => {
    const studentId = "formula-export-fixture";
    await db.insert(students).values({
      studentId,
      firstName: "=SUM(1,1)",
      lastName: "+คำสั่ง",
      major: "-อันตราย",
      groupName: "@กลุ่ม",
      level: "ข้อความ, \"ทดสอบ\"\nบรรทัดใหม่",
      admissionYear: 2569,
      status: "active",
      email: null,
      phone: null,
    });

    try {
      const response = await rawApi(
        "GET",
        `/api/roster/export.csv?search=${encodeURIComponent(studentId)}`,
        { cookie: staffCookie },
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
      const rows = parseCsv(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes));
      expect(rows[1]).toEqual([
        studentId,
        "'=SUM(1,1)",
        "'+คำสั่ง",
        "'-อันตราย",
        "'@กลุ่ม",
        "ข้อความ, \"ทดสอบ\"\nบรรทัดใหม่",
        "2569",
        "active",
        "",
        "",
      ]);
    } finally {
      await db.delete(students).where(eq(students.studentId, studentId));
    }
  });

  test("exports no internal, session, OAuth, audit or system metadata fields", async () => {
    const response = await rawApi("GET", "/api/roster/export.csv", { cookie: staffCookie });
    const rows = parseCsv(await response.text());
    expect(rows[0]).toEqual([
      "studentId", "firstName", "lastName", "major", "groupName", "level",
      "admissionYear", "status", "email", "phone",
    ]);
    for (const forbidden of [
      "passwordHash", "session", "oauth", "emailBoundAt", "deletedAt", "createdAt", "updatedAt", "audit",
    ]) {
      expect(rows[0]).not.toContain(forbidden);
    }
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
      cookie: adminCookie,
      body: { email: "hijack@psru.ac.th" },
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("email_readonly_bound");

    // Even resending the identical bound value is rejected, so a client cannot
    // silently write to a field it does not own.
    const same = await api("PATCH", "/api/roster/students/6501000006", {
      cookie: adminCookie,
      body: { email: "bound@psru.ac.th" },
    });
    expect(same.status).toBe(409);
  });

  test("staff cannot change an email (403) but can change other fields (audit P-4)", async () => {
    const studentId = await createStudent(staffCookie, { email: "keep@psru.ac.th" });

    const denied = await api("PATCH", `/api/roster/students/${studentId}`, {
      cookie: staffCookie,
      body: { email: "staff-set@psru.ac.th" },
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("email_admin_only");

    // A mixed body is refused as a whole: nothing is written.
    const mixed = await api("PATCH", `/api/roster/students/${studentId}`, {
      cookie: staffCookie,
      body: { email: "staff-set@psru.ac.th", lastName: "ไม่ควรเปลี่ยน" },
    });
    expect(mixed.status).toBe(403);
    const [row] = await db.select().from(students).where(eq(students.studentId, studentId));
    expect(row.email).toBe("keep@psru.ac.th");
    expect(row.lastName).toBe("ระบบ");

    const other = await api("PATCH", `/api/roster/students/${studentId}`, {
      cookie: staffCookie,
      body: { lastName: "แก้โดยสตาฟ" },
    });
    expect(other.status).toBe(200);
    expect(other.body.lastName).toBe("แก้โดยสตาฟ");
  });

  test("allows admin email changes while unbound and blocks a collision", async () => {
    const studentId = await createStudent(staffCookie);

    const ok = await api("PATCH", `/api/roster/students/${studentId}`, {
      cookie: adminCookie,
      body: { email: "free@psru.ac.th" },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.email).toBe("free@psru.ac.th");

    const collision = await api("PATCH", `/api/roster/students/${studentId}`, {
      cookie: adminCookie,
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

// --- 4b. reject guard (audit S-1, S-2) --------------------------------------

describe("POST /api/requests/:id/reject", () => {
  async function seedRequest(status: "pending" | "approved", note: string | null): Promise<string> {
    const studentId = await createStudent(staffCookie);
    const id = `p3-rej-${studentId}`;
    await db.insert(requests).values({ id, studentId, status, note });
    return id;
  }

  test("refuses an already approved request and leaves it approved", async () => {
    const id = await seedRequest("approved", "หมายเหตุนักศึกษา");

    const res = await api("POST", `/api/requests/${id}/reject`, {
      cookie: adminCookie,
      body: { reason: "too late" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("already_reviewed");

    const [row] = await db.select().from(requests).where(eq(requests.id, id));
    expect(row.status).toBe("approved");
    expect(row.rejectionReason).toBeNull();
    expect(row.note).toBe("หมายเหตุนักศึกษา");
  });

  test("rejecting writes rejection_reason and keeps the student's note", async () => {
    const withReason = await seedRequest("pending", "หมายเหตุนักศึกษา");
    const ok = await api("POST", `/api/requests/${withReason}/reject`, {
      cookie: adminCookie,
      body: { reason: "เอกสารไม่ครบ" },
    });
    expect(ok.status).toBe(200);
    const [rejected] = await db.select().from(requests).where(eq(requests.id, withReason));
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectionReason).toBe("เอกสารไม่ครบ");
    expect(rejected.note).toBe("หมายเหตุนักศึกษา");

    // No reason given: the note must not be nulled out either.
    const noReason = await seedRequest("pending", "อีกหนึ่งหมายเหตุ");
    const ok2 = await api("POST", `/api/requests/${noReason}/reject`, { cookie: adminCookie, body: {} });
    expect(ok2.status).toBe(200);
    const [rejected2] = await db.select().from(requests).where(eq(requests.id, noReason));
    expect(rejected2.status).toBe("rejected");
    expect(rejected2.note).toBe("อีกหนึ่งหมายเหตุ");
  });
});

// --- 5. soft delete ---------------------------------------------------------

describe("DELETE /api/roster/students/:id", () => {
  test("soft deletes a student with history without touching dependent rows", async () => {
    const studentId = await createStudent(staffCookie, { status: "active" });

    await db.insert(requests).values({ id: `p3-req-${studentId}`, studentId, status: "approved" });
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

// --- 8. bulk delete / restore -----------------------------------------------

describe("bulk roster mutations", () => {
  test("bulk deletes 2+ bound or unbound students, revokes sessions, and audits each row", async () => {
    const first = await createStudent(staffCookie, { status: "active", email: null });
    const second = await createStudent(staffCookie, {
      status: "withdrawn",
      email: `bound.${randomUUID()}@psru.ac.th`,
    });
    await db
      .update(students)
      .set({ emailBoundAt: new Date("2026-09-20T00:00:00Z") })
      .where(eq(students.studentId, second));
    const firstSession = await makeSession(first, "student");
    const secondSession = await makeSession(second, "student");

    const result = await api("POST", "/api/roster/students/bulk-delete", {
      cookie: staffCookie,
      body: { studentIds: [first, second] },
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      requested: [first, second],
      succeeded: [first, second],
      conflicted: [],
      failed: [],
    });
    for (const [studentId, expectedStatus] of [[first, "active"], [second, "withdrawn"]] as const) {
      const [row] = await db.select().from(students).where(eq(students.studentId, studentId));
      expect(row.deletedAt).not.toBeNull();
      expect(row.status).toBe(expectedStatus);
      const audit = (await auditRows(studentId)).filter((entry) => entry.action === "student_soft_delete");
      expect(audit).toHaveLength(1);
      expect(audit[0].actorStaffId).toBe(STAFF_ID);
      expect(audit[0].metadata.bulk).toBe(true);
      expect(audit[0].metadata.revokedSessions).toBe(1);
    }
    expect(await countRows(sessions, eq(sessions.id, firstSession))).toBe(0);
    expect(await countRows(sessions, eq(sessions.id, secondSession))).toBe(0);
  });

  test("bulk restores 2+ students without changing academic status and reports repeats", async () => {
    const first = await createStudent(staffCookie, { status: "graduated" });
    const second = await createStudent(staffCookie, {
      status: "withdrawn",
      email: `restore.bound.${randomUUID()}@psru.ac.th`,
    });
    const boundAt = new Date("2026-09-21T00:00:00Z");
    await db.update(students).set({ emailBoundAt: boundAt }).where(eq(students.studentId, second));
    const removed = await api("POST", "/api/roster/students/bulk-delete", {
      cookie: adminCookie,
      body: { studentIds: [first, second] },
    });
    expect(removed.body.succeeded).toEqual([first, second]);

    const restored = await api("POST", "/api/roster/students/bulk-restore", {
      cookie: adminCookie,
      body: { studentIds: [first, second] },
    });
    expect(restored.status).toBe(200);
    expect(restored.body).toEqual({
      requested: [first, second],
      succeeded: [first, second],
      conflicted: [],
      failed: [],
    });
    for (const [studentId, expectedStatus] of [[first, "graduated"], [second, "withdrawn"]] as const) {
      const [row] = await db.select().from(students).where(eq(students.studentId, studentId));
      expect(row.deletedAt).toBeNull();
      expect(row.status).toBe(expectedStatus);
      if (studentId === second) expect(row.emailBoundAt).toEqual(boundAt);
      const audit = (await auditRows(studentId)).filter((entry) => entry.action === "student_restore");
      expect(audit).toHaveLength(1);
      expect(audit[0].actorStaffId).toBe(ADMIN_ID);
      expect(audit[0].metadata).toMatchObject({ bulk: true, status: expectedStatus });
    }

    const repeated = await api("POST", "/api/roster/students/bulk-restore", {
      cookie: staffCookie,
      body: { studentIds: [first, second] },
    });
    expect(repeated.status).toBe(200);
    expect(repeated.body.succeeded).toEqual([]);
    expect(repeated.body.conflicted).toEqual([
      { studentId: first, reason: "already_active" },
      { studentId: second, reason: "already_active" },
    ]);
  });

  test("reports mixed state, duplicate IDs, nonexistent IDs, and repeated delete explicitly", async () => {
    const active = await createStudent(staffCookie);
    const deleted = await createStudent(staffCookie);
    await api("DELETE", `/api/roster/students/${deleted}`, { cookie: staffCookie });
    const missing = "6599999999";
    const requested = [active, deleted, missing, active];

    const result = await api("POST", "/api/roster/students/bulk-delete", {
      cookie: staffCookie,
      body: { studentIds: requested },
    });
    expect(result.status).toBe(200);
    expect(result.body.requested).toEqual(requested);
    expect(result.body.succeeded).toEqual([active]);
    expect(result.body.conflicted).toEqual([
      { studentId: active, reason: "duplicate_id" },
      { studentId: deleted, reason: "already_deleted" },
    ]);
    expect(result.body.failed).toEqual([{ studentId: missing, reason: "student_not_found" }]);

    const repeated = await api("POST", "/api/roster/students/bulk-delete", {
      cookie: staffCookie,
      body: { studentIds: requested },
    });
    expect(repeated.status).toBe(200);
    expect(repeated.body.succeeded).toEqual([]);
    expect(repeated.body.conflicted).toEqual([
      { studentId: active, reason: "duplicate_id" },
      { studentId: active, reason: "already_deleted" },
      { studentId: deleted, reason: "already_deleted" },
    ]);
    expect(repeated.body.failed).toEqual([{ studentId: missing, reason: "student_not_found" }]);
  });

  test("rolls back rows, session revocation, and audits when one audit insert fails", async () => {
    const first = await createStudent(staffCookie);
    const second = await createStudent(staffCookie);
    const firstSession = await makeSession(first, "student");
    const secondSession = await makeSession(second, "student");

    await pool.query(`
      CREATE OR REPLACE FUNCTION roster_test_fail_bulk_audit()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.target_id = '${second}' AND NEW.action = 'student_soft_delete' THEN
          RAISE EXCEPTION 'forced bulk audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER roster_test_fail_bulk_audit_trigger
      BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION roster_test_fail_bulk_audit();
    `);

    try {
      const result = await api("POST", "/api/roster/students/bulk-delete", {
        cookie: staffCookie,
        body: { studentIds: [first, second] },
      });
      expect(result.status).toBe(500);
      expect(result.body).toEqual({
        requested: [first, second],
        succeeded: [],
        conflicted: [],
        failed: [
          { studentId: first, reason: "transaction_failed" },
          { studentId: second, reason: "transaction_failed" },
        ],
      });

      for (const studentId of [first, second]) {
        const [row] = await db.select().from(students).where(eq(students.studentId, studentId));
        expect(row.deletedAt).toBeNull();
        expect((await auditRows(studentId)).filter((entry) => entry.action === "student_soft_delete")).toHaveLength(0);
      }
      expect(await countRows(sessions, eq(sessions.id, firstSession))).toBe(1);
      expect(await countRows(sessions, eq(sessions.id, secondSession))).toBe(1);
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS roster_test_fail_bulk_audit_trigger ON audit_logs");
      await pool.query("DROP FUNCTION IF EXISTS roster_test_fail_bulk_audit()");
    }
  });
});

// --- 9. login behaviour around soft delete ----------------------------------

describe("OAuth bind cookie integration", () => {
  test("unbound callback emits separate state-clear and bind cookies that round-trip", async () => {
    const studentId = await createStudent(staffCookie, { phone: "0812345678" });
    // Binding requires the Google email to be <studentId>@psru.ac.th (emailMatchesStudentId).
    const email = `${studentId}@psru.ac.th`;
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

describe("durable OAuth login state", () => {
  test("survives store recreation, persists only a hash, and consumes exactly once", async () => {
    const state = `oauth-state-${randomUUID()}`;
    const stateHash = hashOAuthState(state);
    oauthStateHashes.push(stateHash);

    const issuingProcess = createPostgresOAuthStateStore(db);
    await issuingProcess.create({
      state,
      redirectPath: "/student",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const persisted = await db
      .select()
      .from(oauthLoginStates)
      .where(eq(oauthLoginStates.stateHash, stateHash));
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.stateHash).toBe(stateHash);
    expect(persisted[0]?.stateHash).not.toBe(state);

    const restartedProcess = createPostgresOAuthStateStore(db);
    expect(await restartedProcess.consumeByHash(stateHash, new Date())).toEqual({
      redirectPath: "/student",
    });
    expect(await restartedProcess.consumeByHash(stateHash, new Date())).toBeNull();
  });

  test("rejects expired, used, and missing rows", async () => {
    const store = createPostgresOAuthStateStore(db);
    const expiredState = `oauth-expired-${randomUUID()}`;
    const expiredHash = hashOAuthState(expiredState);
    oauthStateHashes.push(expiredHash);
    await store.create({
      state: expiredState,
      expiresAt: new Date(Date.now() - 1),
    });

    expect(await store.consumeByHash(expiredHash, new Date())).toBeNull();
    expect(await store.consumeByHash(hashOAuthState(`missing-${randomUUID()}`), new Date())).toBeNull();
  });

  test("cleans up expired and old used rows after the retention window", async () => {
    const store = createPostgresOAuthStateStore(db);
    const state = `oauth-cleanup-${randomUUID()}`;
    const stateHash = hashOAuthState(state);
    oauthStateHashes.push(stateHash);
    await store.create({
      state,
      expiresAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });

    await store.cleanup(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const remaining = await db
      .select({ stateHash: oauthLoginStates.stateHash })
      .from(oauthLoginStates)
      .where(eq(oauthLoginStates.stateHash, stateHash));
    expect(remaining).toHaveLength(0);
  });
});

describe("first-login bind requires <studentId>@psru.ac.th (audit P-1)", () => {
  /** Dev-bypass Google login for an email that is in no roster row -> bind cookie. */
  async function startBind(email: string): Promise<string> {
    const result = await app.handle(await bindStart(email));
    const cookie = cookieValue(result.headers.get("set-cookie") ?? "", "ua_oauth_bind");
    expect(result.headers.get("location")).toContain("/auth/bind");
    expect(cookie).not.toBeNull();
    return `ua_oauth_bind=${cookie}`;
  }

  async function bindStart(email: string): Promise<Request> {
    process.env.DEV_GOOGLE_EMAIL = email;
    const start = await app.handle(new Request(`${ORIGIN}/api/auth/google/url`));
    const body = (await start.json()) as { redirectUrl: string };
    expect(body.redirectUrl).toContain("code=dev");
    return new Request(`${ORIGIN}/api/auth/google/callback?code=dev`);
  }

  async function bind(cookie: string, studentId: string) {
    return api("POST", "/api/auth/google/bind", { cookie, body: { studentId, phone: "0812345678" } });
  }

  async function studentRow(studentId: string) {
    const [row] = await db.select().from(students).where(eq(students.studentId, studentId));
    return row;
  }

  test("matching email and student id binds", async () => {
    const studentId = await createStudent(staffCookie);
    const cookie = await startBind(`${studentId}@psru.ac.th`);
    const result = await bind(cookie, studentId);
    expect(result.status).toBe(200);
    expect(result.body.user.studentId).toBe(studentId);
    expect((await studentRow(studentId)).email).toBe(`${studentId}@psru.ac.th`);
  });

  test("case and whitespace differences still bind", async () => {
    const studentId = await createStudent(staffCookie);
    const cookie = await startBind(`${studentId}@PSRU.ac.th`);
    const result = await bind(cookie, `  ${studentId}  `);
    expect(result.status).toBe(200);
    expect((await studentRow(studentId)).email).toBe(`${studentId}@psru.ac.th`);
  });

  test("another student's id is rejected with 403 and nothing is bound", async () => {
    const mine = await createStudent(staffCookie);
    const victim = await createStudent(staffCookie);
    const cookie = await startBind(`${mine}@psru.ac.th`);
    const result = await bind(cookie, victim);
    expect(result.status).toBe(403);
    expect(result.body.error).toBe("email_student_mismatch");
    expect((await studentRow(victim)).email).toBeNull();
  });

  test("a non-student psru.ac.th mailbox can never bind to any student", async () => {
    const victim = await createStudent(staffCookie);
    const cookie = await startBind("somchai.k@psru.ac.th");
    const result = await bind(cookie, victim);
    expect(result.status).toBe(403);
    expect(result.body.error).toBe("email_student_mismatch");
    expect((await studentRow(victim)).email).toBeNull();
  });

  test("a mismatch counts as a failed attempt and exhausts the bind session", async () => {
    const victim = await createStudent(staffCookie);
    const cookie = await startBind("teacher.x@psru.ac.th");
    expect((await bind(cookie, victim)).status).toBe(403);
    expect((await bind(cookie, victim)).status).toBe(403);
    const third = await bind(cookie, victim);
    expect(third.status).toBe(429);
    expect(third.body.error).toBe("too_many_attempts");
    // Even the right-looking request is dead now.
    expect((await bind(cookie, victim)).status).toBe(401);
    expect((await studentRow(victim)).email).toBeNull();
    const rows = await db.select().from(oauthBindSessions).where(eq(oauthBindSessions.email, "teacher.x@psru.ac.th"));
    expect(rows.every((r) => r.usedAt !== null && r.attempts >= 3)).toBe(true);
  });

  test("the mismatch answer does not depend on whether the student exists", async () => {
    const cookieA = await startBind("teacher.y@psru.ac.th");
    const real = await bind(cookieA, await createStudent(staffCookie));
    const cookieB = await startBind("teacher.z@psru.ac.th");
    const missing = await bind(cookieB, "9999999999");
    expect([real.status, real.body.error]).toEqual([missing.status, missing.body.error]);
  });
});
