const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const INTEGRATION_DATABASE = "ua_roster_test";

type Environment = Record<string, string | undefined>;

export interface DbTargetLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface ResolveDbTargetOptions {
  env?: Environment;
  argv?: readonly string[];
  logger?: DbTargetLogger;
}

export interface ResolvedDbTarget {
  connectionString: string;
  database: string;
  host: string;
  mode: "development" | "integration" | "production" | "remote-override";
  port: number;
}

function normalizeHost(hostname: string): string {
  const lower = hostname.toLowerCase();
  return lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
}

function parseDatabaseUrl(raw: string | undefined, variableName: string): URL {
  if (!raw?.trim()) refuse(`${variableName} is required`);

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    refuse(`${variableName} must be a valid URL`);
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    refuse(`${variableName} must use the postgres protocol`);
  }
  if (!url.hostname) refuse(`${variableName} must include a host`);
  if (!databaseName(url)) refuse(`${variableName} must include a database name`);
  return url;
}

function databaseName(url: URL): string {
  try {
    return decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    refuse("database name is not valid URL encoding");
  }
}

function displayTarget(url: URL): string {
  const host = normalizeHost(url.hostname);
  const port = Number(url.port || 5432);
  return `${host}:${port}/${databaseName(url)}`;
}

function refuse(reason: string): never {
  throw new Error(`[db-target] REFUSED: ${reason}`);
}

export function isDatabaseTestRunner(
  env: Environment = process.env,
  argv: readonly string[] = process.argv,
): boolean {
  if (env.ROSTER_TEST === "1" || env.NODE_ENV === "test") return true;
  return argv.some(
    (arg) =>
      arg === "test" ||
      arg === "--test" ||
      arg === "bun:test" ||
      /(?:^|[\\/])[^\\/]+(?:\.test|_test|\.spec|_spec)\.[cm]?[jt]sx?$/.test(arg),
  );
}

export function resolveDatabaseTarget(options: ResolveDbTargetOptions = {}): ResolvedDbTarget {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  const logger = options.logger ?? console;

  if (env.ROSTER_TEST === "1") {
    const raw = env.TEST_DATABASE_URL;
    const url = parseDatabaseUrl(raw, "TEST_DATABASE_URL");
    const host = normalizeHost(url.hostname);
    const database = databaseName(url);

    if (!LOOPBACK_HOSTS.has(host)) {
      logger.error(`[db-target] REFUSED: integration target ${displayTarget(url)} is not loopback`);
      refuse("integration database must use a loopback host");
    }
    if (database !== INTEGRATION_DATABASE) {
      logger.error(`[db-target] REFUSED: integration database is ${database || "(missing)"}`);
      refuse(`integration database must be ${INTEGRATION_DATABASE}`);
    }
    const lowered = raw!.toLowerCase();
    if (lowered.includes("supabase") || lowered.includes("pooler")) {
      refuse("integration URL contains a remote database marker");
    }

    logger.info(`[db-target] integration -> ${displayTarget(url)}`);
    return resolved(url, "integration");
  }

  const url = parseDatabaseUrl(env.DATABASE_URL, "DATABASE_URL");
  const host = normalizeHost(url.hostname);
  const isLoopback = LOOPBACK_HOSTS.has(host);
  const isTestRunner = isDatabaseTestRunner(env, argv);

  if (isTestRunner && !isLoopback) {
    logger.error(`[db-target] REFUSED: test runner attempted remote target ${displayTarget(url)}`);
    refuse("test runners may not connect to remote databases");
  }

  if (isLoopback) {
    logger.info(`[db-target] development -> ${displayTarget(url)}`);
    return resolved(url, "development");
  }

  if (env.NODE_ENV === "production") {
    logger.info("[db-target] production remote database allowed");
    return resolved(url, "production");
  }

  if (env.ALLOW_REMOTE_DATABASE === "1") {
    logger.warn(
      `[db-target] WARNING: remote database allowed via ALLOW_REMOTE_DATABASE=1 -> ${displayTarget(url)}`,
    );
    return resolved(url, "remote-override");
  }

  logger.error(`[db-target] REFUSED: remote target ${displayTarget(url)} requires explicit opt-in`);
  refuse("remote database denied outside production; set ALLOW_REMOTE_DATABASE=1 for maintenance");
}

function resolved(url: URL, mode: ResolvedDbTarget["mode"]): ResolvedDbTarget {
  return {
    connectionString: url.toString(),
    database: databaseName(url),
    host: normalizeHost(url.hostname),
    mode,
    port: Number(url.port || 5432),
  };
}
