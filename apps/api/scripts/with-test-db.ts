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
      : mode === "gate-smoke"
        ? [process.execPath, "./scripts/gate-smoke.ts"]
        : null;
if (!command) {
  throw new Error(`[test-db] unknown mode "${mode}" (expected roster | requests | gate-smoke)`);
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
      GATE_SMOKE_MOCK_STORAGE: mode === "gate-smoke" || mode === "requests" ? "1" : "",
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
