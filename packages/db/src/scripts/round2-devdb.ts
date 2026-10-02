/**
 * Local-only dev database `ua_dev_round2`: the current schema plus FAKE data,
 * for looking at the round-2 UI in a browser.
 *
 *   setup     clone ua_dev -> ua_dev_round2, apply 0016 through 0022 only
 *   seed      fill ua_dev_round2 with fake students/requests/staff and write
 *             apps/api/.env.dev-round2.local (git-ignored)
 *   reset     setup + seed
 *   teardown  drop ua_dev_round2
 *   fingerprint  print a schema + row-count digest of ua_dev_round2
 *
 * Safety rules, same as roster-testdb.ts:
 * - The source must be loopback and named `ua_dev`; anything else aborts.
 * - The target name is a constant and is never taken from the caller. Every
 *   command re-checks (via current_database() / inet_server_addr()) that it is
 *   connected to loopback:8520/ua_dev_round2 before it writes.
 * - ua_dev is only read (as a template) and never migrated or modified.
 * - No real data: students are generated from the lists below, not imported.
 *
 * Usage:
 *   bun src/scripts/round2-devdb.ts reset
 */

import { Client, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { hash } from "@node-rs/argon2";
import { spawnSync } from "child_process";
import { randomBytes, randomUUID } from "crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import * as schema from "../schema";

const SOURCE_DATABASE = "ua_dev";
const TARGET_DATABASE = "ua_dev_round2";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1"]);
const REQUIRED_PORT = 8520;

// Same list and order as roster-testdb.ts; never replay 0000-0015.
const MIGRATIONS_TO_APPLY = [
  "0016_roster_soft_delete_import_bind.sql",
  "0017_oauth_bind_attempt_limit.sql",
  "0018_remove_staff_email.sql",
  "0019_remove_legacy_activities.sql",
  "0020_durable_oauth_login_state.sql",
  "0021_staff_document_check.sql",
  "0022_request_revision_notes.sql",
] as const;

// scripts/ -> src/ -> db/ -> packages/ -> repo root
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "packages", "db", "drizzle");
const SOURCE_ENV_FILE = join(REPO_ROOT, "apps", "api", ".env");
const OUTPUT_ENV_FILE = join(REPO_ROOT, "apps", "api", ".env.dev-round2.local");
const PG_BIN_DIR = "C:\\Program Files\\PostgreSQL\\18\\bin";
const PSQL = join(PG_BIN_DIR, "psql.exe");
const PG_DUMP = join(PG_BIN_DIR, "pg_dump.exe");
const PG_RESTORE = join(PG_BIN_DIR, "pg_restore.exe");

interface DbTarget {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionString: string;
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

function parseTarget(connectionString: string, database: string): DbTarget {
  const url = new URL(connectionString);
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    connectionString: withDatabase(connectionString, database),
  };
}

