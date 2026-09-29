import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import ExcelJS from "exceljs";
import { and, count, eq, like, sql } from "drizzle-orm";

const TEST_DATABASE = "ua_roster_test";
const TEST_DATABASE_PORT = 8520;
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1"]);
const ORIGIN = "https://kingplapow.com";

if (process.env.ROSTER_TEST !== "1") {
  throw new Error("roster import integration tests must run through the test:roster-import wrapper");
}
process.env.NODE_ENV = "development";
process.env.AUTH_BYPASS_GOOGLE = "true";
process.env.GOOGLE_CLIENT_ID = "roster-import-test-client";
process.env.GOOGLE_CLIENT_SECRET = "roster-import-test-secret";
process.env.GOOGLE_HD = "psru.ac.th";
process.env.WEB_ORIGIN = ORIGIN;

const { app } = await import("../src/app");
const { db, pool } = await import("@ua/db/client");
const { auditLogs, importBatchItems, importBatches, sessions, staff, students } = await import("@ua/db/schema");

const STAFF_ID = "import-staff";
const ADMIN_ID = "import-admin";
const SEED = {
  unchanged: "6600000001",
  changed: "6600000002",
  deleted: "6600000003",
  bound: "6600000004",
  emailOwner: "6600000005",
  absent: "6600000006",
};
let staffCookie = "";
let adminCookie = "";
let studentCookie = "";

function cookieHeader(id: string): string {
  return `ua_session=${id}`;
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
  return cookieHeader(id);
}

async function request(method: string, path: string, cookie?: string, body?: BodyInit, contentType?: string) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (contentType) headers["content-type"] = contentType;
  const response = await app.handle(new Request(`${ORIGIN}${path}`, { method, headers, body }));
  const text = await response.text();
  let parsed: any = text;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, body: parsed };
}

async function previewFile(file: File, cookie = staffCookie) {
  const form = new FormData();
  form.set("file", file);
  return request("POST", "/api/roster/import/preview", cookie, form);
}

async function previewCsv(csv: string, cookie = staffCookie, name = "students.csv") {
  return previewFile(new File([csv], name, { type: "text/csv" }), cookie);
}

async function commit(batchId: string, cookie = staffCookie) {
  return request("POST", `/api/roster/import/${batchId}/commit`, cookie, JSON.stringify({}), "application/json");
}

const HEADER = "studentId,firstName,lastName,major,groupName,level,admissionYear,status,email,phone";
function row(values: Partial<Record<string, string>> = {}) {
  const data = {
    studentId: "7700000001",
    firstName: " ใหม่ ",
    lastName: " นักศึกษา ",
    major: " วิศวกรรม ",
    groupName: " 1 ",
    level: " ปริญญาตรี ",
    admissionYear: "2569",
    status: "active",
    email: " NEW@PSRU.AC.TH ",
    phone: "081-234-5678",
    ...values,
  };
  return [data.studentId, data.firstName, data.lastName, data.major, data.groupName, data.level,
    data.admissionYear, data.status, data.email, data.phone].join(",");
}

async function countRows(table: any, where?: any): Promise<number> {
  const [result] = await db.select({ n: count() }).from(table).where(where);
  return Number(result?.n ?? 0);
}

