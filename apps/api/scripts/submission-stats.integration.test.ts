/**
 * Submission stats + roster lists (round 2, Phase 3/4, audit T-1/T-2).
 *
 * Runs only through the `test:stats` wrapper (scripts/with-test-db.ts) against
 * loopback:8520/ua_roster_test; the fixture refuses to TRUNCATE anywhere else.
 *
 *   bun run --cwd apps/api test:stats
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";

const TEST_DATABASE = "ua_roster_test";
const ORIGIN = "https://kingplapow.com";

if (process.env.ROSTER_TEST !== "1") {
  throw new Error("stats integration tests must run through the test:stats wrapper");
}
process.env.NODE_ENV = "development";
process.env.WEB_ORIGIN = ORIGIN;
process.env.GOOGLE_CLIENT_ID = "stats-test-client";
process.env.GOOGLE_CLIENT_SECRET = "stats-test-secret";
process.env.GOOGLE_HD = "psru.ac.th";
delete process.env.RESEND_API_KEY;

const { app } = await import("../src/app");
const { db, pool } = await import("@ua/db/client");
const { requests, sessions, staff, students } = await import("@ua/db/schema");

async function api(path: string, cookie?: string): Promise<{ status: number; body: any }> {
  const res = await app.handle(new Request(`${ORIGIN}${path}`, { headers: cookie ? { cookie } : {} }));
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body };
}

async function makeSession(userId: string, role: "student" | "staff" | "admin"): Promise<string> {
  const id = randomUUID();
  await db.insert(sessions).values({
    id,
    userId,
    authMethod: role === "student" ? "google" : "password",
    role,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return `ua_session=${id}`;
}

const MAJOR_A = "สาขาวิชาการจัดการ"; // groups 1, 2, 10 + no group
const MAJOR_B = "สาขาวิชานิเทศศาสตร์"; // single group
const MAJOR_C = "สาขาการบัญชีบัณฑิต"; // only students without a group

let admin = "";
let staffCookie = "";
let studentCookie = "";

type Seed = {
  id: string;
  major: string;
  group: string | null;
  status?: "active" | "graduated";
  deleted?: boolean;
  requests?: Array<"pending" | "revision_required" | "approved" | "rejected">;
  first?: string;
};
const SEEDS: Seed[] = [
  { id: "7000000001", major: MAJOR_A, group: "กจ.1", requests: ["pending"] },
  { id: "7000000002", major: MAJOR_A, group: "กจ.1" },
  { id: "7000000003", major: MAJOR_A, group: "กจ.2", requests: ["approved", "rejected", "pending"] }, // many requests = 1 person
  { id: "7000000004", major: MAJOR_A, group: "กจ.2", requests: ["revision_required"] },
  { id: "7000000005", major: MAJOR_A, group: "กจ.10" },
  { id: "7000000006", major: MAJOR_A, group: "กจ.10", requests: ["approved"] },
  { id: "7000000007", major: MAJOR_A, group: null, requests: ["pending"] },
  { id: "7000000008", major: MAJOR_A, group: null },
  { id: "7000000009", major: MAJOR_B, group: "นศ.1", requests: ["approved"] },
  { id: "7000000010", major: MAJOR_B, group: "นศ.1" },
  { id: "7000000011", major: MAJOR_C, group: null },
  // out of scope but with requests: must not be counted anywhere
  { id: "7000000012", major: MAJOR_A, group: "กจ.1", status: "graduated", requests: ["approved"] },
  { id: "7000000013", major: MAJOR_A, group: "กจ.1", deleted: true, requests: ["pending"] },
  // wildcard-looking name for the LIKE escape check
  { id: "7000000014", major: MAJOR_B, group: "นศ.1", first: "100%" },
];

beforeAll(async () => {
  const id = await pool.query<{ database: string; address: string | null; port: number | null }>(
    `select current_database() as database, host(inet_server_addr()) as address, inet_server_port() as port`,
  );
  const row = id.rows[0];
  if (
    !row ||
    row.database !== TEST_DATABASE ||
    !["127.0.0.1", "::1"].includes(row.address ?? "") ||
    Number(row.port) !== 8520
  ) {
    throw new Error(`[test-db] REFUSED: ${row?.address}:${row?.port}/${row?.database}`);
  }
  await db.execute(sql`
    TRUNCATE students, staff, sessions, audit_logs, requests, request_attachments,
      request_attachment_revisions, attachment_uploads, notifications CASCADE
  `);
  const hash = "$argon2id$v=19$m=1,t=1,p=1$placeholder$placeholder";
  await db.insert(staff).values([
    { id: "st-staff", staffCode: "STSTAFF", passwordHash: hash, role: "staff", fullName: "เจ้าหน้าที่" },
    { id: "st-admin", staffCode: "STADMIN", passwordHash: hash, role: "admin", fullName: "ผู้ดูแล" },
  ]);
  await db.insert(students).values(
    SEEDS.map((s) => ({
      studentId: s.id,
      firstName: s.first ?? `ชื่อ${s.id.slice(-2)}`,
      lastName: "ทดสอบ",
      major: s.major,
      groupName: s.group,
      level: "ปริญญาตรี",
      admissionYear: 2567,
      status: s.status ?? ("active" as const),
      deletedAt: s.deleted ? new Date() : null,
    })),
  );
  let n = 0;
  for (const s of SEEDS) {
    for (const [i, status] of (s.requests ?? []).entries()) {
      await db.insert(requests).values({
        id: `st-req-${++n}`,
        studentId: s.id,
        status,
        // later entries are newer, so the last status listed is the "latest"
        submittedAt: new Date(Date.UTC(2026, 8, 1 + i)),
      });
    }
  }
  admin = await makeSession("st-admin", "admin");
  staffCookie = await makeSession("st-staff", "staff");
  studentCookie = await makeSession("7000000001", "student");
});

afterAll(async () => {
  await pool.end();
});

const inScope = SEEDS.filter((s) => (s.status ?? "active") === "active" && !s.deleted);
const hasRequest = (s: Seed) => (s.requests?.length ?? 0) > 0;

describe("GET /api/stats/submission", () => {
  test("counts people in scope; every level sums to the level above", async () => {
    const res = await api("/api/stats/submission", staffCookie);
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body.total).toBe(inScope.length);
    expect(body.submitted).toBe(inScope.filter(hasRequest).length);
    expect(body.submitted + body.notSubmitted).toBe(body.total);

    let sumMajor = 0;
    for (const m of body.byMajor) {
      sumMajor += m.total;
      expect(m.submitted + m.notSubmitted).toBe(m.total);
      expect(m.groupStats.reduce((n: number, g: any) => n + g.total, 0)).toBe(m.total);
      expect(m.groupStats.reduce((n: number, g: any) => n + g.submitted, 0)).toBe(m.submitted);
    }
    expect(sumMajor).toBe(body.total);
  });

  test("groups are natural-sorted and the null group is its own last entry", async () => {
    const res = await api("/api/stats/submission", admin);
    const a = res.body.byMajor.find((m: any) => m.major === MAJOR_A);
    expect(a.groups).toEqual(["กจ.1", "กจ.2", "กจ.10"]);
    expect(a.groupStats.map((g: any) => g.groupName)).toEqual(["กจ.1", "กจ.2", "กจ.10", null]);
    const none = a.groupStats[3];
    expect(none.total).toBe(2);
    expect(none.submitted).toBe(1);

    const c = res.body.byMajor.find((m: any) => m.major === MAJOR_C);
    expect(c.groups).toEqual([]);
    expect(c.groupStats).toHaveLength(1);
    expect(c.groupStats[0].groupName).toBeNull();
  });

  test("a student with several requests counts once; graduated and deleted are excluded", async () => {
    const res = await api("/api/stats/submission", admin);
    const a = res.body.byMajor.find((m: any) => m.major === MAJOR_A);
    const g2 = a.groupStats.find((g: any) => g.groupName === "กจ.2");
    expect(g2.total).toBe(2);
    expect(g2.submitted).toBe(2); // 7000000003 (3 requests) + 7000000004
    const g1 = a.groupStats.find((g: any) => g.groupName === "กจ.1");
    expect(g1.total).toBe(2); // graduated + deleted students in กจ.1 are not counted
    expect(g1.submitted).toBe(1);
  });

  test("student gets 403, anonymous gets 401", async () => {
    expect((await api("/api/stats/submission", studentCookie)).status).toBe(403);
    expect((await api("/api/stats/submission")).status).toBe(401);
  });
});

describe("roster lists match the stats numbers for every filter", () => {
  async function list(kind: "submitted" | "not-submitted", qs = "") {
    const res = await api(`/api/roster/${kind}?pageSize=100${qs}`, staffCookie);
    expect(res.status).toBe(200);
    return res.body;
  }

  test("overall: submitted + not submitted = total", async () => {
    const stats = (await api("/api/stats/submission", admin)).body;
    const submitted = await list("submitted");
    const notSubmitted = await list("not-submitted");
    expect(submitted.total).toBe(stats.submitted);
    expect(notSubmitted.total).toBe(stats.notSubmitted);
    expect(submitted.items).toHaveLength(stats.submitted);
    const ids = new Set([...submitted.items, ...notSubmitted.items].map((i: any) => i.studentId));
    expect(ids.size).toBe(stats.total); // nobody listed twice, nobody missing
  });

  test("per major and per group, including the null group", async () => {
    const stats = (await api("/api/stats/submission", admin)).body;
    for (const m of stats.byMajor) {
      const q = `&major=${encodeURIComponent(m.major)}`;
      expect((await list("submitted", q)).total).toBe(m.submitted);
      expect((await list("not-submitted", q)).total).toBe(m.notSubmitted);
      for (const g of m.groupStats) {
        const gq = `${q}&group=${encodeURIComponent(g.groupName ?? "__none__")}`;
        expect({ m: m.major, g: g.groupName, n: (await list("submitted", gq)).total }).toEqual({
          m: m.major,
          g: g.groupName,
          n: g.submitted,
        });
        expect((await list("not-submitted", gq)).total).toBe(g.notSubmitted);
      }
    }
  });

  test("submitted rows carry the latest request status and date; list order is natural", async () => {
    const res = await list("submitted", `&major=${encodeURIComponent(MAJOR_A)}`);
    const multi = res.items.find((i: any) => i.studentId === "7000000003");
    expect(multi.latestStatus).toBe("pending"); // newest of approved, rejected, pending
    expect(new Date(multi.latestSubmittedAt).toISOString().slice(0, 10)).toBe("2026-09-03");
    const groups = res.items.map((i: any) => i.groupName);
    expect(groups).toEqual(["กจ.1", "กจ.2", "กจ.2", "กจ.10", null]);
  });

  test("search matches id and name; % is literal", async () => {
    expect((await list("not-submitted", "&search=7000000008")).total).toBe(1);
    const pct = await list("not-submitted", `&search=${encodeURIComponent("%")}`);
    expect(pct.items.map((i: any) => i.studentId)).toEqual(["7000000014"]);
    expect((await list("not-submitted", `&search=${encodeURIComponent("_")}`)).total).toBe(0);
  });

  test("fractional or junk paging parameters do not cause a 500", async () => {
    for (const qs of ["page=1.5", "pageSize=2.7", "page=abc&pageSize=-3", "page=0"]) {
      const res = await api(`/api/roster/submitted?${qs}`, staffCookie);
      expect({ qs, status: res.status }).toEqual({ qs, status: 200 });
    }
  });

  test("student gets 403, anonymous 401", async () => {
    for (const kind of ["submitted", "not-submitted"]) {
      expect((await api(`/api/roster/${kind}`, studentCookie)).status).toBe(403);
      expect((await api(`/api/roster/${kind}`)).status).toBe(401);
    }
  });
});

describe("GET /api/stats (audit T-1)", () => {
  test("total equals the four statuses, overall and per faculty", async () => {
    const res = await api("/api/stats", admin);
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.revisionRequired).toBeGreaterThan(0);
    expect(b.pending + b.revisionRequired + b.approved + b.rejected).toBe(b.total);
    for (const f of b.byFaculty) {
      expect(f.pending + f.revisionRequired + f.approved + f.rejected).toBe(f.total);
    }
  });
});
