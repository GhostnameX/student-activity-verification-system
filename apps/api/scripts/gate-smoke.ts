import { app } from "../src/app";
import { db, pool } from "@ua/db/client";
import { students, staff, requests, requestAttachments, requestAttachmentRevisions, activities, sessions, notifications, auditLogs } from "@ua/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { ensureStaff } from "@ua/db/auth-helpers";

const BASE = "http://localhost:3000";
const GATE_TAG = "gate://";
const PASSWORD = "GateTest123!";

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

async function main() {
  const testRun = randomUUID();
  const prefix = `gate-${testRun.slice(0, 6)}`;

  console.log(`=== GATE SMOKE TEST RUN ${testRun.slice(0, 8)} ===`);

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

  const adminStaff = await ensureStaff({ email: `gate-admin-${prefix}@smoke.local`, fullName: "Gate Admin", role: "admin", password: PASSWORD });
  const plainStaff = await ensureStaff({ email: `gate-staff-${prefix}@smoke.local`, fullName: "Gate Staff", role: "staff", password: PASSWORD });
  created.staff.push(adminStaff.user.id, plainStaff.user.id);

  console.log("Setup done. Test users:", { activeA: activeA.studentId, activeB: activeB.studentId, inactiveC: inactiveC.studentId });

  // tiny valid PNG (1x1)
  const pngBytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));

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
  const loginAdmin = await api("/api/auth/password/signin", { method: "POST", body: { email: adminStaff.user.email, password: PASSWORD } });
  const cookieAdmin = loginAdmin.cookie;
  let cookieStaff = "";
  const loginStaffRes = await app.handle(new Request(`${BASE}/api/auth/password/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: plainStaff.user.email, password: PASSWORD }),
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
  const formA = new FormData();
  formA.append("file", new File([pngBytes], "proof.png", { type: "image/png" }), "proof.png");
  const upRes = await api("/api/upload", { method: "POST", form: formA, cookie: `ua_session=${cookieA}` });
  created.storagePaths.push(upRes.json?.storagePath);
  record("3f-student-upload-ok", upRes.status === 200 && !!upRes.json?.storagePath, `status=${upRes.status} path=${upRes.json?.storagePath}`);

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

  // ==========================================================
  // Verify 3/5: create request with slots 1 + 2 (real upload path reused)
  // ==========================================================
  const pathA = upRes.json.storagePath;
  const createdReq = await api("/api/requests", { method: "POST", cookie: `ua_session=${cookieA}`, body: { activityId, attachments: [
    { slot: 1, fileName: "proof.png", fileType: "image/png", fileSize: 68, storagePath: pathA },
    { slot: 2, fileName: "proof2.png", fileType: "image/png", fileSize: 68, storagePath: `requests/${randomUUID()}.png` },
  ] } });
  created.requests.push(createdReq.json?.id);
  record("5-create-slot12", createdReq.status === 200 && createdReq.json?.status === "pending", `status=${createdReq.status} id=${createdReq.json?.id}`);

  const reqId = createdReq.json?.id;
  const dbReq = await db.select().from(requests).where(eq(requests.id, reqId));
  const dbAtts = await db.select().from(requestAttachments).where(eq(requestAttachments.requestId, reqId)).orderBy(requestAttachments.slot);
  const dbRevs = await db.select().from(requestAttachmentRevisions).where(inArray(requestAttachmentRevisions.attachmentId, dbAtts.map(a => a.id)));
  record("3-db-create-2slot", dbReq.length === 1 && dbReq[0].status === "pending" && dbAtts.length === 2 && dbAtts.every(a => !!a.currentRevisionId) && dbRevs.length === 2 && dbRevs.every(r => r.revisionNumber === 1 && r.revisionState === "unchanged"), `atts=${dbAtts.length} revs=${dbRevs.length}`);

  // detailed GET with revisions
  const detailA = await api(`/api/requests/${reqId}`, { cookie: `ua_session=${cookieA}` });
  record("3-get-detail-revisions", detailA.status === 200 && Array.isArray(detailA.json?.attachments) && detailA.json.attachments.length === 2 && detailA.json.attachments.every((a: any) => Array.isArray(a.revisions) && a.revisions.length === 1), `status=${detailA.status} atts=${detailA.json?.attachments?.length}`);

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
  const newPath1 = `requests/${randomUUID()}.png`;
  created.storagePaths.push(newPath1);
  const resubRes = await api(`/api/requests/${reqId}/resubmit`, { method: "POST", cookie: `ua_session=${cookieA}`, body: { attachments: [ { slot: 1, fileName: "proof.png", fileType: "image/png", fileSize: 68, storagePath: newPath1 } ] } });
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
  const rollReq = await api("/api/requests", { method: "POST", cookie: `ua_session=${cookieA}`, body: { activityId, attachments: [
    { slot: 1, fileName: "a.png", fileType: "image/png", fileSize: 100, storagePath: `requests/${randomUUID()}.png` },
    { slot: 2, fileName: "b.png", fileType: "image/png", fileSize: 100, storagePath: `requests/${randomUUID()}.png` },
  ] } });
  created.requests.push(rollReq.json?.id);
  await api(`/api/requests/${rollReq.json?.id}/request-revision`, { method: "POST", cookie: `ua_session=${cookieAdmin}`, body: { slots: [1, 2] } });

  const rollAtts = await db.select().from(requestAttachments).where(eq(requestAttachments.requestId, rollReq.json?.id)).orderBy(requestAttachments.slot);
  const rollRevsBefore = await db.select().from(requestAttachmentRevisions).where(inArray(requestAttachmentRevisions.attachmentId, rollAtts.map(a => a.id))).orderBy(requestAttachmentRevisions.revisionNumber);

  const partialResub = await api(`/api/requests/${rollReq.json?.id}/resubmit`, { method: "POST", cookie: `ua_session=${cookieA}`, body: { attachments: [ { slot: 1, fileName: "new-a.png", fileType: "image/png", fileSize: 100, storagePath: `requests/${randomUUID()}.png` } ] } });
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

  // then complete properly (replace both) → pending
  const completeResub = await api(`/api/requests/${rollReq.json?.id}/resubmit`, { method: "POST", cookie: `ua_session=${cookieA}`, body: { attachments: [
    { slot: 1, fileName: "new-a.png", fileType: "image/png", fileSize: 100, storagePath: `requests/${randomUUID()}.png` },
    { slot: 2, fileName: "new-b.png", fileType: "image/png", fileSize: 100, storagePath: `requests/${randomUUID()}.png` },
  ] } });
  const rollReqDone = (await db.select().from(requests).where(eq(requests.id, rollReq.json?.id)))[0];
  record("7-rollback-recover", completeResub.status === 200 && rollReqDone.status === "pending", `status=${completeResub.status} req=${rollReqDone.status}`);

  // ==========================================================
  // Verify 4: admin actions guards (approve/reject/revision on revision_required → rejected)
  // ==========================================================
  // rollReqDone now 'pending'
  const adminActions: [string, () => Promise<any>][] = [];

  // approve from revision_required (use legacyReq? it's pending; create a fresh one and flag it)
  const guardReq = await api("/api/requests", { method: "POST", cookie: `ua_session=${cookieA}`, body: { activityId, attachments: [ { slot: 1, fileName: "a.png", fileType: "image/png", fileSize: 100, storagePath: `requests/${randomUUID()}.png` } ] } });
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
  const guardResub = await api(`/api/requests/${guardReqId}/resubmit`, { method: "POST", cookie: `ua_session=${cookieA}`, body: { attachments: [ { slot: 1, fileName: "new.png", fileType: "image/png", fileSize: 100, storagePath: `requests/${randomUUID()}.png` } ] } });
  record("4j-guardreq-resubmit", guardResub.status === 200, `status=${guardResub.status}`);
  const rejectOk = await api(`/api/requests/${guardReqId}/reject`, { method: "POST", cookie: `ua_session=${cookieAdmin}`, body: { reason: "gate reject test" } });
  record("4k-reject-from-pending", rejectOk.status === 200 && rejectOk.json?.status === "rejected", `status=${rejectOk.status}`);
  const rejectAgain = await api(`/api/requests/${guardReqId}/reject`, { method: "POST", cookie: `ua_session=${cookieAdmin}`, body: { reason: "x" } });
  record("4l-reject-again-400", rejectAgain.status === 400, `status=${rejectAgain.status}`);

  // approve from pending → ok + current revisions approved (atomic)
  const approveReq = await api("/api/requests", { method: "POST", cookie: `ua_session=${cookieA}`, body: { activityId, attachments: [ { slot: 1, fileName: "a.png", fileType: "image/png", fileSize: 100, storagePath: `requests/${randomUUID()}.png` } ] } });
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

  // summary
  console.log("\n================ GATE RESULTS ================");
  console.log(`PASS: ${passCount}  FAIL: ${failCount}`);
  if (failCount > 0) {
    for (const r of rows.filter(r => !r.pass)) console.log(`  FAIL: [${r.area}] ${r.note}`);
  }
  console.log("==============================================");

  // cleanup session rows created by logins (keep test data for DB-level verify step first)
  if (created.sessions.length) {
    await db.delete(sessions).where(inArray(sessions.id, created.sessions)).catch(() => {});
  }

  await pool.end();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("GATE ERROR:", e);
  await pool.end();
  process.exit(2);
});