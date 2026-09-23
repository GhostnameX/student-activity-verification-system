import { app, thaiBuddhistYear, thaiDateParts } from "../src/app";
import { generateCertificatePDFForEmail } from "../src/certificate";
import { db, pool } from "@ua/db/client";
import { students, staff, requests, requestAttachments, requestAttachmentRevisions, attachmentUploads, activities, sessions, notifications, auditLogs, requestCounters, certificateCounters } from "@ua/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { ensureStaff } from "@ua/db/auth-helpers";

const BASE = "http://localhost:3000";
const GATE_TAG = "gate://";
const PASSWORD = "GateTest123!";

class SimulatedCrash extends Error {}

// refuse unless DATABASE_URL is local postgres targeting ua_dev; never shared/remote/prod.
// returns a SANITIZED reason (host/database only — never leaks user/password or full URL).
function assertLocalDevDb(url: string | undefined): string | null {
  if (!url) return "DATABASE_URL not set";
  let u: URL;
  try { u = new URL(url); } catch { return "DATABASE_URL is not a valid URL"; }
  const proto = u.protocol.toLowerCase().replace(":", "");
  if (proto !== "postgresql" && proto !== "postgres") return `protocol '${proto}' is not postgres`;
  const rawHost = u.hostname.toLowerCase();
  const host = rawHost.startsWith("[") && rawHost.endsWith("]") ? rawHost.slice(1, -1) : rawHost;
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") return `host '${host}' is not 127.0.0.1/localhost (remote/production refused)`;
  let dbName = "";
  try { dbName = decodeURIComponent(u.pathname.replace(/^\//, "")); } catch { /* keep '' */ }
  if (dbName !== "ua_dev") return `database '${dbName || "(none)"}' is not 'ua_dev'`;
  if (url.toLowerCase().includes("supabase") || url.toLowerCase().includes("pooler")) return "supabase/pooler-like URL detected (production refused)";
  return null;
}

let passCount = 0;
let failCount = 0;
const rows: { area: string; pass: boolean; note: string }[] = [];

function record(area: string, pass: boolean, note: string) {
  rows.push({ area, pass, note });
  if (pass) passCount++; else failCount++;
  console.log(`${pass ? "PASS" : "FAIL"} [${area}] ${note}`);
}

async function api(
  path: string,
  opts: { method?: string; body?: unknown; cookie?: string; form?: FormData } = {},
): Promise<{ status: number; json: any; cookie?: string; location?: string }> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers["cookie"] = opts.cookie;
  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await app.handle(new Request(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body,
  }));
  const setCookie = res.headers.get("set-cookie");
  let cookie = ""; let location = "";
  if (setCookie) {
    const m = setCookie.match(/ua_session=([^;]+)/);
    if (m) cookie = m[1];
  }
  location = res.headers.get("location") ?? "";
  let json: any = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json, cookie, location };
}

// capture cookie from Set-Cookie headers
function extractSessionCookie(res: Response): string {
  const all = (res as any).headers?.getSetCookie?.() as string[] | undefined;
  const v = all && all.length > 0 ? all.join("; ") : (res.headers.get("set-cookie") ?? "");
  const m = v.match(/ua_session=([^;]+)/);
  return m ? m[1] : "";
}

let created: {
  students: string[];
  staff: string[];
  activities: string[];
  requests: string[];
  attachments: string[];
  revisions: string[];
  sessions: string[];
  storagePaths: string[];
} = { students: [], staff: [], activities: [], requests: [], attachments: [], revisions: [], sessions: [], storagePaths: [] };

// counter rows captured before the run so cleanup can restore them exactly
let countersSnapshot: { request: { year: number; lastNumber: number }[]; certificate: { year: number; lastNumber: number }[] } = { request: [], certificate: [] };
let countersCaptured = false;

type CounterRow = { year: number; lastNumber: number };

