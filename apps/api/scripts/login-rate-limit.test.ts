import { describe, expect, test } from "bun:test";
import { LoginRateLimiter, resolveLoginClientIp } from "../src/auth/login-rate-limit";
import { auth, passwordLoginLimiter } from "../src/auth";

function setup(options: { accountLimit?: number; ipLimit?: number; windowMs?: number; maxEntries?: number } = {}) {
  let now = 1_000;
  const limiter = new LoginRateLimiter({
    accountLimit: options.accountLimit ?? 2,
    ipLimit: options.ipLimit ?? 4,
    windowMs: options.windowMs ?? 10_000,
    maxEntries: options.maxEntries ?? 100,
    now: () => now,
  });
  return { limiter, advance: (ms: number) => { now += ms; } };
}

describe("password login rate limiter", () => {
  test("uses the first valid forwarded IP only on Render", () => {
    expect(resolveLoginClientIp({
      isRender: true,
      forwardedFor: "203.0.113.10, 10.0.0.2",
      socketAddress: "10.0.0.1",
    })).toBe("203.0.113.10");
    expect(resolveLoginClientIp({
      isRender: true,
      forwardedFor: "2001:db8::1, 10.0.0.2",
      socketAddress: "10.0.0.1",
    })).toBe("2001:db8::1");
  });

  test("ignores forwarded headers outside Render", () => {
    expect(resolveLoginClientIp({
      isRender: false,
      forwardedFor: "203.0.113.10",
      socketAddress: "127.0.0.1",
    })).toBe("127.0.0.1");
  });

  test("falls back to a valid socket IP and otherwise disables the IP key", () => {
    expect(resolveLoginClientIp({
      isRender: true,
      forwardedFor: "not-an-ip, 203.0.113.10",
      socketAddress: "10.0.0.1",
    })).toBe("10.0.0.1");
    expect(resolveLoginClientIp({
      isRender: true,
      forwardedFor: "not-an-ip",
      socketAddress: "also-invalid",
    })).toBeUndefined();
  });

  test("limits repeated failures for one normalized account", () => {
    const { limiter } = setup();
    expect(limiter.consumeAttempt("admin01", "127.0.0.1").allowed).toBe(true);
    expect(limiter.consumeAttempt("admin01", "127.0.0.1").allowed).toBe(true);

    expect(limiter.consumeAttempt("admin01", "127.0.0.2")).toEqual({
      allowed: false,
      retryAfterSeconds: 10,
    });
  });

  test("expires the window and permits a new attempt", () => {
    const { limiter, advance } = setup();
    limiter.consumeAttempt("admin01", "127.0.0.1");
    limiter.consumeAttempt("admin01", "127.0.0.1");
    advance(10_000);

    expect(limiter.consumeAttempt("admin01", "127.0.0.1").allowed).toBe(true);
  });

  test("keeps account limits isolated", () => {
    const { limiter } = setup();
    limiter.consumeAttempt("admin01", "127.0.0.1");
    limiter.consumeAttempt("admin01", "127.0.0.1");

    expect(limiter.consumeAttempt("admin02", "127.0.0.1").allowed).toBe(true);
  });

  test("limits one IP across different accounts without affecting another IP", () => {
    const { limiter } = setup({ accountLimit: 10, ipLimit: 2 });
    limiter.consumeAttempt("admin01", "127.0.0.1");
    limiter.consumeAttempt("admin02", "127.0.0.1");

    expect(limiter.consumeAttempt("admin03", "127.0.0.1").allowed).toBe(false);
    expect(limiter.consumeAttempt("admin03", "127.0.0.2").allowed).toBe(true);
  });

  test("successful login clears only its account failures", () => {
    const { limiter } = setup({ accountLimit: 2, ipLimit: 2 });
    limiter.consumeAttempt("admin01", "127.0.0.1");
    limiter.consumeAttempt("admin02", "127.0.0.1");
    limiter.recordSuccess("admin01", "127.0.0.1");

    expect(limiter.consumeAttempt("admin01", "127.0.0.2").allowed).toBe(true);
    expect(limiter.consumeAttempt("admin03", "127.0.0.1").allowed).toBe(true);
    expect(limiter.consumeAttempt("admin04", "127.0.0.1").allowed).toBe(false);
  });

  test("missing client IP never creates a shared global IP bucket", () => {
    const { limiter } = setup({ accountLimit: 10, ipLimit: 1 });

    expect(limiter.consumeAttempt("admin01").allowed).toBe(true);
    expect(limiter.consumeAttempt("admin02").allowed).toBe(true);
    expect(limiter.consumeAttempt("admin03").allowed).toBe(true);
  });

  test("evicts old entries when capacity is reached", () => {
    const { limiter } = setup({ accountLimit: 1, ipLimit: 10, maxEntries: 2 });
    limiter.consumeAttempt("admin01", "127.0.0.1");
    limiter.consumeAttempt("admin02", "127.0.0.1");
    limiter.consumeAttempt("admin03", "127.0.0.1");

    expect(limiter.consumeAttempt("admin01", "127.0.0.2").allowed).toBe(true);
    expect(limiter.consumeAttempt("admin03", "127.0.0.2").allowed).toBe(false);
  });

  test("password route returns 429 with Retry-After before querying credentials", async () => {
    const code = "rate-limit-route-test";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      passwordLoginLimiter.consumeAttempt(code);
    }

    const response = await auth.handle(new Request("http://localhost/api/auth/password/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffCode: `  ${code.toUpperCase()}  `, password: "wrong" }),
    }));

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await response.json()).toEqual({ error: "too_many_attempts" });
  });
});
