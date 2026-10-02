/**
 * Isolated integration-test database for the Phase 3 roster work.
 *
 * The roster integration tests need real rows (requests, attachments, sessions,
 * audit history) to prove that a soft delete preserves dependent data. The local
 * dev database `ua_dev` is a pre-roster snapshot and must not be migrated, so
 * the tests run against a throwaway clone:
 *
 *   setup     clone ua_dev -> ua_roster_test, apply 0016 through 0022 only
 *   teardown  drop ua_roster_test
 *   fingerprint  print a schema + row-count digest of a database
 *
 * Hard safety rules enforced below:
 * - The source MUST be a loopback host and the database MUST be named `ua_dev`.
 *   Any other value aborts, so this script can never touch a remote/production
 *   database.
 * - Only 0016 through 0022 are applied, explicitly, by file. The migration chain is
 *   never replayed and `drizzle-kit migrate` is never used, so `ua_dev` keeps
 *   its exact schema.
 * - The target database name is a constant and is never taken from the caller.
 *
 * Usage:
 *   bun src/scripts/roster-testdb.ts setup
 *   bun src/scripts/roster-testdb.ts teardown
 *   bun src/scripts/roster-testdb.ts fingerprint
 */

import { Client } from "pg";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { spawnSync } from "child_process";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const SOURCE_DATABASE = "ua_dev";
const TARGET_DATABASE = "ua_roster_test";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Applied in this exact order. These are the only seven files this script is
 * allowed to execute: 0016 adds roster soft delete / import / bind tables on
 * top of the 0015 schema, 0017 adds the bind attempt counter, and 0018 removes
 * the obsolete staff email identity, 0019 removes the legacy Activities entity,
 * 0020 adds durable OAuth login state, and 0021 adds the staff document check columns, and 0022 adds the revision notes table.
 */
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

