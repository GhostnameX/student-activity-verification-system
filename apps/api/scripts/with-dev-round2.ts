import { resolve } from "node:path";

// Starts the API against the local fake-data database ua_dev_round2 only.
// Env comes from apps/api/.env.dev-round2.local (git-ignored); anything else is refused.
const API_ROOT = resolve(import.meta.dir, "..");
const ENV_FILE = resolve(API_ROOT, ".env.dev-round2.local");

const file = Bun.file(ENV_FILE);
if (!(await file.exists())) {
  throw new Error(`[dev-round2] missing ${ENV_FILE}; run: bun run --cwd packages/db devdb:round2-reset`);
}

const env: Record<string, string> = {};
for (const sourceLine of (await file.text()).split(/\r?\n/)) {
  const line = sourceLine.trim();
  if (!line || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator > 0) env[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
}

let url: URL;
try {
  url = new URL(env.DATABASE_URL ?? "");
} catch {
  throw new Error("[dev-round2] DATABASE_URL in the env file is not a valid URL");
}
if (
  !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) ||
  url.port !== "8520" ||
  url.pathname !== "/ua_dev_round2"
) {
  throw new Error(`[dev-round2] REFUSED: ${url.hostname}:${url.port}${url.pathname} is not loopback:8520/ua_dev_round2`);
}

const child = Bun.spawn([process.execPath, "src/index.ts"], {
  cwd: API_ROOT,
  env: { ...process.env, ...env, ALLOW_REMOTE_DATABASE: "", ROSTER_TEST: "", TEST_DATABASE_URL: "" },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exitCode = await child.exited;