beforeAll(async () => {
  const identity = await pool.query<{ database: string; serverAddress: string | null; serverPort: number | null }>(`
    select current_database() as database, host(inet_server_addr()) as "serverAddress", inet_server_port() as "serverPort"
  `);
  const actual = identity.rows[0];
  if (!actual || actual.database !== TEST_DATABASE || actual.serverAddress === null ||
      !LOOPBACK_ADDRESSES.has(actual.serverAddress) || Number(actual.serverPort) !== TEST_DATABASE_PORT) {
    throw new Error("[test-db] REFUSED roster import fixture outside loopback ua_roster_test:8520");
  }
  await db.execute(sql`TRUNCATE import_batch_items, import_batches, audit_logs, sessions, students, staff CASCADE`);
  await db.insert(staff).values([
    { id: STAFF_ID, staffCode: "IMPORTSTAFF", passwordHash: "placeholder", role: "staff", fullName: "Import Staff" },
    { id: ADMIN_ID, staffCode: "IMPORTADMIN", passwordHash: "placeholder", role: "admin", fullName: "Import Admin" },
  ]);
  await db.insert(students).values([
    { studentId: SEED.unchanged, firstName: "เดิม", lastName: "หนึ่ง", major: "วิศวกรรม", groupName: "1", level: "ปริญญาตรี", admissionYear: 2567, status: "active", email: "same@psru.ac.th", phone: "0810000001" },
    { studentId: SEED.changed, firstName: "เดิม", lastName: "สอง", major: "วิศวกรรม", groupName: "1", level: "ปริญญาตรี", admissionYear: 2567, status: "active", email: null, phone: null },
    { studentId: SEED.deleted, firstName: "ลบ", lastName: "แล้ว", major: "วิศวกรรม", groupName: "1", level: "ปริญญาตรี", admissionYear: 2567, status: "withdrawn", deletedAt: new Date("2026-01-01T00:00:00Z") },
    { studentId: SEED.bound, firstName: "ผูก", lastName: "อีเมล", major: "วิศวกรรม", groupName: "1", level: "ปริญญาตรี", admissionYear: 2567, status: "active", email: "bound@psru.ac.th", emailBoundAt: new Date("2026-01-02T00:00:00Z") },
    { studentId: SEED.emailOwner, firstName: "เจ้าของ", lastName: "อีเมล", major: "วิศวกรรม", groupName: "1", level: "ปริญญาตรี", admissionYear: 2567, status: "active", email: "owner@psru.ac.th" },
    { studentId: SEED.absent, firstName: "ต้อง", lastName: "คงอยู่", major: "วิศวกรรม", groupName: "1", level: "ปริญญาตรี", admissionYear: 2567, status: "active" },
  ]);
  staffCookie = await makeSession(STAFF_ID, "staff");
  adminCookie = await makeSession(ADMIN_ID, "admin");
  studentCookie = await makeSession(SEED.unchanged, "student");
});

beforeEach(async () => {
  await db.delete(importBatches);
  await db.delete(auditLogs).where(like(auditLogs.action, "%import%"));
  await db.delete(students).where(like(students.studentId, "77%"));
  await db.update(students).set({
    firstName: "เดิม",
    email: null,
    emailBoundAt: null,
    deletedAt: null,
    status: "active",
    updatedAt: new Date("2026-01-10T00:00:00Z"),
  }).where(eq(students.studentId, SEED.changed));
});

afterAll(async () => {
  await pool.end();
});