async function readSourceEnv(): Promise<string> {
  if (!existsSync(SOURCE_ENV_FILE)) {
    throw new Error(`source env file not found: ${SOURCE_ENV_FILE}`);
  }
  const text = readFileSync(SOURCE_ENV_FILE, "utf8");
  const match = text.match(/^\s*DATABASE_URL\s*=\s*(.+)$/m);
  if (!match) {
    throw new Error(`DATABASE_URL not found in ${SOURCE_ENV_FILE}`);
  }
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function parseTarget(connectionString: string, database: string): DbTarget {
  const url = new URL(connectionString);
  const port = Number(url.port || 5432);
  return {
    host: url.hostname,
    port,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    connectionString: withDatabase(connectionString, database),
  };
}

function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * Refuse to continue unless the source really is the local dev database.
 * This is the guard that keeps the script away from production.
 */
function assertSafeSource(target: DbTarget): void {
  if (!LOOPBACK_HOSTS.has(target.host)) {
    throw new Error(
      `refusing to use non-loopback host "${target.host}"; only local databases are allowed`,
    );
  }
  if (target.database !== SOURCE_DATABASE) {
    throw new Error(
      `refusing to use source database "${target.database}"; expected "${SOURCE_DATABASE}"`,
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

async function countOtherConnections(admin: Client, database: string): Promise<number> {
  const res = await admin.query<{ n: string }>(
    `select count(*)::text as n from pg_stat_activity
      where datname = $1 and pid <> pg_backend_pid() and state <> 'idle'`,
    [database],
  );
  return Number(res.rows[0]?.n ?? 0);
}

/** Drop the target, force-terminating anything still attached to it. */
async function dropTargetDatabase(admin: Client, target: DbTarget): Promise<boolean> {
  if (!(await databaseExists(admin, target.database))) return false;
  // WITH (FORCE) needs PostgreSQL 13+. The explicit terminate is a fallback for
  // older servers and for connections the backend has not noticed yet.
  await admin.query(
    `select pg_terminate_backend(pid) from pg_stat_activity
      where datname = $1 and pid <> pg_backend_pid()`,
    [target.database],
  );
  try {
    await admin.query(`DROP DATABASE ${quoteIdent(target.database)} WITH (FORCE)`);
  } catch {
    await admin.query(`DROP DATABASE ${quoteIdent(target.database)}`);
  }
  return true;
}

async function cloneWithTemplate(
  admin: Client,
  source: DbTarget,
  target: DbTarget,
): Promise<"template" | "dump"> {
  const busy = await countOtherConnections(admin, source.database);
  try {
    await admin.query(
      `CREATE DATABASE ${quoteIdent(target.database)} TEMPLATE ${quoteIdent(source.database)}`,
    );
    return "template";
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`  ! CREATE DATABASE ... TEMPLATE failed (${reason})`);
    console.warn(`  ! non-idle connections on ${source.database}: ${busy}`);
    console.warn("  ! falling back to pg_dump / pg_restore");
    await cloneWithDump(admin, source, target);
    return "dump";
  }
}

/**
 * Portable fallback: dump the source with the PostgreSQL client binaries and
 * restore into a fresh database. Used when the server refuses to clone a
 * template that still has open connections.
 */
async function cloneWithDump(
  admin: Client,
  source: DbTarget,
  target: DbTarget,
): Promise<void> {
  const dumpDir = mkdtempSync(join(tmpdir(), "ua-roster-test-"));
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
    if (dump.status !== 0) {
      throw new Error(`pg_dump failed (${dump.status}): ${dump.stderr}`);
    }

    const restore = spawnSync(
      PG_RESTORE,
      ["-h", source.host, "-p", String(source.port), "-U", source.user,
        "-d", target.database, "--no-owner", "--no-privileges", "--exit-on-error", dumpFile],
      { env, encoding: "utf8" },
    );
    if (restore.status !== 0) {
      throw new Error(`pg_restore failed (${restore.status}): ${restore.stderr}`);
    }
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
    // `--> statement-breakpoint` markers are SQL comments, so psql runs the
    // file as-is with ON_ERROR_STOP guaranteeing a hard failure on any error.
    const result = spawnSync(
      PSQL,
      ["-h", target.host, "-p", String(target.port), "-U", target.user,
        "-d", target.database, "-v", "ON_ERROR_STOP=1", "-q", "-f", path],
      { env, encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(`psql -f ${file} failed (${result.status}): ${result.stderr}`);
    }
    applied.push(file);
  }
  return applied;
}

interface DatabaseFingerprint {
  database: string;
  host: string;
  tables: string[];
  studentsColumns: string[];
  rowCounts: Record<string, number>;
}

async function fingerprint(target: DbTarget): Promise<DatabaseFingerprint> {
  const client = new Client({ connectionString: target.connectionString });
  await client.connect();
  try {
    const tables = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name`,
    );
    const studentColumns = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'students'
        order by column_name`,
    );
    const counts: Record<string, number> = {};
    for (const { table_name: table } of tables.rows) {
      const res = await client.query<{ n: string }>(`select count(*)::text as n from ${quoteIdent(table)}`);
      counts[table] = Number(res.rows[0]?.n ?? 0);
    }
    return {
      database: target.database,
      host: target.host,
      tables: tables.rows.map((r) => r.table_name),
      studentsColumns: studentColumns.rows.map((r) => r.column_name),
      rowCounts: counts,
    };
  } finally {
    await client.end();
  }
}

async function setup(source: DbTarget, target: DbTarget): Promise<void> {
  const admin = await maintenanceClient(source);
  try {
    const before = await fingerprint(source);
    console.log(`source  : ${source.host}:${source.port}/${source.database}`);
    console.log(`baseline: ${before.tables.length} tables, students=${before.rowCounts.students ?? 0}`);

    if (await dropTargetDatabase(admin, target)) {
      console.log(`dropped stale ${target.database}`);
    }

    const method = await cloneWithTemplate(admin, source, target);
    console.log(`cloned  : ${source.database} -> ${target.database} (${method})`);

    const applied = applyMigrations(target);
    for (const file of applied) console.log(`applied : ${file}`);

    const after = await fingerprint(target);
    console.log(`target  : ${target.database} ready, ${(after.tables as string[]).length} tables`);
    console.log(
      `students columns: ${after.studentsColumns.includes("deleted_at") ? "deleted_at present" : "deleted_at MISSING"}`,
    );
    console.log(`source unchanged by setup: ${JSON.stringify((await fingerprint(source)).rowCounts) === JSON.stringify(before.rowCounts)}`);
  } finally {
    await admin.end();
  }
}

async function teardown(source: DbTarget, target: DbTarget): Promise<void> {
  const admin = await maintenanceClient(source);
  try {
    const dropped = await dropTargetDatabase(admin, target);
    console.log(dropped ? `dropped ${target.database}` : `${target.database} was not present`);
  } finally {
    await admin.end();
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "fingerprint";
  const source = parseTarget(await readSourceEnv(), SOURCE_DATABASE);
  assertSafeSource(source);
  const target = parseTarget(source.connectionString, TARGET_DATABASE);

  if (command === "setup") {
    await setup(source, target);
    return;
  }
  if (command === "teardown") {
    await teardown(source, target);
    return;
  }
  if (command === "fingerprint") {
    const which = process.argv[3] === "target" ? target : source;
    console.log(JSON.stringify(await fingerprint(which), null, 2));
    return;
  }
  throw new Error(`unknown command "${command}" (expected setup | teardown | fingerprint)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