// run every cleanup step even when one fails; collect label + error (never swallow)
async function hush(label: string, p: Promise<unknown>, errors: string[]) {
  try { await p; } catch (e) { errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function cleanupCreated(errors: string[]) {
  const reqIds = created.requests.filter((id): id is string => !!id);
  const storagePaths = created.storagePaths.filter((path): path is string => !!path);
  // pull attachment ids for our requests (some were created via API tx, not pushed)
  const attIdSet = new Set(created.attachments.filter((id): id is string => !!id));
  if (reqIds.length) {
    try {
      const atts = await db.select({ id: requestAttachments.id }).from(requestAttachments).where(inArray(requestAttachments.requestId, reqIds));
      for (const att of atts) attIdSet.add(att.id);
    } catch (e) {
      errors.push(`read attachments for cleanup: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const attIds = [...attIdSet];
  if (attIds.length) {
    await hush("delete revisions", db.delete(requestAttachmentRevisions).where(inArray(requestAttachmentRevisions.attachmentId, attIds)), errors);
    await hush("delete attachments", db.delete(requestAttachments).where(inArray(requestAttachments.id, attIds)), errors);
  }
  if (reqIds.length) {
    await hush("delete notifications(requestId)", db.delete(notifications).where(inArray(notifications.requestId, reqIds)), errors);
    await hush("delete auditLogs(request target)", db.delete(auditLogs).where(and(inArray(auditLogs.targetId, reqIds), eq(auditLogs.targetType, "request"))), errors);
    await hush("delete requests", db.delete(requests).where(inArray(requests.id, reqIds)), errors);
  }
  const stuIds = created.students.filter((id): id is string => !!id);
  const staffIds = created.staff.filter((id): id is string => !!id);
  const actIds = created.activities.filter((id): id is string => !!id);
  if (stuIds.length) {
    await hush("delete auditLogs(student actor)", db.delete(auditLogs).where(inArray(auditLogs.actorStudentId, stuIds)), errors);
    await hush("delete notifications(student)", db.delete(notifications).where(inArray(notifications.studentId, stuIds)), errors);
  }
  if (staffIds.length) {
    await hush("delete auditLogs(staff actor)", db.delete(auditLogs).where(inArray(auditLogs.actorStaffId, staffIds)), errors);
    await hush("delete notifications(staff)", db.delete(notifications).where(inArray(notifications.staffId, staffIds)), errors);
  }
  if (storagePaths.length) {
    await hush("delete attachment uploads(path)", db.delete(attachmentUploads).where(inArray(attachmentUploads.storagePath, storagePaths)), errors);
  }
  if (stuIds.length) {
    await hush("delete attachment uploads(student)", db.delete(attachmentUploads).where(inArray(attachmentUploads.studentId, stuIds)), errors);
  }
  if (actIds.length) await hush("delete activities", db.delete(activities).where(inArray(activities.id, actIds)), errors);
  if (staffIds.length) await hush("delete staff", db.delete(staff).where(inArray(staff.id, staffIds)), errors);
  if (stuIds.length) await hush("delete students", db.delete(students).where(inArray(students.studentId, stuIds)), errors);
  if (created.sessions.length) await hush("delete sessions", db.delete(sessions).where(inArray(sessions.id, created.sessions)), errors);
}

async function readCounters(kind: "request" | "certificate"): Promise<CounterRow[]> {
  const t = kind === "request" ? requestCounters : certificateCounters;
  return db.select({ year: t.year, lastNumber: t.lastNumber }).from(t);
}

// restore ONLY the counter years this run touched, and refuse to write if a
// concurrent change raced in after the post-run capture (never clobber silently)
async function restoreCounters(errors: string[]) {
  if (!countersCaptured) return;
  for (const kind of ["request", "certificate"] as const) {
    let capture: CounterRow[];
    try { capture = await readCounters(kind); }
    catch (e) { errors.push(`read post-run ${kind}_counters: ${e instanceof Error ? e.message : String(e)}`); continue; }
    const snapshot = countersSnapshot[kind];
    const snapshotByYear = new Map(snapshot.map(r => [r.year, r.lastNumber]));
    const byYear = new Map(capture.map(r => [r.year, r.lastNumber]));
    const updated: { year: number; value: number }[] = [];
    const deleted: { year: number; value: number }[] = [];
    for (const r of capture) {
      const snapVal = snapshotByYear.get(r.year);
      if (snapVal === undefined) deleted.push({ year: r.year, value: r.lastNumber });
      else if (snapVal !== r.lastNumber) updated.push({ year: r.year, value: snapVal });
    }
    for (const s of snapshot) {
      if (!byYear.has(s.year)) updated.push({ year: s.year, value: s.lastNumber }); // snapshot row vanished -> restore
    }
    if (updated.length === 0 && deleted.length === 0) continue;
    // race check: re-read must equal the post-run capture for every touched year
    let verify: CounterRow[];
    try { verify = await readCounters(kind); }
    catch (e) { errors.push(`re-read ${kind}_counters: ${e instanceof Error ? e.message : String(e)}`); continue; }
    const verifyByYear = new Map(verify.map(r => [r.year, r.lastNumber]));
    const raced = [...updated, ...deleted].filter(x => verifyByYear.get(x.year) !== byYear.get(x.year));
    if (raced.length > 0) {
      errors.push(`ABORT ${kind}_counters restore: concurrent change detected on year(s) ${raced.map(x => x.year).join(",")} since post-run capture — refusing to overwrite`);
      continue;
    }
    const t = kind === "request" ? requestCounters : certificateCounters;
    for (const x of updated) {
      await hush(`restore ${kind}_counters year=${x.year}`, db.insert(t).values({ year: x.year, lastNumber: x.value }).onConflictDoUpdate({ target: t.year, set: { lastNumber: x.value } }), errors);
    }
    for (const x of deleted) {
      await hush(`delete ${kind}_counters year=${x.year}`, db.delete(t).where(eq(t.year, x.year)), errors);
    }
  }
}

async function countRows(label: string, q: Promise<unknown[]>, leftover: string[]) {
  try { const r = await q; if (r.length > 0) leftover.push(`${label}: ${r.length}`); }
  catch (e) { leftover.push(`${label} CHECK ERROR: ${e instanceof Error ? e.message : String(e)}`); }
}

async function checkCountersResidue(kind: "request" | "certificate", snapshot: CounterRow[], leftover: string[]) {
  let cur: CounterRow[];
  try { cur = await readCounters(kind); }
  catch (e) { leftover.push(`${kind}_counters CHECK ERROR: ${e instanceof Error ? e.message : String(e)}`); return; }
  const a = new Map(snapshot.map(r => [r.year, r.lastNumber]));
  const b = new Map(cur.map(r => [r.year, r.lastNumber]));
  const diffs: string[] = [];
  for (const y of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(y) !== b.get(y)) diffs.push(`${y}:${a.get(y) ?? "none"} != ${b.get(y) ?? "none"}`);
  }
  if (diffs.length) leftover.push(`${kind}_counters diff: ${diffs.join(", ")}`);
}

async function collectResidue(): Promise<string[]> {
  const leftover: string[] = [];
  const reqIds = created.requests.filter((id): id is string => !!id);
  const stuIds = created.students.filter((id): id is string => !!id);
  const staffIds = created.staff.filter((id): id is string => !!id);
  const actIds = created.activities.filter((id): id is string => !!id);
  const storagePaths = created.storagePaths.filter((path): path is string => !!path);
  const attIdSet = new Set(created.attachments.filter((id): id is string => !!id));
  if (reqIds.length) {
    try {
      const atts = await db.select({ id: requestAttachments.id }).from(requestAttachments).where(inArray(requestAttachments.requestId, reqIds));
      for (const att of atts) attIdSet.add(att.id);
    } catch (e) {
      leftover.push(`attachments lookup CHECK ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const attIds = [...attIdSet];
  await countRows("students", db.select().from(students).where(inArray(students.studentId, stuIds)), leftover);
  await countRows("staff", db.select().from(staff).where(inArray(staff.id, staffIds)), leftover);
  await countRows("activities", db.select().from(activities).where(inArray(activities.id, actIds)), leftover);
  await countRows("requests", db.select().from(requests).where(inArray(requests.id, reqIds)), leftover);
  await countRows("attachments", db.select().from(requestAttachments).where(inArray(requestAttachments.id, attIds)), leftover);
  await countRows("revisions", db.select().from(requestAttachmentRevisions).where(inArray(requestAttachmentRevisions.attachmentId, attIds)), leftover);
  if (storagePaths.length) await countRows("attachmentUploads(path)", db.select().from(attachmentUploads).where(inArray(attachmentUploads.storagePath, storagePaths)), leftover);
  if (stuIds.length) await countRows("attachmentUploads(student)", db.select().from(attachmentUploads).where(inArray(attachmentUploads.studentId, stuIds)), leftover);
  await countRows("notifications(request)", db.select().from(notifications).where(inArray(notifications.requestId, reqIds)), leftover);
  if (stuIds.length) await countRows("notifications(student)", db.select().from(notifications).where(inArray(notifications.studentId, stuIds)), leftover);
  if (staffIds.length) await countRows("notifications(staff)", db.select().from(notifications).where(inArray(notifications.staffId, staffIds)), leftover);
  await countRows("auditLogs(request)", db.select().from(auditLogs).where(and(inArray(auditLogs.targetId, reqIds), eq(auditLogs.targetType, "request"))), leftover);
  if (stuIds.length) await countRows("auditLogs(student)", db.select().from(auditLogs).where(inArray(auditLogs.actorStudentId, stuIds)), leftover);
  if (staffIds.length) await countRows("auditLogs(staff)", db.select().from(auditLogs).where(inArray(auditLogs.actorStaffId, staffIds)), leftover);
  if (created.sessions.length) await countRows("sessions", db.select().from(sessions).where(inArray(sessions.id, created.sessions)), leftover);
  if (countersCaptured) {
    await checkCountersResidue("request", countersSnapshot.request, leftover);
    await checkCountersResidue("certificate", countersSnapshot.certificate, leftover);
  }
  return leftover;
}

async function main(): Promise<number> {
  const testRun = randomUUID();
  const prefix = `gate-${testRun.slice(0, 6)}`;

  console.log(`=== GATE SMOKE TEST RUN ${testRun.slice(0, 8)} ===`);

  // hard requirement: this script may only run against the local ua_dev DB.
  // abort before touching the database when DATABASE_URL is missing/non-local.
  if (process.env.GATE_SMOKE_EXCLUSIVE_DB !== "1") {
    console.error("ABORT gate-smoke: set GATE_SMOKE_EXCLUSIVE_DB=1 (this script must only run against the local ua_dev database)");
    return 2;
  }
  const guardReason = assertLocalDevDb(process.env.DATABASE_URL);
  if (guardReason) {
    console.error("ABORT gate-smoke:", guardReason);
    return 2;
  }
  const simulateCrash = process.env.GATE_SMOKE_SIMULATE_CRASH === "1";
  console.warn("GATE-SMOKE WARNING: run this only while no other process is using ua_dev — counters are restored to their pre-run values");

  const cleanupErrors: string[] = [];
  let crashExpected = "";
  let crashRaised = false;

  try {
    countersSnapshot = {
      request: await db.select({ year: requestCounters.year, lastNumber: requestCounters.lastNumber }).from(requestCounters),
      certificate: await db.select({ year: certificateCounters.year, lastNumber: certificateCounters.lastNumber }).from(certificateCounters),
    };
    countersCaptured = true;

    // GATE_SMOKE_SIMULATE_CRASH=1: prove cleanup still runs on crash. Seed a
    // partial setup (student + staff + activity) and bump request_counters,
    // then throw — the finally block must wipe it all and restore counters.
    if (simulateCrash) {
      const cr = randomUUID().slice(0, 6);
      const sid = `gate-crash-${cr}`;
      await db.insert(students).values({
        studentId: sid,
        firstName: "Gate",
        lastName: "Crash",
        major: "วิศวกรรมศาสตร์",
        admissionYear: 2024,
        status: "active",
        email: `gate-crash-${cr}@smoke.local`,
      });
      created.students.push(sid);
      const crashStaff = await ensureStaff({ email: `gate-crash-${cr}@smoke.local`, fullName: "Gate Crash", role: "staff", password: PASSWORD, staffCode: `gate-crash-${cr}` });
      created.staff.push(crashStaff.user.id);
      const crashAct = await db.insert(activities).values({
        title: `Gate Crash Activity ${cr}`,
        titleEn: `Gate Crash Activity ${cr}`,
        type: "activity",
        organizer: "Gate",
        date: new Date(),
        location: "พิษณุโลก",
        description: "tmp",
      }).returning();
      created.activities.push(crashAct[0].id);
      const crashYear = thaiBuddhistYear(new Date());
      await db.insert(requestCounters).values({ year: crashYear, lastNumber: 1 })
        .onConflictDoUpdate({ target: requestCounters.year, set: { lastNumber: sql`${requestCounters.lastNumber} + 1` } });
      crashExpected = `GATE_SMOKE_SIMULATE_CRASH after partial setup (${sid}) — cleanup must remove student/staff/activity and restore request_counters`;
      throw new SimulatedCrash(crashExpected);
    }

  // ---------- Test data setup (direct DB) ----------
  const now = new Date();
  async function addStudent(sid: string, email: string, status: "active" | "graduated" | "withdrawn") {
    const [row] = await db.insert(students).values({
      studentId: sid,
      firstName: "Gate",
      lastName: status === "active" ? "Active" : "Inactive",
      major: "วิศวกรรมศาสตร์",
      admissionYear: 2024,
      status,
      email,
    }).returning();
    created.students.push(sid);
    return row;
  }

  const activeA = await addStudent(`${prefix}A`, `gate-a-${prefix}@smoke.local`, "active");
  const activeB = await addStudent(`${prefix}B`, `gate-b-${prefix}@smoke.local`, "active");
  const inactiveC = await addStudent(`${prefix}C`, `gate-c-${prefix}@smoke.local`, "graduated");

  const adminStaff = await ensureStaff({ email: `gate-admin-${prefix}@smoke.local`, fullName: "Gate Admin", role: "admin", password: PASSWORD, staffCode: `gate-admin-${prefix}` });
  const plainStaff = await ensureStaff({ email: `gate-staff-${prefix}@smoke.local`, fullName: "Gate Staff", role: "staff", password: PASSWORD, staffCode: `gate-staff-${prefix}` });
  created.staff.push(adminStaff.user.id, plainStaff.user.id);

  console.log("Setup done. Test users:", { activeA: activeA.studentId, activeB: activeB.studentId, inactiveC: inactiveC.studentId });

  // tiny valid PNG (1x1)
  const pngBytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));

  async function uploadRaw(cookie: string, bytes: Uint8Array, fileName: string, fileType: string) {
    const form = new FormData();
    form.append("file", new File([bytes], fileName, { type: fileType }), fileName);
    return api("/api/upload", { method: "POST", form, cookie: `ua_session=${cookie}` });
  }

  async function uploadAttachment(cookie: string, slot: number, fileName = "proof.png") {
    const response = await uploadRaw(cookie, pngBytes, fileName, "image/png");
    if (response.status !== 200 || !response.json?.storagePath) {
      throw new Error(`test upload failed: status=${response.status} error=${response.json?.error}`);
    }
    created.storagePaths.push(response.json.storagePath);
    return {
      response,
      attachment: {
        slot,
        fileName: response.json.fileName as string,
        fileType: response.json.fileType as string,
        fileSize: response.json.fileSize as number,
        storagePath: response.json.storagePath as string,
      },
    };
  }

  // ==========================================================
  // Verify 3: Runtime smoke — Student
  // ==========================================================

  // --- 3a. inactive student login blocked ---
  process.env.DEV_GOOGLE_EMAIL = inactiveC.email;
  const loginInactiveRes = await app.handle(new Request(`${BASE}/api/auth/google/callback?code=dev`));
  const inLoc = loginInactiveRes.headers.get("location") ?? "";
  const inSess = extractSessionCookie(loginInactiveRes);
  record("3a-inactive-block", loginInactiveRes.status === 302 && inLoc.includes("error=not_in_roster") && !inLoc.includes("not_active") && inSess === "", `status=${loginInactiveRes.status} loc=${inLoc}`);

  // also verify no session row created for inactive
  const inactiveSess = await db.select().from(sessions).where(eq(sessions.userId, inactiveC.studentId));
  record("3a-inactive-no-session", inactiveSess.length === 0, `sessions=${inactiveSess.length}`);

  // --- 3b. active student A login passes + session created ---
  process.env.DEV_GOOGLE_EMAIL = activeA.email;
  const loginARes = await app.handle(new Request(`${BASE}/api/auth/google/callback?code=dev`));
  const aLoc = loginARes.headers.get("location") ?? "";
  const cookieA = extractSessionCookie(loginARes);
  created.sessions.push(cookieA);
  record("3b-active-login", loginARes.status === 302 && cookieA !== "" && !aLoc.includes("error"), `status=${loginARes.status} hasCookie=${cookieA !== ""}`);

  const meA = await api("/api/me", { cookie: `ua_session=${cookieA}` });
  record("3b-me-a", meA.status === 200 && meA.json?.user?.id === activeA.studentId && meA.json?.user?.role === "student", `status=${meA.status} id=${meA.json?.user?.id}`);

  process.env.DEV_GOOGLE_EMAIL = activeB.email;
  const loginBRes = await app.handle(new Request(`${BASE}/api/auth/google/callback?code=dev`));
  const cookieB = extractSessionCookie(loginBRes);
  created.sessions.push(cookieB);
  record("3b-active-login-b", cookieB !== "", `cookieB=${cookieB !== ""}`);

  // --- 3c. staff admin login ---
  const loginAdmin = await api("/api/auth/password/signin", { method: "POST", body: { staffCode: adminStaff.user.staffCode, password: PASSWORD } });
  const cookieAdmin = loginAdmin.cookie;
  let cookieStaff = "";
  const loginStaffRes = await app.handle(new Request(`${BASE}/api/auth/password/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ staffCode: plainStaff.user.staffCode, password: PASSWORD }),
  }));
  cookieStaff = extractSessionCookie(loginStaffRes);
  created.sessions.push(cookieAdmin, cookieStaff);
  record("3c-staff-admin-login", loginAdmin.status === 200 && loginStaffRes.status === 200 && cookieAdmin !== "" && cookieStaff !== "", `admin=${loginAdmin.status} staff=${loginStaffRes.status}`);

  // --- 3d. staff request API → 403 ---
  const staffList = await api("/api/requests", { cookie: `ua_session=${cookieStaff}` });
  record("3d-staff-list-403", staffList.status === 403 && staffList.json?.error === "staff_cannot_access", `status=${staffList.status}`);

  // --- 3e. admin can create activity ---
  const actRes = await api("/api/activities", {
    method: "POST", cookie: `ua_session=${cookieAdmin}`,
    body: { title: `${prefix} กิจกรรมทดสอบ`, titleEn: `${prefix} Test Activity`, type: "อบรม", organizer: "Gate Lab", date: "2026-09-30T00:00:00.000Z", location: "ห้องทดสอบ" },
  });
  created.activities.push(actRes.json?.id);
  record("3e-admin-create-activity", actRes.status === 200 && !!actRes.json?.id, `status=${actRes.status}`);

  // --- upload from student ---
  const uploadedA1 = await uploadAttachment(cookieA, 1);
  const upRes = uploadedA1.response;
  record("3f-student-upload-ok", upRes.status === 200 && !!upRes.json?.storagePath, `status=${upRes.status} path=${upRes.json?.storagePath}`);
  record("13-upload-no-public-url", upRes.json?.url == null, `hasUrl=${upRes.json?.url != null}`);

  // --- magic-byte validation: all allowed signatures pass; spoofed/unknown content is rejected ---
  const validMagicFixtures = [
    { label: "jpeg", mime: "image/jpeg", ext: "jpg", name: "magic.jpg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]) },
    { label: "webp", mime: "image/webp", ext: "webp", name: "magic.webp", bytes: Uint8Array.from(Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==", "base64")) },
    { label: "gif", mime: "image/gif", ext: "gif", name: "magic.gif", bytes: Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64")) },
    { label: "pdf", mime: "application/pdf", ext: "pdf", name: "magic.pdf", bytes: Uint8Array.from(Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF", "ascii")) },
  ];
  for (const fixture of validMagicFixtures) {
    const result = await uploadRaw(cookieA, fixture.bytes, fixture.name, fixture.mime);
    if (result.json?.storagePath) created.storagePaths.push(result.json.storagePath);
    record(
      `14-valid-${fixture.label}-signature`,
      result.status === 200
        && result.json?.fileType === fixture.mime
        && result.json?.storagePath?.endsWith(`.${fixture.ext}`),
      `status=${result.status} type=${result.json?.fileType} ext=${result.json?.storagePath?.split(".").pop()}`,
    );
  }

  const [ledgerBeforeInvalidMagic] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(attachmentUploads)
    .where(eq(attachmentUploads.studentId, activeA.studentId));
  const spoofedMime = await uploadRaw(cookieA, pngBytes, "spoofed.pdf", "application/pdf");
  record(
    "14-spoofed-mime-rejected",
    spoofedMime.status === 400 && spoofedMime.json?.error === "file_type_mismatch",
    `status=${spoofedMime.status} err=${spoofedMime.json?.error}`,
  );
  const unknownSignature = await uploadRaw(
    cookieA,
    Uint8Array.from(Buffer.from("not a real png", "ascii")),
    "unknown.png",
    "image/png",
  );
  record(
    "14-unknown-signature-rejected",
    unknownSignature.status === 400 && unknownSignature.json?.error === "file_type_mismatch",
    `status=${unknownSignature.status} err=${unknownSignature.json?.error}`,
  );
  const [ledgerAfterInvalidMagic] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(attachmentUploads)
    .where(eq(attachmentUploads.studentId, activeA.studentId));
  record(
    "14-invalid-signatures-not-tracked",
    ledgerAfterInvalidMagic.count === ledgerBeforeInvalidMagic.count,
    `before=${ledgerBeforeInvalidMagic.count} after=${ledgerAfterInvalidMagic.count}`,
  );

  // --- upload from staff/admin rejected ---
  const formS = new FormData();
  formS.append("file", new File([pngBytes], "proof.png", { type: "image/png" }), "proof.png");
  const upStaff = await api("/api/upload", { method: "POST", form: formS, cookie: `ua_session=${cookieStaff}` });
  record("3g-staff-upload-403", upStaff.status === 403 && upStaff.json?.error === "only_students", `status=${upStaff.status} err=${upStaff.json?.error}`);
  const formAd = new FormData();
  formAd.append("file", new File([pngBytes], "proof.png", { type: "image/png" }), "proof.png");
  const upAdmin = await api("/api/upload", { method: "POST", form: formAd, cookie: `ua_session=${cookieAdmin}` });
  record("3h-admin-upload-403", upAdmin.status === 403 && upAdmin.json?.error === "only_students", `status=${upAdmin.status} err=${upAdmin.json?.error}`);

  // ==========================================================
  // Verify 5: Slot validation (create)
  // ==========================================================
  const activityId = actRes.json.id;
  const badSlots = [0, -1, 3, 99];
  for (const s of badSlots) {
    const r = await api("/api/requests", { method: "POST", cookie: `ua_session=${cookieA}`, body: { activityId, attachments: [{ slot: s, fileName: "x.png", fileType: "image/png", fileSize: 100, storagePath: "requests/x" }] } });
    record(`5-invalid-slot-${s}`, r.status === 400 && r.json?.error === "slot_must_be_1_or_2", `status=${r.status} err=${r.json?.error}`);
  }
  const dupSlot = await api("/api/requests", { method: "POST", cookie: `ua_session=${cookieA}`, body: { activityId, attachments: [{ slot: 1, fileName: "a.png", fileType: "image/png", fileSize: 100, storagePath: "requests/a" }, { slot: 1, fileName: "b.png", fileType: "image/png", fileSize: 100, storagePath: "requests/b" }] } });
  record("5-dup-slot", dupSlot.status === 400 && dupSlot.json?.error === "duplicate_slot", `status=${dupSlot.status} err=${dupSlot.json?.error}`);
  const noSlot1 = await api("/api/requests", { method: "POST", cookie: `ua_session=${cookieA}`, body: { activityId, attachments: [{ slot: 2, fileName: "a.png", fileType: "image/png", fileSize: 100, storagePath: "requests/a" }] } });
  record("5-missing-slot1", noSlot1.status === 400 && noSlot1.json?.error === "slot1_required", `status=${noSlot1.status} err=${noSlot1.json?.error}`);
  const emptySlot1 = await api("/api/requests", { method: "POST", cookie: `ua_session=${cookieA}`, body: { activityId, attachments: [] } });
  record("5-empty-attachments-slot1-required", emptySlot1.status === 400 && emptySlot1.json?.error === "slot1_required", `status=${emptySlot1.status} err=${emptySlot1.json?.error}`);

  // ==========================================================
  // Verify 8: upload ownership and one-time use
  // ==========================================================
  const countStudentRequests = async () => {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(requests)
      .where(eq(requests.studentId, activeA.studentId));
    return row.count;
  };
  const countBeforeOwnershipFailures = await countStudentRequests();
  const fakePath = `requests/${randomUUID()}.png`;
  const fakePathReq = await api("/api/requests", { method: "POST", cookie: `ua_session=${cookieA}`, body: { activityId, attachments: [{ slot: 1, fileName: "fake.png", fileType: "image/png", fileSize: 68, storagePath: fakePath }] } });
  record("8a-fake-path-rejected", fakePathReq.status === 400 && fakePathReq.json?.error === "attachment_ownership_invalid" && fakePathReq.json?.slot === 1, `status=${fakePathReq.status} err=${fakePathReq.json?.error}`);

  const uploadedB = await uploadAttachment(cookieB, 1, "student-b.png");
  const crossOwnerReq = await api("/api/requests", { method: "POST", cookie: `ua_session=${cookieA}`, body: { activityId, attachments: [uploadedB.attachment] } });
  const [crossOwnerLedger] = await db.select().from(attachmentUploads).where(eq(attachmentUploads.storagePath, uploadedB.attachment.storagePath));
  record("8b-cross-owner-path-rejected", crossOwnerReq.status === 400 && crossOwnerReq.json?.error === "attachment_ownership_invalid" && crossOwnerLedger?.consumedAt == null, `status=${crossOwnerReq.status} err=${crossOwnerReq.json?.error} unconsumed=${crossOwnerLedger?.consumedAt == null}`);
  const countAfterOwnershipFailures = await countStudentRequests();
  record("8b-failed-create-rollback", countAfterOwnershipFailures === countBeforeOwnershipFailures, `before=${countBeforeOwnershipFailures} after=${countAfterOwnershipFailures}`);

  // ==========================================================
  // Verify 3/5: create request with slots 1 + 2
  // ==========================================================
  const pathA = upRes.json.storagePath;
  const uploadedA2 = await uploadAttachment(cookieA, 2, "proof2.png");
  const createdReq = await api("/api/requests", { method: "POST", cookie: `ua_session=${cookieA}`, body: { activityId, attachments: [
    { slot: 1, fileName: "spoofed.exe", fileType: "application/octet-stream", fileSize: 1, storagePath: pathA },
    uploadedA2.attachment,
  ] } });
  created.requests.push(createdReq.json?.id);
  record("5-create-slot12", createdReq.status === 200 && createdReq.json?.status === "pending", `status=${createdReq.status} id=${createdReq.json?.id}`);

  const reqId = createdReq.json?.id;
  const dbReq = await db.select().from(requests).where(eq(requests.id, reqId));
  const dbAtts = await db.select().from(requestAttachments).where(eq(requestAttachments.requestId, reqId)).orderBy(requestAttachments.slot);
  const dbRevs = await db.select().from(requestAttachmentRevisions).where(inArray(requestAttachmentRevisions.attachmentId, dbAtts.map(a => a.id)));
  record("3-db-create-2slot", dbReq.length === 1 && dbReq[0].status === "pending" && dbAtts.length === 2 && dbAtts.every(a => !!a.currentRevisionId) && dbRevs.length === 2 && dbRevs.every(r => r.revisionNumber === 1 && r.revisionState === "unchanged"), `atts=${dbAtts.length} revs=${dbRevs.length}`);
  const canonicalA1 = dbAtts.find((a) => a.slot === 1);
  record("8c-server-metadata-canonical", canonicalA1?.fileName === "proof.png" && canonicalA1.fileType === "image/png" && canonicalA1.fileSize === pngBytes.byteLength, `name=${canonicalA1?.fileName} type=${canonicalA1?.fileType} size=${canonicalA1?.fileSize}`);

  const reuseReq = await api("/api/requests", { method: "POST", cookie: `ua_session=${cookieA}`, body: { activityId, attachments: [uploadedA1.attachment] } });
  const countAfterReuse = await countStudentRequests();
  record("8d-consumed-path-rejected", reuseReq.status === 400 && reuseReq.json?.error === "attachment_ownership_invalid" && countAfterReuse === countAfterOwnershipFailures + 1, `status=${reuseReq.status} err=${reuseReq.json?.error} requests=${countAfterReuse}`);

  const concurrentUpload = await uploadAttachment(cookieA, 1, "concurrent.png");
  const concurrentBody = { activityId, attachments: [concurrentUpload.attachment] };
  const concurrentResults = await Promise.all([
    api("/api/requests", { method: "POST", cookie: `ua_session=${cookieA}`, body: concurrentBody }),
    api("/api/requests", { method: "POST", cookie: `ua_session=${cookieA}`, body: concurrentBody }),
  ]);
  const concurrentWinner = concurrentResults.find((result) => result.status === 200);
  if (concurrentWinner?.json?.id) created.requests.push(concurrentWinner.json.id);
  const concurrentLoser = concurrentResults.find((result) => result.status === 400);
  const [concurrentLedger] = await db.select().from(attachmentUploads).where(eq(attachmentUploads.storagePath, concurrentUpload.attachment.storagePath));
  record(
    "8e-concurrent-reuse-rejected",
    !!concurrentWinner
      && concurrentLoser?.json?.error === "attachment_ownership_invalid"
      && concurrentLedger?.requestId === concurrentWinner.json?.id,
    `statuses=${concurrentResults.map((result) => result.status).join(",")} loser=${concurrentLoser?.json?.error} owner=${concurrentLedger?.requestId === concurrentWinner?.json?.id}`,
  );

  // detailed GET with revisions
  const detailA = await api(`/api/requests/${reqId}`, { cookie: `ua_session=${cookieA}` });
  record("3-get-detail-revisions", detailA.status === 200 && Array.isArray(detailA.json?.attachments) && detailA.json.attachments.length === 2 && detailA.json.attachments.every((a: any) => Array.isArray(a.revisions) && a.revisions.length === 1), `status=${detailA.status} atts=${detailA.json?.attachments?.length}`);

  // ==========================================================
  // Verify 13: private attachment signed URL authorization
  // ==========================================================
  const signedAtt = dbAtts[0];
  const signedRev = dbRevs.find((revision) => revision.attachmentId === signedAtt.id)!;
  const otherRev = dbRevs.find((revision) => revision.attachmentId !== signedAtt.id)!;
  const signedPath = `/api/attachments/${signedAtt.id}/signed-url`;
  const ownerSigned = await api(`${signedPath}?revisionId=${signedRev.id}`, { cookie: `ua_session=${cookieA}` });
  record(
    "13-owner-signed-url",
    ownerSigned.status === 200
      && ownerSigned.json?.expiresIn === 600
      && ownerSigned.json?.url?.startsWith("https://mock-storage.local/")
      && !ownerSigned.json?.url?.includes("/object/public/"),
    `status=${ownerSigned.status} expires=${ownerSigned.json?.expiresIn}`,
  );
  const adminSigned = await api(signedPath, { cookie: `ua_session=${cookieAdmin}` });
  record("13-admin-signed-url", adminSigned.status === 200 && adminSigned.json?.expiresIn === 600, `status=${adminSigned.status}`);
  const otherStudentSigned = await api(signedPath, { cookie: `ua_session=${cookieB}` });
  record("13-other-student-signed-url-403", otherStudentSigned.status === 403 && otherStudentSigned.json?.error === "forbidden", `status=${otherStudentSigned.status} err=${otherStudentSigned.json?.error}`);
  const staffSigned = await api(signedPath, { cookie: `ua_session=${cookieStaff}` });
  record("13-staff-signed-url-403", staffSigned.status === 403 && staffSigned.json?.error === "staff_cannot_access", `status=${staffSigned.status} err=${staffSigned.json?.error}`);
  const anonSigned = await api(signedPath);
  record("13-anon-signed-url-401", anonSigned.status === 401 && anonSigned.json?.error === "unauthorized", `status=${anonSigned.status}`);
  const mismatchedRevision = await api(`${signedPath}?revisionId=${otherRev.id}`, { cookie: `ua_session=${cookieA}` });
  record("13-revision-mismatch-404", mismatchedRevision.status === 404 && mismatchedRevision.json?.error === "attachment_revision_not_found", `status=${mismatchedRevision.status} err=${mismatchedRevision.json?.error}`);

  // ==========================================================
  // Verify 4: Revision state machine
  // ==========================================================

  // --- 4a. request-revision flag slot 1 only ---
  const revReq = await api(`/api/requests/${reqId}/request-revision`, { method: "POST", cookie: `ua_session=${cookieAdmin}`, body: { slots: [1] } });
  record("4a-request-revision-slot1", revReq.status === 200 && revReq.json?.status === "revision_required" && JSON.stringify(revReq.json?.slots) === "[1]", `status=${revReq.status} json=${JSON.stringify(revReq.json)}`);

  const afterFlag = await db.select().from(requestAttachmentRevisions).where(inArray(requestAttachmentRevisions.attachmentId, dbAtts.map(a => a.id))).orderBy(requestAttachmentRevisions.revisionNumber);
  const s1 = dbAtts.find(a => a.slot === 1)!;
  const s2 = dbAtts.find(a => a.slot === 2)!;
  const s1rev = afterFlag.find(r => r.attachmentId === s1.id)!;
  const s2rev = afterFlag.find(r => r.attachmentId === s2.id)!;
  record("4a-flag-states", s1rev.revisionState === "needs_revision" && s2rev.revisionState === "unchanged", `s1=${s1rev.revisionState} s2=${s2rev.revisionState}`);
  record("4a-old-rev-kept", afterFlag.length === 2 && afterFlag.every(r => r.revisionNumber === 1), `count=${afterFlag.length}`);

  const reqState = (await db.select().from(requests).where(eq(requests.id, reqId)))[0];
  record("4a-request-state", reqState.status === "revision_required", `status=${reqState.status}`);

  // --- 4b. request-revision from revision_required → rejected ---
  const revAgain = await api(`/api/requests/${reqId}/request-revision`, { method: "POST", cookie: `ua_session=${cookieAdmin}`, body: { slots: [2] } });
  record("4b-revision-from-revreq-400", revAgain.status === 400, `status=${revAgain.status} err=${revAgain.json?.error}`);

  // --- 4c. student B cannot resubmit A's request ---
  const bResub = await api(`/api/requests/${reqId}/resubmit`, { method: "POST", cookie: `ua_session=${cookieB}`, body: { attachments: [ { slot: 1, fileName: "proof.png", fileType: "image/png", fileSize: 68, storagePath: `requests/${randomUUID()}.png` } ] } });
  record("6-ownership-resubmit-b", bResub.status === 403 && bResub.json?.error === "forbidden", `status=${bResub.status} err=${bResub.json?.error}`);

  // --- 4d. anonymous resubmit → 401 ---
  const anonResub = await api(`/api/requests/${reqId}/resubmit`, { method: "POST", body: { attachments: [] } });
  record("6-anon-resubmit-401", anonResub.status === 401, `status=${anonResub.status}`);

  // --- 4e. resubmit with NO attachment replacement → failed (flagged slot 1 untouched) ---
  const noReplace = await api(`/api/requests/${reqId}/resubmit`, { method: "POST", cookie: `ua_session=${cookieA}`, body: { attachments: [] } });
  record("4e-resubmit-no-replace", noReplace.status === 400 && noReplace.json?.error === "flagged_slots_not_replaced", `status=${noReplace.status} err=${noReplace.json?.error}`);

  const stillFlagged = await db.select().from(requestAttachmentRevisions).where(inArray(requestAttachmentRevisions.id, [s1.currentRevisionId as string]));
  const stillReq = (await db.select().from(requests).where(eq(requests.id, reqId)))[0];
  record("4e-resubmit-noop-rollback", stillFlagged.length === 1 && (stillFlagged[0].id === s1rev.id) && stillFlagged[0].revisionState === "needs_revision" && stillReq.status === "revision_required", `reqStatus=${stillReq.status}`);

  // --- 4f. resubmit slot 1 replacement (new revision) ---
  const replacementA1 = await uploadAttachment(cookieA, 1, "replacement.png");
  const newPath1 = replacementA1.attachment.storagePath;
  const resubRes = await api(`/api/requests/${reqId}/resubmit`, { method: "POST", cookie: `ua_session=${cookieA}`, body: { attachments: [replacementA1.attachment] } });
  record("4f-resubmit-ok", resubRes.status === 200 && resubRes.json?.status === "pending", `status=${resubRes.status} json=${JSON.stringify(resubRes.json)}`);

  const afterResub = await db.select().from(requestAttachmentRevisions).where(inArray(requestAttachmentRevisions.attachmentId, [s1.id])).orderBy(requestAttachmentRevisions.revisionNumber);
  const s1After = (await db.select().from(requestAttachments).where(eq(requestAttachments.id, s1.id)))[0];
  record("4f-revision-created", afterResub.length === 2 && afterResub[1].revisionNumber === 2 && afterResub[1].revisionState === "resubmitted" && afterResub[1].storagePath === newPath1, `revs=${afterResub.length} newRevNum=${afterResub[1]?.revisionNumber} state=${afterResub[1]?.revisionState}`);
  record("4f-current-rev-updated", s1After.currentRevisionId === afterResub[1].id, `current=${s1After.currentRevisionId === afterResub[1].id}`);
  record("4f-old-rev-kept", afterResub[0].revisionState === "needs_revision" && afterResub[0].storagePath !== newPath1, `oldState=${afterResub[0].revisionState} oldPath=${afterResub[0].storagePath}`);
  const reqAfter = (await db.select().from(requests).where(eq(requests.id, reqId)))[0];
  record("4f-request-pending", reqAfter.status === "pending", `status=${reqAfter.status}`);

  // slot 2 unchanged
  const s2After = (await db.select().from(requestAttachmentRevisions).where(inArray(requestAttachmentRevisions.attachmentId, [s2.id])))[0];
  record("4f-slot2-untouched-rev", s2After.revisionNumber === 1 && s2After.revisionState === "unchanged", `rev=${s2After.revisionNumber} state=${s2After.revisionState}`);

  // ==========================================================
  // Verify 5: legacy slot 3 readable but not editable
  // ==========================================================
  // insert legacy-style request + slot 3 attachment + revision via direct DB (simulate pre-Phase3 data)
  const legacyReqId = randomUUID();
  const legacyAttId = randomUUID();
  const legacyRevId = randomUUID();
  await db.insert(requests).values({ id: legacyReqId, studentId: activeA.studentId, activityId, status: "revision_required", updatedAt: now }).onConflictDoNothing({});
  await db.insert(requestAttachments).values({ id: legacyAttId, requestId: legacyReqId, slot: 3, fileName: "legacy.png", fileType: "image/png", fileSize: 100, storagePath: `requests/${randomUUID()}.png` });
  await db.insert(requestAttachmentRevisions).values({ id: legacyRevId, attachmentId: legacyAttId, revisionNumber: 1, fileName: "legacy.png", fileType: "image/png", fileSize: 100, storagePath: `requests/${randomUUID()}.png`, revisionState: "unchanged" });
  await db.update(requestAttachments).set({ currentRevisionId: legacyRevId }).where(eq(requestAttachments.id, legacyAttId));
  created.requests.push(legacyReqId); created.attachments.push(legacyAttId); created.revisions.push(legacyRevId);

  const legacyDetail = await api(`/api/requests/${legacyReqId}`, { cookie: `ua_session=${cookieAdmin}` });
  record("5-legacy-slot3-readable", legacyDetail.status === 200 && legacyDetail.json?.attachments?.some((a: any) => a.slot === 3 && a.currentRevisionId), `status=${legacyDetail.status} slots=${JSON.stringify(legacyDetail.json?.attachments?.map((a: any) => a.slot))}`);

  const legacyResub = await api(`/api/requests/${legacyReqId}/resubmit`, { method: "POST", cookie: `ua_session=${cookieA}`, body: { attachments: [ { slot: 3, fileName: "x.png", fileType: "image/png", fileSize: 100, storagePath: "requests/x" } ] } });
  record("5-legacy-slot3-not-editable", legacyResub.status === 400 && legacyResub.json?.error === "invalid_slot", `status=${legacyResub.status} err=${legacyResub.json?.error}`);

  // ==========================================================
  // Verify 7: Transaction behavior
  // ==========================================================

  // rollback test: flag both slots on a fresh request; resubmit replaces only slot1 → must fail & roll everything back
  const rollUpload1 = await uploadAttachment(cookieA, 1, "roll-a.png");
  const rollUpload2 = await uploadAttachment(cookieA, 2, "roll-b.png");
  const rollReq = await api("/api/requests", { method: "POST", cookie: `ua_session=${cookieA}`, body: { activityId, attachments: [
    rollUpload1.attachment,
    rollUpload2.attachment,
  ] } });
  created.requests.push(rollReq.json?.id);
  await api(`/api/requests/${rollReq.json?.id}/request-revision`, { method: "POST", cookie: `ua_session=${cookieAdmin}`, body: { slots: [1, 2] } });

  const rollAtts = await db.select().from(requestAttachments).where(eq(requestAttachments.requestId, rollReq.json?.id)).orderBy(requestAttachments.slot);
  const rollRevsBefore = await db.select().from(requestAttachmentRevisions).where(inArray(requestAttachmentRevisions.attachmentId, rollAtts.map(a => a.id))).orderBy(requestAttachmentRevisions.revisionNumber);

  const partialUpload = await uploadAttachment(cookieA, 1, "partial-a.png");
  const partialResub = await api(`/api/requests/${rollReq.json?.id}/resubmit`, { method: "POST", cookie: `ua_session=${cookieA}`, body: { attachments: [partialUpload.attachment] } });
  record("7-rollback-trigger", partialResub.status === 400 && partialResub.json?.error === "flagged_slots_not_replaced", `status=${partialResub.status} err=${partialResub.json?.error}`);

  const rollRevsAfter = await db.select().from(requestAttachmentRevisions).where(inArray(requestAttachmentRevisions.attachmentId, rollAtts.map(a => a.id))).orderBy(requestAttachmentRevisions.revisionNumber);
  const rollReqNow = (await db.select().from(requests).where(eq(requests.id, rollReq.json?.id)))[0];
  const rollS1 = rollAtts.find(a => a.slot === 1)!;
  const rollS1Now = (await db.select().from(requestAttachments).where(eq(requestAttachments.id, rollS1.id)))[0];
  const revCountSame = rollRevsAfter.length === rollRevsBefore.length;
  const noNewRev = rollRevsAfter.every(r => r.revisionNumber === 1);
  const currentUnchanged = rollS1Now.currentRevisionId === rollS1.currentRevisionId;
  const reqStillRevReq = rollReqNow.status === "revision_required";
  const flagsIntact = rollRevsAfter.filter(r => r.attachmentId === rollS1.id || r.attachmentId === (rollAtts.find(a => a.slot === 2)!.id)).every(r => r.revisionState === "needs_revision");
  record("7-rollback-full-atomic", revCountSame && noNewRev && currentUnchanged && reqStillRevReq && flagsIntact, `revCount=${revCountSame} noNew=${noNewRev} curUnchg=${currentUnchanged} req=${reqStillRevReq} flags=${flagsIntact}`);
  const [partialLedger] = await db.select().from(attachmentUploads).where(eq(attachmentUploads.storagePath, partialUpload.attachment.storagePath));
  record("8f-resubmit-claim-rollback", partialLedger?.consumedAt == null && partialLedger?.requestId == null, `unconsumed=${partialLedger?.consumedAt == null} requestId=${partialLedger?.requestId ?? "none"}`);

  // then complete properly (replace both) → pending
  const completeUpload2 = await uploadAttachment(cookieA, 2, "complete-b.png");
  const completeResub = await api(`/api/requests/${rollReq.json?.id}/resubmit`, { method: "POST", cookie: `ua_session=${cookieA}`, body: { attachments: [
    partialUpload.attachment,
    completeUpload2.attachment,
  ] } });
  const rollReqDone = (await db.select().from(requests).where(eq(requests.id, rollReq.json?.id)))[0];
  record("7-rollback-recover", completeResub.status === 200 && rollReqDone.status === "pending", `status=${completeResub.status} req=${rollReqDone.status}`);

  // ==========================================================
  // Verify 4: admin actions guards (approve/reject/revision on revision_required → rejected)
  // ==========================================================
  // rollReqDone now 'pending'
  const adminActions: [string, () => Promise<any>][] = [];

  // approve from revision_required (use legacyReq? it's pending; create a fresh one and flag it)
  const guardUpload = await uploadAttachment(cookieA, 1, "guard.png");
  const guardReq = await api("/api/requests", { method: "POST", cookie: `ua_session=${cookieA}`, body: { activityId, attachments: [guardUpload.attachment] } });
  const guardReqId = guardReq.json?.id;
  created.requests.push(guardReqId);
  await api(`/api/requests/${guardReqId}/request-revision`, { method: "POST", cookie: `ua_session=${cookieAdmin}`, body: { slots: [1] } });
  const approveFromRevReq = await api(`/api/requests/${guardReqId}/approve`, { method: "POST", cookie: `ua_session=${cookieAdmin}` });
  record("4g-approve-from-revreq-400", approveFromRevReq.status === 400, `status=${approveFromRevReq.status} err=${approveFromRevReq.json?.error}`);
  const rejectFromRevReq = await api(`/api/requests/${guardReqId}/reject`, { method: "POST", cookie: `ua_session=${cookieAdmin}`, body: { reason: "test" } });
  record("4h-reject-from-revreq-400", rejectFromRevReq.status === 400, `status=${rejectFromRevReq.status} err=${rejectFromRevReq.json?.error}`);
  const revisionFromRevReq = await api(`/api/requests/${guardReqId}/request-revision`, { method: "POST", cookie: `ua_session=${cookieAdmin}`, body: { slots: [1] } });
  record("4i-revision-from-revreq-400", revisionFromRevReq.status === 400, `status=${revisionFromRevReq.status} err=${revisionFromRevReq.json?.error}`);

  // guardReq still revision_required (no partial)
  const guardReqNow = (await db.select().from(requests).where(eq(requests.id, guardReqId)))[0];
  record("7-guardreq-state-intact", guardReqNow.status === "revision_required", `status=${guardReqNow.status}`);

  // resubmit guardReq → pending, then reject from pending → ok
  const guardReplacement = await uploadAttachment(cookieA, 1, "guard-new.png");
  const guardResub = await api(`/api/requests/${guardReqId}/resubmit`, { method: "POST", cookie: `ua_session=${cookieA}`, body: { attachments: [guardReplacement.attachment] } });
  record("4j-guardreq-resubmit", guardResub.status === 200, `status=${guardResub.status}`);
  const rejectOk = await api(`/api/requests/${guardReqId}/reject`, { method: "POST", cookie: `ua_session=${cookieAdmin}`, body: { reason: "gate reject test" } });
  record("4k-reject-from-pending", rejectOk.status === 200 && rejectOk.json?.status === "rejected", `status=${rejectOk.status}`);
  const rejectAgain = await api(`/api/requests/${guardReqId}/reject`, { method: "POST", cookie: `ua_session=${cookieAdmin}`, body: { reason: "x" } });
  record("4l-reject-again-400", rejectAgain.status === 400, `status=${rejectAgain.status}`);

  // approve from pending → ok + current revisions approved (atomic)
  const approveUpload = await uploadAttachment(cookieA, 1, "approve.png");
  const approveReq = await api("/api/requests", { method: "POST", cookie: `ua_session=${cookieA}`, body: { activityId, attachments: [approveUpload.attachment] } });
  const approveReqId = approveReq.json?.id;
  created.requests.push(approveReqId);
  const approveRes = await api(`/api/requests/${approveReqId}/approve`, { method: "POST", cookie: `ua_session=${cookieAdmin}` });
  record("4m-approve-from-pending", approveRes.status === 200, `status=${approveRes.status} json=${JSON.stringify(approveRes.json)}`);
  const approveDbAtts = await db.select().from(requestAttachments).where(eq(requestAttachments.requestId, approveReqId));
  const approveDbRevs = await db.select().from(requestAttachmentRevisions).where(inArray(requestAttachmentRevisions.attachmentId, approveDbAtts.map(a => a.id)));
  const approveDbReq = (await db.select().from(requests).where(eq(requests.id, approveReqId)))[0];
  const allCurrentApproved = approveDbAtts.every(a => approveDbRevs.find(r => r.id === a.currentRevisionId)?.revisionState === "approved");
  record("7-approve-atomic-current-approved", approveDbReq.status === "approved" && allCurrentApproved, `req=${approveDbReq.status} allApproved=${allCurrentApproved} states=${JSON.stringify(approveDbRevs.map(r => r.revisionState))}`);
  const approveAgain = await api(`/api/requests/${approveReqId}/approve`, { method: "POST", cookie: `ua_session=${cookieAdmin}` });
  record("4n-approve-again-400", approveAgain.status === 400, `status=${approveAgain.status} err=${approveAgain.json?.error}`);

  // ==========================================================
  // Verify 6: ownership edges
  // ==========================================================
  const otherDetail = await api(`/api/requests/${reqId}`, { cookie: `ua_session=${cookieB}` });
  record("6-exclusive-detail-b-forbidden", otherDetail.status === 403, `status=${otherDetail.status} err=${otherDetail.json?.error}`);

  const staffDetail = await api(`/api/requests/${reqId}`, { cookie: `ua_session=${cookieStaff}` });
  record("6-staff-detail-403", staffDetail.status === 403 && staffDetail.json?.error === "staff_cannot_access", `status=${staffDetail.status}`);

  const patchOther = await api(`/api/requests/${reqId}`, { method: "PATCH", cookie: `ua_session=${cookieB}`, body: { note: "hacked" } });
  record("6-patch-other-403", patchOther.status === 403, `status=${patchOther.status} err=${patchOther.json?.error}`);

  const patchApproved = await api(`/api/requests/${approveReqId}`, { method: "PATCH", cookie: `ua_session=${cookieA}`, body: { note: "late edit" } });
  record("6-patch-approved-400", patchApproved.status === 400, `status=${patchApproved.status} err=${patchApproved.json?.error}`);

  // staff cannot request-revision / approve / resubmit
  const staffRev = await api(`/api/requests/${rollReq.json?.id}/request-revision`, { method: "POST", cookie: `ua_session=${cookieStaff}`, body: { slots: [1] } });
  record("6-staff-request-revision-403", staffRev.status === 403 && staffRev.json?.error === "admin_only", `status=${staffRev.status}`);
  const staffApprove = await api(`/api/requests/${rollReq.json?.id}/approve`, { method: "POST", cookie: `ua_session=${cookieStaff}` });
  record("6-staff-approve-403", staffApprove.status === 403 && staffApprove.json?.error === "admin_only", `status=${staffApprove.status}`);

  // student cannot approve
  const stuApprove = await api(`/api/requests/${rollReq.json?.id}/approve`, { method: "POST", cookie: `ua_session=${cookieA}` });
  record("6-student-approve-403", stuApprove.status === 403, `status=${stuApprove.status}`);

  // ==========================================================
  // Verify 8: storage
  // ==========================================================
  // new file actually stored & old path differs (already asserted above via storagePath)
  const finalS1Atts = await db.select().from(requestAttachments).where(eq(requestAttachments.requestId, reqId));
  const finalS1 = finalS1Atts.find(a => a.slot === 1)!;
  const finalS2 = finalS1Atts.find(a => a.slot === 2)!;
  const s1AllRevs = await db.select().from(requestAttachmentRevisions).where(eq(requestAttachmentRevisions.attachmentId, finalS1.id)).orderBy(requestAttachmentRevisions.revisionNumber);
  record("8-no-delete-old-file", s1AllRevs.length === 2 && s1AllRevs[0].storagePath !== s1AllRevs[1].storagePath, `revs=${s1AllRevs.length} paths=${JSON.stringify(s1AllRevs.map(r => r.storagePath))}`);

  // ==========================================================
  // Verify 9: staff management (admin only)
  // ==========================================================
  const listStaff = await api("/api/admin/staff", { cookie: `ua_session=${cookieAdmin}` });
  const staffRowExists = Array.isArray(listStaff.json) && listStaff.json.some((s: any) => s.id === plainStaff.user.id);
  record("9-staff-list-admin", listStaff.status === 200 && staffRowExists, `status=${listStaff.status} hasOwn=${staffRowExists}`);

  const staffListDeny = await api("/api/admin/staff", { cookie: `ua_session=${cookieStaff}` });
  record("9-staff-list-nonadmin-403", staffListDeny.status === 403 && staffListDeny.json?.error === "admin_only", `status=${staffListDeny.status}`);

  const newCode = `gate-created-${prefix}`;
  const createStaffRes = await api("/api/admin/staff", {
    method: "POST", cookie: `ua_session=${cookieAdmin}`,
    body: { staffCode: newCode, fullName: "Gate Created Staff", role: "staff", kind: "emergency", password: "Created123!" },
  });
  created.staff.push(createStaffRes.json?.id);
  record("9-staff-create", createStaffRes.status === 200 && createStaffRes.json?.staffCode === newCode && createStaffRes.json?.kind === "emergency", `status=${createStaffRes.status} code=${createStaffRes.json?.staffCode}`);

  // dup staffCode rejected
  const dupStaffRes = await api("/api/admin/staff", {
    method: "POST", cookie: `ua_session=${cookieAdmin}`,
    body: { staffCode: newCode, fullName: "Dup", role: "staff", password: "Created123!" },
  });
  record("9-staff-create-dup-400", dupStaffRes.status === 400 && dupStaffRes.json?.error === "staff_code_taken", `status=${dupStaffRes.status} err=${dupStaffRes.json?.error}`);

  // short password rejected
  const shortPassRes = await api("/api/admin/staff", {
    method: "POST", cookie: `ua_session=${cookieAdmin}`,
    body: { staffCode: `gate-short-${prefix}`, fullName: "Short", role: "staff", password: "123" },
  });
  record("9-staff-create-short-pass-400", shortPassRes.status === 400 && shortPassRes.json?.error === "password_too_short", `status=${shortPassRes.status} err=${shortPassRes.json?.error}`);

  // created staff can sign in with staffCode
  if (createStaffRes.json?.id) {
    const newStaffLogin = await api("/api/auth/password/signin", { method: "POST", body: { staffCode: newCode, password: "Created123!" } });
    const nsCookie = newStaffLogin.cookie;
    if (nsCookie) created.sessions.push(nsCookie);
    record("9-staff-new-login", newStaffLogin.status === 200 && nsCookie !== "" && newStaffLogin.json?.user?.role === "staff", `status=${newStaffLogin.status} role=${newStaffLogin.json?.user?.role}`);
  }

  // admin cannot disable self
  const adminSelfPatch = await api(`/api/admin/staff/${adminStaff.user.id}`, { method: "PATCH", cookie: `ua_session=${cookieAdmin}`, body: { isActive: false } });
  record("9-staff-disable-self-400", adminSelfPatch.status === 400 && adminSelfPatch.json?.error === "cannot_disable_self", `status=${adminSelfPatch.status} err=${adminSelfPatch.json?.error}`);

  // disable target staff → staffCode login blocked 403 account_disabled
  const disableTarget = await api(`/api/admin/staff/${plainStaff.user.id}`, { method: "PATCH", cookie: `ua_session=${cookieAdmin}`, body: { isActive: false } });
  const disabledLogin = await api("/api/auth/password/signin", { method: "POST", body: { staffCode: plainStaff.user.staffCode, password: PASSWORD } });
  record("9-staff-disable-block", disableTarget.status === 200 && disabledLogin.status === 403 && disabledLogin.json?.error === "account_disabled", `patch=${disableTarget.status} login=${disabledLogin.status} err=${disabledLogin.json?.error}`);

  // re-enable + reset password → login with new password works
  const resetRes = await api(`/api/admin/staff/${plainStaff.user.id}`, { method: "PATCH", cookie: `ua_session=${cookieAdmin}`, body: { isActive: true, password: "ResetPass456!" } });
  const resetLogin = await api("/api/auth/password/signin", { method: "POST", body: { staffCode: plainStaff.user.staffCode, password: "ResetPass456!" } });
  const oldPassLogin = await api("/api/auth/password/signin", { method: "POST", body: { staffCode: plainStaff.user.staffCode, password: PASSWORD } });
  if (resetLogin.cookie) created.sessions.push(resetLogin.cookie);
  record("9-staff-reset-password", resetRes.status === 200 && resetLogin.status === 200 && resetLogin.cookie !== "" && oldPassLogin.status === 401, `reset=${resetRes.status} new=${resetLogin.status} old=${oldPassLogin.status}`);

  // non-admin cannot patch
  const staffPatchDeny = await api(`/api/admin/staff/${adminStaff.user.id}`, { method: "PATCH", cookie: `ua_session=${cookieStaff}`, body: { fullName: "X" } });
  record("9-staff-patch-nonadmin-403", staffPatchDeny.status === 403, `status=${staffPatchDeny.status}`);

  // ==========================================================
  // Verify 10: request number vs certificate number (Plan B)
  // ==========================================================
  // NOTE: this section REQUIRES migration 0014 (request_counters +
  // requests.request_sequence/request_year) applied to the DB it runs against.
  // creating() uploads a real file through the API first so the storagePath
  // comes from the upload endpoint (not fabricated).
  const creating = async (slot: number) => {
    const uploaded = await uploadAttachment(cookieA, slot, "rn.png");
    return [uploaded.attachment];
  };
  const rnRe = /^\d{3,}\/\d{4}$/; // sequence padded to ≥3 digits + Buddhist year

  // 10a. create returns requestNumber; seq persisted, unique per request
  const rn1 = await api("/api/requests", { method: "POST", cookie: `ua_session=${cookieA}`, body: { activityId, attachments: await creating(1) } });
  const rn2 = await api("/api/requests", { method: "POST", cookie: `ua_session=${cookieA}`, body: { activityId, attachments: await creating(1) } });
  created.requests.push(rn1.json?.id, rn2.json?.id);
  const rn1num = rn1.json?.requestNumber as string | undefined;
  const rn2num = rn2.json?.requestNumber as string | undefined;
  record("10a-create-request-number", rn1.status === 200 && rn2.status === 200 && !!rn1num && !!rn2num && rnRe.test(rn1num) && rnRe.test(rn2num) && rn1num !== rn2num, `rn1=${rn1num} rn2=${rn2num}`);
  const rn1Db = (await db.select().from(requests).where(eq(requests.id, rn1.json?.id)))[0];
  record("10a-request-seq-persisted", rn1Db?.requestSequence != null && rn1Db?.requestYear != null, `seq=${rn1Db?.requestSequence} year=${rn1Db?.requestYear}`);

  // 10b. request-revision + resubmit → request number unchanged
  const rnRev = await api(`/api/requests/${rn1.json?.id}/request-revision`, { method: "POST", cookie: `ua_session=${cookieAdmin}`, body: { slots: [1] } });
  const rnResub = await api(`/api/requests/${rn1.json?.id}/resubmit`, { method: "POST", cookie: `ua_session=${cookieA}`, body: { attachments: await creating(1) } });
  const rn1Detail = await api(`/api/requests/${rn1.json?.id}`, { cookie: `ua_session=${cookieA}` });
  record("10b-seq-unchanged-revision-resubmit", rnRev.status === 200 && rnResub.status === 200 && (rn1Detail.json?.requestNumber ?? null) === rn1num, `reqNum=${rn1Detail.json?.requestNumber}`);

  // 10c. reject → next submit gets a NEW seq (no reuse)
  const rn2Reject = await api(`/api/requests/${rn2.json?.id}/reject`, { method: "POST", cookie: `ua_session=${cookieAdmin}`, body: { reason: "rn test" } });
  const rn3 = await api("/api/requests", { method: "POST", cookie: `ua_session=${cookieA}`, body: { activityId, attachments: await creating(1) } });
  created.requests.push(rn3.json?.id);
  const rn2Db = (await db.select().from(requests).where(eq(requests.id, rn2.json?.id)))[0];
  const rn3Db = (await db.select().from(requests).where(eq(requests.id, rn3.json?.id)))[0];
  record("10c-no-reuse-after-reject", rn2Reject.status === 200 && rn3.status === 200 && (rn3Db?.requestSequence ?? 0) > (rn2Db?.requestSequence ?? Number.MAX_SAFE_INTEGER), `rejectedSeq=${rn2Db?.requestSequence} newSeq=${rn3Db?.requestSequence}`);

  // 10d. independence: request number assigned at SUBMIT only (cert NULL),
  // certificate number assigned at APPROVE only, and approve must not touch
  // requestSequence/requestYear (different concerns, different counters).
  const rn3Before = (await db.select().from(requests).where(eq(requests.id, rn3.json?.id)))[0];
  const rn3Approve = await api(`/api/requests/${rn3.json?.id}/approve`, { method: "POST", cookie: `ua_session=${cookieAdmin}` });
  const rn3Approved = (await db.select().from(requests).where(eq(requests.id, rn3.json?.id)))[0];
  record("10d-cert-independent-of-request-seq",
    rn3Approve.status === 200
    && rn3Before?.requestSequence != null && rn3Before?.certificateNumber == null
    && rn3Approved?.certificateNumber != null
    && rn3Approved?.requestSequence === rn3Before.requestSequence
    && rn3Approved?.requestYear === rn3Before.requestYear
    && rn3Approved?.certificateYear != null,
    `submitSeq=${rn3Before?.requestSequence} submitCert=${rn3Before?.certificateNumber} reqSeq=${rn3Approved?.requestSequence} reqYear=${rn3Approved?.requestYear} cert=${rn3Approved?.certificateNumber} certYear=${rn3Approved?.certificateYear}`);

  // 10e. legacy request (NULL request seq) → approve assigns cert only; seq stays NULL
  const legacyRnId = randomUUID();
  const legacyRnAttId = randomUUID();
  const legacyRnRevId = randomUUID();
  await db.insert(requests).values({ id: legacyRnId, studentId: activeA.studentId, activityId, status: "pending", updatedAt: now }).onConflictDoNothing({});
  await db.insert(requestAttachments).values({ id: legacyRnAttId, requestId: legacyRnId, slot: 1, fileName: "legacy.png", fileType: "image/png", fileSize: 100, storagePath: `requests/${randomUUID()}.png` });
  await db.insert(requestAttachmentRevisions).values({ id: legacyRnRevId, attachmentId: legacyRnAttId, revisionNumber: 1, fileName: "legacy.png", fileType: "image/png", fileSize: 100, storagePath: `requests/${randomUUID()}.png`, revisionState: "unchanged" });
  await db.update(requestAttachments).set({ currentRevisionId: legacyRnRevId }).where(eq(requestAttachments.id, legacyRnAttId));
  created.requests.push(legacyRnId); created.attachments.push(legacyRnAttId); created.revisions.push(legacyRnRevId);
  const legacyApprove = await api(`/api/requests/${legacyRnId}/approve`, { method: "POST", cookie: `ua_session=${cookieAdmin}` });
  const legacyRnDb = (await db.select().from(requests).where(eq(requests.id, legacyRnId)))[0];
  record("10e-legacy-null-seq-approve-cert-only", legacyApprove.status === 200 && legacyRnDb?.certificateNumber != null && legacyRnDb?.requestSequence == null, `cert=${legacyRnDb?.certificateNumber} reqSeq=${legacyRnDb?.requestSequence}`);

  // 10f. PDF filename uses certificateNumber when present; falls back to requestNumber for legacy
  const pdfNew = await generateCertificatePDFForEmail({
    requestNumber: rn3Approved.requestSequence,
    certificateNumber: rn3Approved.certificateNumber,
    location: "พิษณุโลก", dateDay: 1, dateMonth: "มกราคม", dateYear: 2569,
    studentName: "Gate Active", studentId: activeA.studentId, faculty: activeA.major, phone: null,
    approved: true, reason: null, reviewedDate: "01/01/2569",
  });
  const pdfLegacy = await generateCertificatePDFForEmail({
    requestNumber: legacyRnDb.certificateNumber,
    location: "พิษณุโลก", dateDay: 1, dateMonth: "มกราคม", dateYear: 2569,
    studentName: "Gate Active", studentId: activeA.studentId, faculty: activeA.major, phone: null,
    approved: true, reason: null, reviewedDate: "01/01/2569",
  });
  record("10f-pdf-filename-cert-number", pdfNew.filename.includes(`_${rn3Approved.certificateNumber}_`) && pdfLegacy.filename.includes(`_${legacyRnDb.certificateNumber}_`) && !pdfNew.filename.includes(`_${rn3Approved.requestSequence}_`), `new=${pdfNew.filename} legacy=${pdfLegacy.filename}`);

  // ==========================================================
  // Verify 11: timezone boundary (Asia/Bangkok, Buddhist year)
  // ==========================================================
  // requestYear must be derived from Bangkok local time, not UTC. A request
  // submitted at 2026-12-31T17:00:00Z is 2027-01-01 00:00 +07:00 -> year 2570.
  const tzCases: { iso: string; expYear: number; expDay: number }[] = [
    { iso: "2026-12-31T16:59:59.000Z", expYear: 2569, expDay: 31 }, // still Dec 31 in Bangkok
    { iso: "2026-12-31T17:00:00.000Z", expYear: 2570, expDay: 1 },  // UTC Dec 31 but Bangkok Jan 1
    { iso: "2027-01-01T00:00:00.000Z", expYear: 2570, expDay: 1 },  // UTC midnight still Jan 1 +07
    { iso: "2024-12-31T16:59:59.000Z", expYear: 2567, expDay: 31 }, // 2024+543
    { iso: "2024-12-31T17:00:00.000Z", expYear: 2568, expDay: 1 },  // 2025-01-01 Bangkok -> 2568
    { iso: "2026-06-15T04:00:00.000Z", expYear: 2569, expDay: 15 }, // midday Bangkok sanity
  ];
  let tzOk = true;
  const tzNotes: string[] = [];
  for (const c of tzCases) {
    const parts = thaiDateParts(new Date(c.iso));
    const buddhist = thaiBuddhistYear(new Date(c.iso));
    const ok = parts.year + 543 === c.expYear && parts.day === c.expDay && buddhist === c.expYear;
    if (!ok) tzOk = false;
    tzNotes.push(`${c.iso}->${parts.year}/${parts.day} (${buddhist})`);
  }
  const bangkokNow = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  tzNotes.push(`bangkokNow=${bangkokNow}`);
  record("11-tz-bangkok-year-boundary", tzOk, tzNotes.join(" "));

  } catch (e) {
    if (simulateCrash && e instanceof SimulatedCrash) {
      crashRaised = true;
      console.log(`CRASH HOOK (expected): ${e instanceof Error ? e.message : String(e)}`);
    } else {
      // real failure: let the bottom callback report and exit(2)
      throw e;
    }
  } finally {
    // cleanup runs on EVERY path (normal, crash, partial failure)
    await cleanupCreated(cleanupErrors);
    await restoreCounters(cleanupErrors);
    const residue = await collectResidue();
    const cleanupOk = cleanupErrors.length === 0 && residue.length === 0;

    record("12-cleanup-errors", cleanupErrors.length === 0, cleanupErrors.join(", ") || "none");
    record("12-cleanup-residue", residue.length === 0, residue.join(", ") || "none");
    if (simulateCrash) {
      record("12-crash-cleanup", crashRaised && cleanupOk, `crashRaised=${crashRaised} cleanupErrors=${cleanupErrors.length} residue=${residue.length} pass=${crashRaised && cleanupOk}`);
    }
  }

  // summary AFTER cleanup (so 12-* verdicts are included)
  console.log("\n================ GATE RESULTS ================");
  console.log(`PASS: ${passCount}  FAIL: ${failCount}`);
  if (failCount > 0) {
    for (const r of rows.filter(r => !r.pass)) console.log(`  FAIL: [${r.area}] ${r.note}`);
  }
  console.log("==============================================");

  return failCount > 0 ? 1 : 0;
}

main().then(async (exitCode) => {
  await pool.end();
  process.exit(exitCode);
}).catch(async (error) => {
  console.error("GATE ERROR:", error);
  await pool.end();
  process.exit(2);
});