describe("roster import authorization and parsing", () => {
  test("requires authentication and rejects Student while allowing Admin", async () => {
    const csv = `${HEADER}\n${row()}`;
    expect((await previewCsv(csv, "")).status).toBe(401);
    expect((await previewCsv(csv, studentCookie)).status).toBe(403);
    expect((await previewCsv(csv, adminCookie)).status).toBe(200);
  });

  test("protects commit with the same Staff/Admin authorization", async () => {
    const preview = await previewCsv(`${HEADER}\n${row({ studentId: "7700000009" })}`);
    expect((await commit(preview.body.batchId, "")).status).toBe(401);
    expect((await commit(preview.body.batchId, studentCookie)).status).toBe(403);
    expect((await commit(preview.body.batchId, adminCookie)).status).toBe(200);
  });

  test("previews valid CSV with BOM and quoted comma/newline without mutating students", async () => {
    const before = await countRows(students);
    const csv = `\uFEFF${HEADER}\n"7700000001","ชื่อ,ทดสอบ","สกุล\nต่อ","วิศวกรรม","1","ปริญญาตรี","2569","active","NEW@PSRU.AC.TH","081-234-5678"`;
    const result = await previewCsv(csv);
    expect(result.status).toBe(200);
    expect(result.body.summary).toMatchObject({ total: 1, valid: 1, new: 1, conflicts: 0, invalid: 0 });
    expect(result.body.rows[0].proposed).toMatchObject({ studentId: "7700000001", email: "new@psru.ac.th", phone: "0812345678" });
    expect(await countRows(students)).toBe(before);
  });

  test("previews the first worksheet of a valid XLSX and rejects formulas", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Roster");
    sheet.addRow(HEADER.split(","));
    sheet.addRow(row({ studentId: "7700000002" }).split(","));
    workbook.addWorksheet("Notes").addRow(["ignored"]);
    const bytes = await workbook.xlsx.writeBuffer();
    const valid = await previewFile(new File([bytes], "students.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    expect(valid.status).toBe(200);
    expect(valid.body.summary.new).toBe(1);

    const formulaBook = new ExcelJS.Workbook();
    const formulaSheet = formulaBook.addWorksheet("Roster");
    formulaSheet.addRow(HEADER.split(","));
    const values = row({ studentId: "7700000003" }).split(",");
    formulaSheet.addRow(values);
    formulaSheet.getCell("B2").value = { formula: 'CONCAT("bad","value")', result: "badvalue" };
    const formulaBytes = await formulaBook.xlsx.writeBuffer();
    const rejected = await previewFile(new File([formulaBytes], "formula.xlsx"));
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toBe("formula_cells_not_supported");
  });

  test("rejects unsupported, malformed and missing or ambiguous headers", async () => {
    expect((await previewFile(new File(["x"], "students.txt"))).body.error).toBe("unsupported_file_type");
    expect((await previewCsv('studentId,firstName\n"unterminated')).body.error).toBe("malformed_csv");
    expect((await previewCsv("studentId,firstName\n1,A")).body.error).toBe("missing_required_headers");
    const ambiguous = `${HEADER},student_id\n${row()},7700000001`;
    expect((await previewCsv(ambiguous)).body.error).toBe("ambiguous_headers");
  });

  test("enforces file, row and worksheet limits", async () => {
    const oversized = await previewFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "oversized.csv"));
    expect(oversized.status).toBe(413);
    expect(oversized.body.error).toBe("file_too_large");

    const rows = Array.from({ length: 501 }, (_, index) => row({ studentId: `78${String(index).padStart(8, "0")}` }));
    const tooManyRows = await previewCsv(`${HEADER}\n${rows.join("\n")}`);
    expect(tooManyRows.status).toBe(400);
    expect(tooManyRows.body.error).toBe("too_many_rows");

    const workbook = new ExcelJS.Workbook();
    for (let index = 0; index < 11; index += 1) {
      const sheet = workbook.addWorksheet(`Sheet ${index + 1}`);
      if (index === 0) {
        sheet.addRow(HEADER.split(","));
        sheet.addRow(row({ studentId: "7700000011" }).split(","));
      }
    }
    const bytes = await workbook.xlsx.writeBuffer();
    const tooManySheets = await previewFile(new File([bytes], "too-many-sheets.xlsx"));
    expect(tooManySheets.status).toBe(400);
    expect(tooManySheets.body.error).toBe("too_many_worksheets");
  });

  test("reports duplicate IDs/emails and invalid phone/status", async () => {
    const csv = `${HEADER}\n${row({ studentId: "7700000010", email: "dup@psru.ac.th" })}\n${row({ studentId: "7700000010", email: "DUP@PSRU.AC.TH", status: "pending", phone: "123" })}`;
    const result = await previewCsv(csv);
    expect(result.status).toBe(200);
    expect(result.body.summary.invalid).toBe(2);
    expect(result.body.rows[0].errors).toContain("duplicate_student_id_in_file");
    expect(result.body.rows[0].errors).toContain("duplicate_email_in_file");
    expect(result.body.rows[1].errors).toContain("invalid_status");
    expect(result.body.rows[1].errors).toContain("invalid_phone");
  });
});

