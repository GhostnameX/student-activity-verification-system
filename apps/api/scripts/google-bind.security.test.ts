import { describe, expect, test } from "bun:test";
import {
  BIND_COOKIE,
  BIND_ERRORS,
  BIND_MAX_ATTEMPTS,
  BIND_TTL_SECONDS,
  BindRateLimiter,
  clearOauthBindCookieString,
  generateBindToken,
  hashBindToken,
  isBindSessionUsable,
  normalizeThaiPhone,
  oauthBindCookieString,
} from "../src/auth/google-bind";

const at = (iso: string) => new Date(iso);

describe("bind token", () => {
  test("is 256 bits of base64url and never needs cookie escaping", () => {
    const token = generateBindToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("is unique per call", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateBindToken()));
    expect(seen.size).toBe(200);
  });

  test("hashes deterministically to 64 hex chars and is not the token", () => {
    const token = generateBindToken();
    const hash = hashBindToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashBindToken(token));
    expect(hash).not.toBe(token);
  });
});

describe("bind cookie", () => {
  test("is HttpOnly, Lax, path-scoped to /api/auth and matches the DB TTL", () => {
    const cookie = oauthBindCookieString("tok123", false);
    expect(cookie).toContain(`${BIND_COOKIE}=tok123`);
    expect(cookie).toContain("Path=/api/auth");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain(`Max-Age=${BIND_TTL_SECONDS}`);
    expect(BIND_TTL_SECONDS).toBe(600);
  });

  test("adds Secure only in production", () => {
    expect(oauthBindCookieString("t", false)).not.toContain("Secure");
    expect(oauthBindCookieString("t", true)).toContain("Secure");
  });

  test("clears with the same attributes", () => {
    const cleared = clearOauthBindCookieString(true);
    expect(cleared).toContain(`${BIND_COOKIE}=;`);
    expect(cleared).toContain("Path=/api/auth");
    expect(cleared).toContain("HttpOnly");
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    expect(cleared).toContain("Secure");
  });
});

describe("Thai phone normalization", () => {
  test("accepts plain 10-digit Thai mobile numbers", () => {
    expect(normalizeThaiPhone("0812345678")).toBe("0812345678");
    expect(normalizeThaiPhone("0612345678")).toBe("0612345678");
    expect(normalizeThaiPhone("0891234567")).toBe("0891234567");
  });

  test("strips spaces and dashes", () => {
    expect(normalizeThaiPhone("081-234-5678")).toBe("0812345678");
    expect(normalizeThaiPhone("081 234 5678")).toBe("0812345678");
    expect(normalizeThaiPhone(" 081 - 234 - 5678 ")).toBe("0812345678");
  });

  test("converts +66 and 66 prefixes to 0", () => {
    expect(normalizeThaiPhone("+66812345678")).toBe("0812345678");
    expect(normalizeThaiPhone("+66 81-234-5678")).toBe("0812345678");
    expect(normalizeThaiPhone("66812345678")).toBe("0812345678");
  });

  test("does not double the leading zero when the national form keeps it", () => {
    expect(normalizeThaiPhone("66-081-234-5678")).toBe("0812345678");
    expect(normalizeThaiPhone("+660812345678")).toBe("0812345678");
    expect(normalizeThaiPhone("081-234-5678")).toBe("0812345678");
  });

  test("rejects wrong length, wrong prefix and non-digits", () => {
    expect(normalizeThaiPhone("081234567")).toBeNull(); // 9 digits
    expect(normalizeThaiPhone("08123456789")).toBeNull(); // 11 digits
    expect(normalizeThaiPhone("0212345678")).toBeNull(); // landline prefix
    expect(normalizeThaiPhone("0712345678")).toBeNull(); // not 6/8/9
    expect(normalizeThaiPhone("1234567890")).toBeNull();
    expect(normalizeThaiPhone("08123abcde")).toBeNull();
    expect(normalizeThaiPhone("")).toBeNull();
    expect(normalizeThaiPhone("+66")).toBeNull();
  });
});

