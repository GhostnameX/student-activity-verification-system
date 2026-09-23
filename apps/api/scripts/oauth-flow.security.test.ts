import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  AUTH_BYPASS_GOOGLE: process.env.AUTH_BYPASS_GOOGLE,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_HD: process.env.GOOGLE_HD,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
};

let authApp: { handle(request: Request): Promise<Response> };

beforeAll(async () => {
  process.env.NODE_ENV = "production";
  process.env.AUTH_BYPASS_GOOGLE = "false";
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_HD = "psru.ac.th";
  process.env.WEB_ORIGIN = "https://kingplapow.com";
  ({ auth: authApp } = await import(`../src/auth?oauth-security-test=${Date.now()}`));
});

afterAll(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function startOAuth(redirect?: string) {
  const suffix = redirect ? `?redirect=${encodeURIComponent(redirect)}` : "";
  const response = await authApp.handle(
    new Request(`https://kingplapow.com/api/auth/google/url${suffix}`),
  );
  const body = await response.json() as { redirectUrl: string };
  const authorizationUrl = new URL(body.redirectUrl);
  const state = authorizationUrl.searchParams.get("state") ?? "";
  const cookie = response.headers.get("set-cookie") ?? "";
  return { response, authorizationUrl, state, cookie };
}

describe("production OAuth route security", () => {
  test("issues a hosted-domain request with a browser-bound state cookie", async () => {
    const started = await startOAuth("/student");
    expect(started.response.status).toBe(200);
    expect(started.authorizationUrl.searchParams.get("hd")).toBe("psru.ac.th");
    expect(started.state).not.toBe("");
    expect(started.cookie).toContain(`ua_oauth_state=${started.state}`);
    expect(started.cookie).toContain("HttpOnly");
    expect(started.cookie).toContain("SameSite=Lax");
    expect(started.cookie).toContain("Secure");
  });

  test("rejects a state not bound to the callback browser", async () => {
    const started = await startOAuth();
    const rejected = await authApp.handle(
      new Request(`https://kingplapow.com/api/auth/google/callback?code=dummy&state=${started.state}`),
    );
    expect(rejected.status).toBe(302);
    expect(rejected.headers.get("location")).toContain("error=invalid_state");
  });

  test("does not consume state on cookie mismatch, then rejects replay", async () => {
    const started = await startOAuth();
    const mismatch = await authApp.handle(new Request(
      `https://kingplapow.com/api/auth/google/callback?state=${started.state}`,
      { headers: { cookie: "ua_oauth_state=different-browser" } },
    ));
    expect(mismatch.headers.get("location")).toContain("error=invalid_state");

    const matchingCookie = started.cookie.split(";", 1)[0];
    const accepted = await authApp.handle(new Request(
      `https://kingplapow.com/api/auth/google/callback?state=${started.state}`,
      { headers: { cookie: matchingCookie } },
    ));
    expect(accepted.headers.get("location")).toContain("error=missing_code");

    const replay = await authApp.handle(new Request(
      `https://kingplapow.com/api/auth/google/callback?state=${started.state}`,
      { headers: { cookie: matchingCookie } },
    ));
    expect(replay.headers.get("location")).toContain("error=invalid_state");
  });
});