describe("roster import classification and commit", () => {
  test("classifies unchanged, update, new, soft-delete, bound-email and DB-email cases", async () => {
    const lines = [
      row({ studentId: SEED.unchanged, firstName: "เดิม", lastName: "หนึ่ง", admissionYear: "2567", email: "same@psru.ac.th", phone: "0810000001" }),
      row({ studentId: SEED.changed, firstName: "ใหม่", lastName: "สอง", admissionYear: "2567", email: "", phone: "" }),
      row({ studentId: "7700000020", email: "fresh@psru.ac.th" }),
      row({ studentId: SEED.deleted, firstName: "ลบ", lastName: "แล้ว", admissionYear: "2567", status: "withdrawn", email: "", phone: "" }),
      row({ studentId: SEED.bound, firstName: "ผูก", lastName: "อีเมล", admissionYear: "2567", email: "other@psru.ac.th", phone: "" }),
      row({ studentId: "7700000021", email: "owner@psru.ac.th" }),
    ];
    const result = await previewCsv(`${HEADER}\n${lines.join("\n")}`);
    expect(result.status).toBe(200);
    expect(result.body.summary).toMatchObject({ total: 6, new: 1, updates: 1, unchanged: 1, conflicts: 3, invalid: 0 });
    expect(result.body.rows.map((entry: any) => entry.classification)).toEqual(["unchanged", "update", "new", "conflict", "conflict", "conflict"]);
    expect(result.body.rows[4].errors).toContain("bound_email_readonly");
    expect(result.body.rows[5].errors).toContain("email_conflicts_with_existing_student");
    expect((await commit(result.body.batchId)).body.error).toBe("import_batch_not_committable");
  });

  test("commits creates and updates with audits, skips unchanged, and never deletes absent students", async () => {
    const csv = `${HEADER}\n${row({ studentId: "7700000030", email: "created@psru.ac.th" })}\n${row({ studentId: SEED.changed, firstName: "อัปเดต", lastName: "สอง", admissionYear: "2567", email: "", phone: "" })}\n${row({ studentId: SEED.unchanged, firstName: "เดิม", lastName: "หนึ่ง", admissionYear: "2567", email: "same@psru.ac.th", phone: "0810000001" })}`;
    const preview = await previewCsv(csv);
    expect(preview.body.summary).toMatchObject({ new: 1, updates: 1, unchanged: 1 });
    const result = await commit(preview.body.batchId, adminCookie);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ created: 1, updated: 1, unchanged: 1 });
    const [created] = await db.select().from(students).where(eq(students.studentId, "7700000030"));
    const [updated] = await db.select().from(students).where(eq(students.studentId, SEED.changed));
    const [absent] = await db.select().from(students).where(eq(students.studentId, SEED.absent));
    expect(created.importBatchId).toBe(preview.body.batchId);
    expect(updated.firstName).toBe("อัปเดต");
    expect(absent).toBeDefined();
    expect(await countRows(auditLogs, and(eq(auditLogs.targetType, "student"), like(auditLogs.action, "student_import_%")))).toBe(2);
    expect(await countRows(auditLogs, and(eq(auditLogs.targetId, preview.body.batchId), eq(auditLogs.action, "roster_import_commit")))).toBe(1);
    const replay = await commit(preview.body.batchId);
    expect(replay.status).toBe(409);
    expect(replay.body.error).toBe("import_batch_already_committed");
  });

  test("rejects a stale preview without overwriting concurrent changes", async () => {
    const preview = await previewCsv(`${HEADER}\n${row({ studentId: SEED.changed, firstName: "จากไฟล์", lastName: "สอง", admissionYear: "2567", email: "", phone: "" })}`);
    await db.update(students).set({ firstName: "แก้พร้อมกัน", updatedAt: new Date() }).where(eq(students.studentId, SEED.changed));
    const result = await commit(preview.body.batchId);
    expect(result.status).toBe(409);
    expect(result.body.error).toBe("stale_preview");
    expect(result.body.conflicts[0].reason).toBe("student_changed_after_preview");
    const [student] = await db.select().from(students).where(eq(students.studentId, SEED.changed));
    expect(student.firstName).toBe("แก้พร้อมกัน");
  });

  test("rejects commit when email becomes bound after preview", async () => {
    const preview = await previewCsv(`${HEADER}\n${row({
      studentId: SEED.changed,
      firstName: "เดิม",
      lastName: "สอง",
      admissionYear: "2567",
      email: "from-import@psru.ac.th",
      phone: "",
    })}`);
    await db.update(students).set({
      email: "oauth-bound@psru.ac.th",
      emailBoundAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(students.studentId, SEED.changed));

    const result = await commit(preview.body.batchId);
    expect(result.status).toBe(409);
    expect(result.body.error).toBe("stale_preview");
    expect(result.body.conflicts.map((conflict: any) => conflict.reason)).toContain("email_bound_after_preview");
    const [student] = await db.select().from(students).where(eq(students.studentId, SEED.changed));
    expect(student.email).toBe("oauth-bound@psru.ac.th");
  });

  test("rolls back every mutation when an audit write fails", async () => {
    const preview = await previewCsv(`${HEADER}\n${row({ studentId: "7700000040", email: "rollback@psru.ac.th" })}`);
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION roster_import_test_fail_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'student_import_create' AND NEW.target_id = '7700000040' THEN
          RAISE EXCEPTION 'forced import audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER roster_import_test_fail_audit_trigger
      BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION roster_import_test_fail_audit();
    `);
    try {
      expect((await commit(preview.body.batchId)).status).toBe(500);
      expect(await countRows(students, eq(students.studentId, "7700000040"))).toBe(0);
      const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, preview.body.batchId));
      expect(batch.status).toBe("validated");
      expect(batch.importedRows).toBe(0);
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS roster_import_test_fail_audit_trigger ON audit_logs`);
      await db.execute(sql`DROP FUNCTION IF EXISTS roster_import_test_fail_audit()`);
    }
  });
});