describe("bind session validity", () => {
  const usable = { usedAt: null, expiresAt: at("2026-01-01T00:10:00.000Z"), attempts: 0 };

  test("accepts an unused, unexpired session under the cap", () => {
    expect(isBindSessionUsable(usable, Date.parse("2026-01-01T00:00:00.000Z"))).toBe(true);
  });

  test("rejects a missing session", () => {
    expect(isBindSessionUsable(undefined, 0)).toBe(false);
    expect(isBindSessionUsable(null, 0)).toBe(false);
  });

  test("rejects a used session", () => {
    expect(isBindSessionUsable({ ...usable, usedAt: at("2026-01-01T00:01:00.000Z") }, 0)).toBe(false);
  });

  test("rejects an expired session at exactly the expiry instant", () => {
    const now = Date.parse("2026-01-01T00:10:00.000Z");
    expect(isBindSessionUsable(usable, now)).toBe(false);
    expect(isBindSessionUsable(usable, now - 1)).toBe(true);
  });

  test("rejects a session that has burned its attempts", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    expect(isBindSessionUsable({ ...usable, attempts: BIND_MAX_ATTEMPTS - 1 }, now)).toBe(true);
    expect(isBindSessionUsable({ ...usable, attempts: BIND_MAX_ATTEMPTS }, now)).toBe(false);
    expect(BIND_MAX_ATTEMPTS).toBe(3);
  });
});

describe("bind rate limiter", () => {
  test("allows 5 attempts per IP then blocks until the window resets", () => {
    let now = 1_000_000;
    const limiter = new BindRateLimiter({ ipLimit: 5, windowMs: 600_000, maxEntries: 100, now: () => now });

    for (let i = 0; i < 5; i++) {
      expect(limiter.consumeAttempt("1.2.3.4").allowed).toBe(true);
    }
    const blocked = limiter.consumeAttempt("1.2.3.4");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    now += 600_001;
    expect(limiter.consumeAttempt("1.2.3.4").allowed).toBe(true);
  });

  test("tracks each IP separately", () => {
    const limiter = new BindRateLimiter({ ipLimit: 1, windowMs: 600_000, maxEntries: 100, now: () => 0 });
    expect(limiter.consumeAttempt("1.1.1.1").allowed).toBe(true);
    expect(limiter.consumeAttempt("1.1.1.1").allowed).toBe(false);
    expect(limiter.consumeAttempt("2.2.2.2").allowed).toBe(true);
  });

  test("does not throttle when the IP is unknown", () => {
    const limiter = new BindRateLimiter({ ipLimit: 1, windowMs: 600_000, maxEntries: 10, now: () => 0 });
    for (let i = 0; i < 20; i++) {
      expect(limiter.consumeAttempt(undefined).allowed).toBe(true);
    }
  });

  test("stays bounded by maxEntries", () => {
    const limiter = new BindRateLimiter({ ipLimit: 5, windowMs: 600_000, maxEntries: 10, now: () => 0 });
    for (let i = 0; i < 500; i++) limiter.consumeAttempt(`10.0.0.${i % 255}`);
    expect((limiter as unknown as { attempts: Map<string, unknown> }).attempts.size).toBeLessThanOrEqual(10);
  });
});

describe("bind error codes", () => {
  test("are stable strings the web client maps to messages", () => {
    expect(BIND_ERRORS.sessionInvalid).toBe("bind_session_invalid");
    expect(BIND_ERRORS.tooManyAttempts).toBe("too_many_attempts");
    expect(BIND_ERRORS.invalidPhone).toBe("invalid_phone");
    expect(BIND_ERRORS.invalidStudent).toBe("invalid_student");
    expect(BIND_ERRORS.emailAlreadyBound).toBe("email_already_bound");
  });

  test("the student lookup error is generic — it must not name a case", () => {
    // One code covers not-found / inactive / soft-deleted so the response body
    // cannot be used to tell which it was.
    expect(BIND_ERRORS.invalidStudent).toBe("invalid_student");
  });
});
