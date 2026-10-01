import { resolve } from "node:path";

const API_ROOT = resolve(import.meta.dir, "..");
const TEST_ENV_FILE = resolve(API_ROOT, ".env.test.local");

function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const envFile = Bun.file(TEST_ENV_FILE);
if (!(await envFile.exists())) {
  throw new Error(`[test-db] missing ${TEST_ENV_FILE}`);
}

const testEnv = parseEnv(await envFile.text());
if (!testEnv.TEST_DATABASE_URL) {
  throw new Error(`[test-db] TEST_DATABASE_URL is required in ${TEST_ENV_FILE}`);
}

const mode = process.argv[2] ?? "roster";
const command =
  mode === "roster"
    ? [process.execPath, "test", "./scripts/roster-crud.integration.test.ts"]
    : mode === "requests"
      ? [process.execPath, "test", "./scripts/request-routes.integration.test.ts"]
      : mode === "stats"
        ? [process.execPath, "test", "./scripts/submission-stats.integration.test.ts"]
        : mode === "gate-smoke"
        ? [process.execPath, "./scripts/gate-smoke.ts"]
        : null;
if (!command) {
  throw new Error(`[test-db] unknown mode "${mode}" (expected roster | requests | stats | gate-smoke)`);
}

// Every suite starts from an empty database (schema kept). The suites share one throwaway
// database and used to leave rows and counters behind, so results depended on run order:
// e.g. after test:requests, approved requests holding certificate numbers 1..n made
// gate-smoke collide on requests_cert_number_uidx once counters were reset, and with the
// counters left alone gate-smoke 10f failed whenever the certificate number happened to equal
// the request sequence (8 == 8). The target is re-verified on the server before truncating.
{
  const url = new URL(testEnv.TEST_DATABASE_URL);
  if (
    !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) ||
    url.port !== "8520" ||
    url.pathname !== "/ua_roster_test"
  ) {
    throw new Error(`[test-db] REFUSED reset on ${url.hostname}:${url.port}${url.pathname}`);
  }
  const sql = new Bun.SQL(testEnv.TEST_DATABASE_URL);
  try {
    const [id] = await sql`select current_database() as database, host(inet_server_addr()) as address, inet_server_port() as port`;
    if (id.database !== "ua_roster_test" || !["127.0.0.1", "::1"].includes(id.address) || Number(id.port) !== 8520) {
      throw new Error(`[test-db] REFUSED reset on ${id.address}:${id.port}/${id.database}`);
    }
    const tables = await sql`
      select quote_ident(tablename) as t from pg_tables
       where schemaname = 'public' and tablename not like '\_\_drizzle%'`;
    if (tables.length > 0) {
      await sql.unsafe(`truncate ${tables.map((r: { t: string }) => r.t).join(", ")} restart identity cascade`);
    }
  } finally {
    await sql.close();
  }
}

const child = Bun.spawn(
  command,
  {
    cwd: API_ROOT,
    env: {
      ...process.env,
      ...testEnv,
      ALLOW_REMOTE_DATABASE: "",
      DATABASE_URL: "",
      AUTH_BYPASS_GOOGLE: mode === "gate-smoke" ? "true" : process.env.AUTH_BYPASS_GOOGLE,
      GATE_SMOKE_EXCLUSIVE_DB: mode === "gate-smoke" ? "1" : "",
      GATE_SMOKE_MOCK_STORAGE: mode === "gate-smoke" || mode === "requests" || mode === "stats" ? "1" : "",
      GOOGLE_CLIENT_ID: mode === "gate-smoke" ? "gate-smoke-client" : process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET:
        mode === "gate-smoke" ? "gate-smoke-secret" : process.env.GOOGLE_CLIENT_SECRET,
      GOOGLE_HD: mode === "gate-smoke" ? "psru.ac.th" : process.env.GOOGLE_HD,
      NODE_ENV: mode === "gate-smoke" ? "development" : process.env.NODE_ENV,
      ROSTER_TEST: "1",
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);

process.exitCode = await child.exited;