function readSourceUrl(): string {
  if (!existsSync(SOURCE_ENV_FILE)) throw new Error(`source env file not found: ${SOURCE_ENV_FILE}`);
  const match = readFileSync(SOURCE_ENV_FILE, "utf8").match(/^\s*DATABASE_URL\s*=\s*(.+)$/m);
  if (!match) throw new Error(`DATABASE_URL not found in ${SOURCE_ENV_FILE}`);
  return match[1].trim().replace(/^["']|["']$/g, "");
}

/** Refuse unless the source really is the local dev database on loopback. */
function assertSafeSource(target: DbTarget): void {
  if (!LOOPBACK_HOSTS.has(target.host)) {
    throw new Error(`refusing non-loopback host "${target.host}"; only local databases are allowed`);
  }
  if (target.port !== REQUIRED_PORT) {
    throw new Error(`refusing port ${target.port}; expected ${REQUIRED_PORT}`);
  }
  if (target.database !== SOURCE_DATABASE) {
    throw new Error(`refusing source database "${target.database}"; expected "${SOURCE_DATABASE}"`);
  }
}

/** Ask the server itself where we are; never trust only the URL string. */
async function assertConnectedToTarget(client: Client | Pool): Promise<void> {
  const res = await client.query<{ database: string; address: string | null; port: number | null }>(
    `select current_database() as database, host(inet_server_addr()) as address, inet_server_port() as port`,
  );
  const row = res.rows[0];
  if (
    !row ||
    row.database !== TARGET_DATABASE ||
    row.address === null ||
    !LOOPBACK_ADDRESSES.has(row.address) ||
    Number(row.port) !== REQUIRED_PORT
  ) {
    throw new Error(
      `[round2] REFUSED: connected to ${row?.address}:${row?.port}/${row?.database}; expected loopback:${REQUIRED_PORT}/${TARGET_DATABASE}`,
    );
  }
}

async function maintenanceClient(source: DbTarget): Promise<Client> {
  const client = new Client({ connectionString: withDatabase(source.connectionString, "postgres") });
  await client.connect();
  return client;
}

async function databaseExists(admin: Client, database: string): Promise<boolean> {
  const res = await admin.query("select 1 from pg_database where datname = $1", [database]);
  return (res.rowCount ?? 0) > 0;
}

async function dropTargetDatabase(admin: Client, target: DbTarget): Promise<boolean> {
  if (target.database !== TARGET_DATABASE) throw new Error("internal: drop target mismatch");
  if (!(await databaseExists(admin, target.database))) return false;
  await admin.query(
    `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
    [target.database],
  );
  try {
    await admin.query(`DROP DATABASE ${quoteIdent(target.database)} WITH (FORCE)`);
  } catch {
    await admin.query(`DROP DATABASE ${quoteIdent(target.database)}`);
  }
  return true;
}

async function cloneWithTemplate(admin: Client, source: DbTarget, target: DbTarget): Promise<"template" | "dump"> {
  try {
    await admin.query(`CREATE DATABASE ${quoteIdent(target.database)} TEMPLATE ${quoteIdent(source.database)}`);
    return "template";
  } catch (error) {
    console.warn(`  ! CREATE DATABASE ... TEMPLATE failed (${error instanceof Error ? error.message : error})`);
    console.warn("  ! falling back to pg_dump / pg_restore");
    await cloneWithDump(admin, source, target);
    return "dump";
  }
}

async function cloneWithDump(admin: Client, source: DbTarget, target: DbTarget): Promise<void> {
  const dumpDir = mkdtempSync(join(tmpdir(), "ua-dev-round2-"));
  const dumpFile = join(dumpDir, "ua_dev.dump");
  const env = { ...process.env, PGPASSWORD: source.password };
  try {
    await admin.query(`CREATE DATABASE ${quoteIdent(target.database)}`);
    const dump = spawnSync(
      PG_DUMP,
      ["-h", source.host, "-p", String(source.port), "-U", source.user,
        "-d", source.database, "-Fc", "--no-owner", "--no-privileges", "-f", dumpFile],
      { env, encoding: "utf8" },
    );
    if (dump.status !== 0) throw new Error(`pg_dump failed (${dump.status}): ${dump.stderr}`);
    const restore = spawnSync(
      PG_RESTORE,
      ["-h", source.host, "-p", String(source.port), "-U", source.user,
        "-d", target.database, "--no-owner", "--no-privileges", "--exit-on-error", dumpFile],
      { env, encoding: "utf8" },
    );
    if (restore.status !== 0) throw new Error(`pg_restore failed (${restore.status}): ${restore.stderr}`);
  } finally {
    rmSync(dumpDir, { recursive: true, force: true });
  }
}

function applyMigrations(target: DbTarget): string[] {
  const env = { ...process.env, PGPASSWORD: target.password };
  const applied: string[] = [];
  for (const file of MIGRATIONS_TO_APPLY) {
    const path = join(MIGRATIONS_DIR, file);
    if (!existsSync(path) || statSync(path).size === 0) throw new Error(`migration file missing: ${path}`);
    const result = spawnSync(
      PSQL,
      ["-h", target.host, "-p", String(target.port), "-U", target.user,
        "-d", target.database, "-v", "ON_ERROR_STOP=1", "-q", "-f", path],
      { env, encoding: "utf8" },
    );
    if (result.status !== 0) throw new Error(`psql -f ${file} failed (${result.status}): ${result.stderr}`);
    applied.push(file);
  }
  return applied;
}

async function fingerprint(target: DbTarget): Promise<Record<string, number>> {
  const client = new Client({ connectionString: target.connectionString });
  await client.connect();
  try {
    const tables = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
    );
    const counts: Record<string, number> = {};
    for (const { table_name: table } of tables.rows) {
      const res = await client.query<{ n: string }>(`select count(*)::text as n from ${quoteIdent(table)}`);
      counts[table] = Number(res.rows[0]?.n ?? 0);
    }
    return counts;
  } finally {
    await client.end();
  }
}

async function setup(source: DbTarget, target: DbTarget): Promise<void> {
  const admin = await maintenanceClient(source);
  try {
    console.log(`source : ${source.host}:${source.port}/${source.database} (read-only template)`);
    if (await dropTargetDatabase(admin, target)) console.log(`dropped stale ${target.database}`);
    const method = await cloneWithTemplate(admin, source, target);
    console.log(`cloned : ${source.database} -> ${target.database} (${method})`);
    for (const file of applyMigrations(target)) console.log(`applied: ${file}`);
  } finally {
    await admin.end();
  }
}

async function teardown(source: DbTarget, target: DbTarget): Promise<void> {
  const admin = await maintenanceClient(source);
  try {
    console.log((await dropTargetDatabase(admin, target)) ? `dropped ${target.database}` : `${target.database} was not present`);
  } finally {
    await admin.end();
  }
}

// --- fake data ---------------------------------------------------------------

// Labels copied from FACULTY_ROWS in apps/api/src/certificate.ts so the
// certificate's major tick-box lookup works on the seeded students.
const MAJORS: Array<{ label: string; prefix: string; groups: number; weight: number }> = [
  { label: "สาขาวิชาการจัดการ", prefix: "กจ", groups: 10, weight: 40 }, // includes group 10 (natural sort)
  { label: "สาขาวิชาการตลาดเชิงสร้างสรรค์และดิจิทัล", prefix: "ตด", groups: 3, weight: 30 },
  { label: "สาขาการบัญชีบัณฑิต", prefix: "บช", groups: 5, weight: 35 },
  { label: "สาขาวิชานิเทศศาสตร์", prefix: "นศ", groups: 1, weight: 15 }, // single group
];

const FIRST_NAMES = [
  "สมชาย", "สมหญิง", "ณัฐพล", "กานดา", "ธนากร", "พิมพ์ชนก", "อภิชาต", "วริศรา", "ปรเมศวร์", "นภัสสร",
  "ชัยวัฒน์", "ศิริพร", "กิตติพงษ์", "อรทัย", "ภูมิพัฒน์", "ฐิติมา", "รัฐพล", "ปาริชาต", "ธีรภัทร", "จิราพร",
  "Somchai", "Napat", "Kanya", "Pimchanok",
];
const LAST_NAMES = [
  "ใจดี", "รักเรียน", "สุขสันต์", "มั่นคง", "เจริญผล", "ทองสุข", "แสนดี", "บุญมา", "ศรีสวัสดิ์", "พงษ์ไทย",
  "วงศ์ใหญ่", "นามสมมติ", "ตัวอย่าง", "ทดสอบ", "Testman", "Samplesri",
];

const NOTES = [
  "ขอเข้าร่วมกิจกรรมจิตอาสาพัฒนาชุมชน",
  "ขอหนังสือรับรองการเข้าร่วมกิจกรรมกีฬาสี",
  "ขอรับรองกิจกรรมค่ายอาสา ประจำภาคเรียนที่ 1/2568 รายละเอียดยาวเพื่อทดสอบการตัดบรรทัด " +
    "ซึ่งมีข้อความยาวต่อเนื่องไปอีกหลายบรรทัดเพื่อดูว่าการ์ดล้นจอหรือไม่",
  null,
  "ขอรับรองการอบรมเชิงปฏิบัติการ",
];

const REJECT_REASONS = ["เอกสารไม่ครบถ้วน", "ชื่อกิจกรรมไม่ตรงกับหลักฐานที่แนบ"];
const REVISION_NOTES = [
  "รูปหลักฐานไม่ชัด อ่านรายละเอียดไม่ออก กรุณาถ่ายใหม่ให้เห็นข้อความครบ",
  "ชื่อในเอกสารไม่ตรงกับชื่อนักศึกษา กรุณาแนบเอกสารที่ถูกต้อง",
  "ขาดหน้าที่ 2 ของเอกสาร กรุณาแนบให้ครบทุกหน้า",
  "ไฟล์เป็นภาพกลับด้าน กรุณาหมุนภาพให้อ่านได้แล้วอัปโหลดใหม่",
];

/** Deterministic PRNG so repeated seeds give the same screenshots. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPassword(): string {
  return randomBytes(12).toString("base64url");
}

async function hashPassword(plain: string): Promise<string> {
  // Same parameters as hashPassword in auth-helpers.ts.
  return hash(plain, { memoryCost: 19456, timeCost: 2, outputLen: 32, parallelism: 1 });
}

async function seed(target: DbTarget): Promise<void> {
  const pool = new Pool({ connectionString: target.connectionString, max: 2 });
  try {
    await assertConnectedToTarget(pool);
    const db = drizzle(pool, { schema });
    const rand = mulberry32(2569);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];

    // Clean slate inside the throwaway database (identity checked above).
    await pool.query(`
      TRUNCATE students, staff, sessions, audit_logs, requests, request_attachments,
        request_attachment_revisions, attachment_uploads, notifications, import_batches,
        request_counters, certificate_counters CASCADE
    `);

    const staffPassword = randomPassword();
    const adminPassword = randomPassword();
    const staffId = "dev-round2-staff";
    const adminId = "dev-round2-admin";
    const [staffHash, adminHash] = await Promise.all([hashPassword(staffPassword), hashPassword(adminPassword)]);
    await db.insert(schema.staff).values([
      { id: staffId, staffCode: "r2staff", passwordHash: staffHash, role: "staff", fullName: "เจ้าหน้าที่ ทดสอบรอบสอง" },
      { id: adminId, staffCode: "r2admin", passwordHash: adminHash, role: "admin", fullName: "ผู้ดูแล ทดสอบรอบสอง" },
    ]);

    // Students: ~120 active spread over 4 majors, uneven groups, some without a group.
    type StudentRow = typeof schema.students.$inferInsert;
    const studentRows: StudentRow[] = [];
    let serial = 0;
    const totalWeight = MAJORS.reduce((n, m) => n + m.weight, 0);
    const makeStudent = (
      major: (typeof MAJORS)[number],
      status: "active" | "graduated",
      groupName: string | null,
    ): StudentRow => {
      const studentId = `67${String(10000 + ++serial * 7).padStart(8, "0")}`;
      return {
        studentId,
        firstName: pick(FIRST_NAMES),
        lastName: pick(LAST_NAMES),
        major: major.label,
        groupName,
        level: "ปริญญาตรี",
        admissionYear: status === "graduated" ? 2564 : pick([2566, 2567, 2568]),
        status,
        email: `${studentId}@psru.ac.th`,
        phone: `08${String(10000000 + Math.floor(rand() * 89999999))}`,
      };
    };

    for (const major of MAJORS) {
      const count = Math.round((120 * major.weight) / totalWeight);
      for (let i = 0; i < count; i++) {
        // ~8% have no group; others are spread unevenly (earlier groups are bigger).
        let group: string | null = null;
        if (rand() > 0.08) {
          const n = 1 + Math.floor(Math.pow(rand(), 1.6) * major.groups);
          group = `${major.prefix}.${n}`;
        }
        studentRows.push(makeStudent(major, "active", group));
      }
      // Make sure the highest group exists so "10" really sorts after "2".
      studentRows.push(makeStudent(major, "active", `${major.prefix}.${major.groups}`));
    }
    const graduated = Array.from({ length: 5 }, (_, i) =>
      makeStudent(MAJORS[i % MAJORS.length], "graduated", `${MAJORS[i % MAJORS.length].prefix}.1`),
    );
    const deleted = Array.from({ length: 3 }, (_, i) => ({
      ...makeStudent(MAJORS[(i + 1) % MAJORS.length], "active", `${MAJORS[(i + 1) % MAJORS.length].prefix}.2`),
      deletedAt: new Date(Date.now() - (i + 1) * 86_400_000),
    }));
    const allStudents = [...studentRows, ...graduated, ...deleted];
    await db.insert(schema.students).values(allStudents);

    // Requests: ~60% of active (non-deleted) students, some with several.
    const activeStudents = studentRows;
    const now = Date.now();
    const statuses = ["pending", "pending", "pending", "revision_required", "approved", "approved", "rejected"] as const;
    let requestCount = 0;
    let checkedCount = 0;
    // The Google-bypass student: first one with a pending request that staff already checked.
    let bypassStudentEmail: string | null = null;
    let requestNumber = 0;
    let certificateNumber = 0;
    // Same rule as thaiBuddhistYear() in apps/api/src/app.ts: Asia/Bangkok year + 543.
    const requestYear =
      Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", year: "numeric" }).format(new Date())) + 543;
    const auditRows: Array<typeof schema.auditLogs.$inferInsert> = [];

    for (const student of activeStudents) {
      if (rand() > 0.6) continue;
      const howMany = rand() < 0.2 ? 2 + Math.floor(rand() * 2) : 1;
      for (let k = 0; k < howMany; k++) {
        const status = pick(statuses);
        const id = `r2-req-${randomUUID()}`;
        const submittedAt = new Date(now - Math.floor(rand() * 30 * 86_400_000) - 3_600_000);
        const decided = status === "approved" || status === "rejected";
        const notFuture = (d: Date) => new Date(Math.min(d.getTime(), now - 60_000));
        const reviewedAt = decided ? notFuture(new Date(submittedAt.getTime() + 2 * 86_400_000)) : null;
        // Staff-checked: some pending ones, plus most decided ones went through the check first.
        const staffChecked = status === "pending" ? rand() < 0.4 : decided ? rand() < 0.7 : false;
        const staffCheckedAt = staffChecked ? notFuture(new Date(submittedAt.getTime() + 20 * 3_600_000)) : null;
        if (staffChecked) checkedCount++;
        if (staffChecked && status === "pending" && !bypassStudentEmail) bypassStudentEmail = student.email as string;
        const isApproved = status === "approved";
        await db.insert(schema.requests).values({
          id,
          studentId: student.studentId,
          status,
          note: pick(NOTES),
          rejectionReason: status === "rejected" || status === "revision_required" ? pick(REJECT_REASONS) : null,
          requestSequence: ++requestNumber,
          requestYear,
          certificateNumber: isApproved ? ++certificateNumber : null,
          certificateYear: isApproved ? requestYear : null,
          reviewedById: decided ? adminId : null,
          reviewedAt,
          staffCheckedAt,
          staffCheckedById: staffChecked ? staffId : null,
          submittedAt,
          updatedAt: reviewedAt ?? staffCheckedAt ?? submittedAt,
        });
        requestCount++;

        const slots = rand() < 0.5 ? 1 : 2;
        for (let slot = 1; slot <= slots; slot++) {
          const attachmentId = `r2-att-${randomUUID()}`;
          const fileName = slot === 1 ? `หลักฐานกิจกรรม_${student.studentId}.png` : `รูปถ่ายกิจกรรม_${slot}.png`;
          await db.insert(schema.requestAttachments).values({
            id: attachmentId,
            requestId: id,
            slot,
            fileName,
            fileType: "image/png",
            fileSize: 20_000 + Math.floor(rand() * 400_000),
            storagePath: `dev-round2/${id}/${slot}.png`,
          });
          const [rev] = await db
            .insert(schema.requestAttachmentRevisions)
            .values({
              attachmentId,
              revisionNumber: 1,
              fileName,
              fileType: "image/png",
              fileSize: 20_000 + Math.floor(rand() * 400_000),
              storagePath: `dev-round2/${id}/${slot}.png`,
            })
            .returning({ id: schema.requestAttachmentRevisions.id });
          await db
            .update(schema.requestAttachments)
            .set({ currentRevisionId: rev.id })
            .where(eq(schema.requestAttachments.id, attachmentId));
        }

        if (status === "revision_required") {
          // Reason history (migration 0022): an earlier round for some, always a latest one.
          const first = new Date(submittedAt.getTime() + 6 * 3_600_000);
          const last = new Date(Math.min(submittedAt.getTime() + 30 * 3_600_000, now - 60_000));
          const notes: Array<typeof schema.requestRevisionNotes.$inferInsert> = [];
          if (rand() < 0.4) {
            notes.push({ requestId: id, authorStaffId: adminId, note: pick(REVISION_NOTES), slots: [1], createdAt: first });
          }
          notes.push({
            requestId: id,
            authorStaffId: adminId,
            note: pick(REVISION_NOTES),
            slots: slots === 2 && rand() < 0.5 ? [1, 2] : [1],
            createdAt: last,
          });
          await db.insert(schema.requestRevisionNotes).values(notes);
          const [slot1] = await db
            .select({ id: schema.requestAttachments.currentRevisionId })
            .from(schema.requestAttachments)
            .where(and(eq(schema.requestAttachments.requestId, id), eq(schema.requestAttachments.slot, 1)));
          if (slot1?.id) {
            await db
              .update(schema.requestAttachmentRevisions)
              .set({ revisionState: "needs_revision" })
              .where(eq(schema.requestAttachmentRevisions.id, slot1.id));
          }
        }

        if (staffChecked && staffCheckedAt) {
          auditRows.push({
            actorStaffId: staffId,
            action: "staff_check",
            targetType: "request",
            targetId: id,
            metadata: { status: "pending" },
            createdAt: staffCheckedAt,
          });
        }
        if (decided && reviewedAt) {
          auditRows.push({
            actorStaffId: adminId,
            action: isApproved ? "approve" : "reject",
            targetType: "request",
            targetId: id,
            metadata: isApproved ? {} : { reason: pick(REJECT_REASONS) },
            createdAt: reviewedAt,
          });
        }
      }
    }
    if (auditRows.length) await db.insert(schema.auditLogs).values(auditRows);

    // Counters so new approvals/requests in the browser continue the sequence.
    await pool.query(
      `insert into request_counters (year, last_number) values ($1, $2)
         on conflict (year) do update set last_number = excluded.last_number`,
      [requestYear, requestNumber],
    );
    await pool.query(
      `insert into certificate_counters (year, last_number) values ($1, $2)
         on conflict (year) do update set last_number = excluded.last_number`,
      [requestYear, certificateNumber],
    );

    writeEnvFile({
      staffPassword,
      adminPassword,
      devStudentEmail: bypassStudentEmail ?? (activeStudents[0].email as string),
      target,
    });

    console.log(`seeded : ${allStudents.length} students (${studentRows.length} active, ${graduated.length} graduated, ${deleted.length} soft-deleted)`);
    console.log(`         ${requestCount} requests, ${checkedCount} staff-checked, ${auditRows.length} audit rows`);
    console.log(`env    : ${OUTPUT_ENV_FILE}`);
  } finally {
    await pool.end();
  }
}

function writeEnvFile(opts: { staffPassword: string; adminPassword: string; devStudentEmail: string; target: DbTarget }): void {
  const url = new URL(opts.target.connectionString);
  const lines = [
    "# Local only. Generated by packages/db/src/scripts/round2-devdb.ts. Git-ignored (.env.*).",
    `DATABASE_URL=${url.toString()}`,
    "NODE_ENV=development",
    "API_PORT=3000",
    "WEB_ORIGIN=http://localhost:5173",
    "PUBLIC_API_URL=http://localhost:3000",
    "# Student sign-in: the Google bypass signs in as DEV_GOOGLE_EMAIL.",
    "AUTH_BYPASS_GOOGLE=true",
    `DEV_GOOGLE_EMAIL=${opts.devStudentEmail}`,
    "# Attachments resolve to https://mock-storage.local/... (no Supabase needed).",
    "GATE_SMOKE_MOCK_STORAGE=1",
    "# Password sign-in at /auth/signin",
    "R2_STAFF_CODE=r2staff",
    `R2_STAFF_PASSWORD=${opts.staffPassword}`,
    "R2_ADMIN_CODE=r2admin",
    `R2_ADMIN_PASSWORD=${opts.adminPassword}`,
    "",
  ];
  writeFileSync(OUTPUT_ENV_FILE, lines.join("\n"), "utf8");
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "fingerprint";
  const source = parseTarget(readSourceUrl(), SOURCE_DATABASE);
  assertSafeSource(source);
  const target = parseTarget(source.connectionString, TARGET_DATABASE);

  if (command === "setup") return setup(source, target);
  if (command === "seed") return seed(target);
  if (command === "reset") {
    await setup(source, target);
    return seed(target);
  }
  if (command === "teardown") return teardown(source, target);
  if (command === "fingerprint") {
    console.log(JSON.stringify(await fingerprint(target), null, 2));
    return;
  }
  throw new Error(`unknown command "${command}" (expected setup | seed | reset | teardown | fingerprint)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
