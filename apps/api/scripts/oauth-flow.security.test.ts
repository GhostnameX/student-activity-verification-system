import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { OAuthStateStore } from "../src/auth/oauth-state-store";

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  AUTH_BYPASS_GOOGLE: process.env.AUTH_BYPASS_GOOGLE,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_HD: process.env.GOOGLE_HD,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
};

interface StoredState {
  redirectPath: string | null;
  expiresAt: Date;
  usedAt: Date | null;
}

const durableRows = new Map<string, StoredState>();
let createAuth: (store: OAuthStateStore) => { handle(request: Request): Promise<Response> };
let hashOAuthState: (state: string) => string;
let authApp: { handle(request: Request): Promise<Response> };

class TestDurableOAuthStateStore implements OAuthStateStore {
  async create(input: { state: string; redirectPath?: string; expiresAt: Date }) {
    durableRows.set(hashOAuthState(input.state), {
      redirectPath: input.redirectPath ?? null,
      expiresAt: input.expiresAt,
      usedAt: null,
    });
  }

  async consumeByHash(stateHash: string, now: Date) {
    const row = durableRows.get(stateHash);
    if (!row || row.usedAt || row.expiresAt.getTime() <= now.getTime()) return null;
    row.usedAt = now;
    return { redirectPath: row.redirectPath };
  }

  async cleanup(olderThan: Date) {
    for (const [hash, row] of durableRows) {
      if (row.expiresAt < olderThan || (row.usedAt && row.usedAt < olderThan)) {
        durableRows.delete(hash);
      }
    }
  }
}

beforeAll(async () => {
  process.env.NODE_ENV = "production";
  process.env.AUTH_BYPASS_GOOGLE = "false";
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_HD = "psru.ac.th";
  process.env.WEB_ORIGIN = "https://kingplapow.com";
  const authModule = await import(`../src/auth?oauth-security-test=${Date.now()}`);
  const securityModule = await import("../src/auth/oauth-security");
  createAuth = authModule.createAuth;
  hashOAuthState = securityModule.hashOAuthState;
});

beforeEach(() => {
  durableRows.clear();
  authApp = createAuth(new TestDurableOAuthStateStore());
});

afterAll(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function startOAuth(app = authApp, redirect?: string) {
  const suffix = redirect ? `?redirect=${encodeURIComponent(redirect)}` : "";
  const response = await app.handle(
    new Request(`https://kingplapow.com/api/auth/google/url${suffix}`),
  );
  const body = await response.json() as { redirectUrl: string };
  const authorizationUrl = new URL(body.redirectUrl);
  const state = authorizationUrl.searchParams.get("state") ?? "";
  const cookie = response.headers.get("set-cookie") ?? "";
  return { response, authorizationUrl, state, cookie };
}

function callback(state: string, cookie: string) {
  return new Request(
    `https://kingplapow.com/api/auth/google/callback?state=${state}`,
    { headers: { cookie } },
  );
}

describe("production OAuth route security", () => {
  test("issues a hosted-domain request with a browser-bound state cookie", async () => {
    const started = await startOAuth(authApp, "/student");
    expect(started.response.status).toBe(200);
    expect(started.authorizationUrl.searchParams.get("hd")).toBe("psru.ac.th");
    expect(started.state).not.toBe("");
    expect(started.cookie).toContain(`ua_oauth_state=${started.state}`);
    expect(started.cookie).toContain("HttpOnly");
    expect(started.cookie).toContain("SameSite=Lax");
    expect(started.cookie).toContain("Secure");
    expect(durableRows.has(started.state)).toBe(false);
    expect(durableRows.has(hashOAuthState(started.state))).toBe(true);
  });

  test("rejects a state not bound to the callback browser", async () => {
    const started = await startOAuth();
    const rejected = await authApp.handle(
      new Request(`https://kingplapow.com/api/auth/google/callback?code=dummy&state=${started.state}`),
    );
    expect(rejected.status).toBe(302);
    expect(rejected.headers.get("location")).toContain("error=invalid_state");
  });

  test("does not consume state on cookie mismatch, accepts once, then rejects replay", async () => {
    const started = await startOAuth();
    const mismatch = await authApp.handle(callback(started.state, "ua_oauth_state=different-browser"));
    expect(mismatch.headers.get("location")).toContain("error=invalid_state");

    const matchingCookie = started.cookie.split(";", 1)[0];
    const accepted = await authApp.handle(callback(started.state, matchingCookie));
    expect(accepted.headers.get("location")).toContain("error=missing_code");

    const replay = await authApp.handle(callback(started.state, matchingCookie));
    expect(replay.headers.get("location")).toContain("error=invalid_state");
  });

  test("survives app/module recreation because state is outside the app instance", async () => {
    const firstProcess = createAuth(new TestDurableOAuthStateStore());
    const started = await startOAuth(firstProcess, "/student");
    const restartedProcess = createAuth(new TestDurableOAuthStateStore());
    const response = await restartedProcess.handle(
      callback(started.state, started.cookie.split(";", 1)[0]),
    );
    expect(response.headers.get("location")).toContain("error=missing_code");
  });

  test("keeps only the latest duplicate login flow active in the browser", async () => {
    const oldFlow = await startOAuth();
    const latestFlow = await startOAuth();
    const latestCookie = latestFlow.cookie.split(";", 1)[0];

    const oldCallback = await authApp.handle(callback(oldFlow.state, latestCookie));
    expect(oldCallback.headers.get("location")).toContain("error=invalid_state");
    expect(durableRows.get(hashOAuthState(oldFlow.state))?.usedAt).toBeNull();

    const latestCallback = await authApp.handle(callback(latestFlow.state, latestCookie));
    expect(latestCallback.headers.get("location")).toContain("error=missing_code");
  });
});
