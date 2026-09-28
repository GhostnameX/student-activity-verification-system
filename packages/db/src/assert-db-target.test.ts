// @ts-expect-error packages/db intentionally keeps Node-only ambient types; Bun supplies this at runtime.
import { describe, expect, test } from "bun:test";
import { isDatabaseTestRunner, resolveDatabaseTarget, type DbTargetLogger } from "./assert-db-target";

const LOCAL_DEV = "postgresql://dev:secret@127.0.0.1:8520/ua_dev";
const LOCAL_TEST = "postgresql://test:secret@localhost:8520/ua_roster_test";
const REMOTE = "postgresql://postgres:super-secret@db.example.com:6543/postgres";

function captureLogger() {
  const messages: string[] = [];
  const logger: DbTargetLogger = {
    info: (message) => messages.push(message),
    warn: (message) => messages.push(message),
    error: (message) => messages.push(message),
  };
  return { logger, messages };
}

function resolve(env: Record<string, string | undefined>, argv: readonly string[] = ["bun", "app.ts"]) {
  const capture = captureLogger();
  const target = resolveDatabaseTarget({ env, argv, logger: capture.logger });
  return { target, messages: capture.messages };
}

describe("database target guard", () => {
  test("allows a normal loopback development database", () => {
    const { target, messages } = resolve({ DATABASE_URL: LOCAL_DEV });
    expect(target.mode).toBe("development");
    expect(target.database).toBe("ua_dev");
    expect(messages).toEqual(["[db-target] development -> 127.0.0.1:8520/ua_dev"]);
  });

  test("integration reads TEST_DATABASE_URL and ignores DATABASE_URL and remote override", () => {
    const { target } = resolve({
      ROSTER_TEST: "1",
      TEST_DATABASE_URL: LOCAL_TEST,
      DATABASE_URL: REMOTE,
      ALLOW_REMOTE_DATABASE: "1",
    });
    expect(target.mode).toBe("integration");
    expect(target.connectionString).toContain("localhost:8520/ua_roster_test");
    expect(target.connectionString).not.toContain("db.example.com");
  });

  test("integration fails closed when TEST_DATABASE_URL is absent", () => {
    expect(() => resolve({ ROSTER_TEST: "1", DATABASE_URL: LOCAL_TEST })).toThrow(
      "TEST_DATABASE_URL is required",
    );
  });

  test.each([
    ["remote host", REMOTE],
    ["wrong local database", LOCAL_DEV],
    ["pooler marker", "postgresql://test:secret@localhost:8520/pooler_ua_roster_test"],
  ])("integration rejects %s", (_label: string, url: string) => {
    expect(() =>
      resolve({ ROSTER_TEST: "1", TEST_DATABASE_URL: url, ALLOW_REMOTE_DATABASE: "1" }),
    ).toThrow("[db-target] REFUSED:");
  });

  test.each([
    ["NODE_ENV=test", { NODE_ENV: "test" }, ["bun", "file.test.ts"]],
    ["bun test argv", { NODE_ENV: "production" }, ["bun", "test", "file.test.ts"]],
  ])(
    "test runner rejects remote even with production/override: %s",
    (_label: string, extra: Record<string, string>, argv: string[]) => {
    expect(() =>
      resolve(
        { DATABASE_URL: REMOTE, ALLOW_REMOTE_DATABASE: "1", ...extra },
        argv,
      ),
    ).toThrow("test runners may not connect to remote databases");
    },
  );

  test("allows a remote database in production without logging credentials", () => {
    const { target, messages } = resolve({ DATABASE_URL: REMOTE, NODE_ENV: "production" });
    expect(target.mode).toBe("production");
    expect(messages).toEqual(["[db-target] production remote database allowed"]);
    expect(messages.join(" ")).not.toContain("super-secret");
  });

  test("allows explicit remote maintenance with a loud sanitized warning", () => {
    const { target, messages } = resolve({ DATABASE_URL: REMOTE, ALLOW_REMOTE_DATABASE: "1" });
    expect(target.mode).toBe("remote-override");
    expect(messages[0]).toContain("WARNING: remote database allowed via ALLOW_REMOTE_DATABASE=1");
    expect(messages[0]).toContain("db.example.com:6543/postgres");
    expect(messages[0]).not.toContain("super-secret");
  });

  test("denies a normal remote target without production or explicit opt-in", () => {
    expect(() => resolve({ DATABASE_URL: REMOTE })).toThrow("remote database denied outside production");
  });

  test("errors never expose credentials", () => {
    let message = "";
    try {
      resolve({ DATABASE_URL: "postgresql://admin:do-not-leak@remote.example.com/prod" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain("do-not-leak");
    expect(message).not.toContain("admin:");
  });

  test("detects the active Bun runner even when NODE_ENV is production", () => {
    expect(isDatabaseTestRunner({ NODE_ENV: "production" }, process.argv)).toBe(true);
  });
});
