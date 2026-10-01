import { describe, expect, test } from "bun:test";
import {
  clearOAuthStateCookieString,
  consumeOAuthState,
  hashOAuthState,
  matchesGoogleHostedDomain,
  normalizeOAuthRedirectPath,
  oauthStateBindingFailure,
  oauthStateCookieString,
} from "../src/auth/oauth-security";

describe("Google hosted-domain enforcement", () => {
  test("accepts only the configured hosted domain", () => {
    expect(matchesGoogleHostedDomain("psru.ac.th", "psru.ac.th")).toBe(true);
    expect(matchesGoogleHostedDomain("psru.ac.th", "PSRU.AC.TH")).toBe(true);
    expect(matchesGoogleHostedDomain("psru.ac.th", undefined)).toBe(false);
    expect(matchesGoogleHostedDomain("psru.ac.th", "gmail.com")).toBe(false);
  });
});

describe("OAuth state consumption", () => {
  test("hashes state deterministically without retaining the raw value", () => {
    const hash = hashOAuthState("state-id");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashOAuthState("state-id"));
    expect(hash).not.toContain("state-id");
  });

  test("rejects missing and mismatched browser state before calling the DB consumer", async () => {
    let calls = 0;
    const consumer = async () => {
      calls += 1;
      return { redirectPath: "/student" };
    };
    expect(await consumeOAuthState(undefined, undefined, consumer)).toBeNull();
    expect(await consumeOAuthState("valid", undefined, consumer)).toBeNull();
    expect(await consumeOAuthState("valid", "different", consumer)).toBeNull();
    expect(calls).toBe(0);
  });

  test("passes only the state hash and current time to the DB consumer", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    let receivedHash = "";
    const consumed = await consumeOAuthState("valid", "valid", async (stateHash, receivedNow) => {
      receivedHash = stateHash;
      expect(receivedNow).toEqual(now);
      return { redirectPath: "/student" };
    }, now);
    expect(receivedHash).toBe(hashOAuthState("valid"));
    expect(consumed).toEqual({ redirectPath: "/student" });
  });

  test("returns sanitized binding failure categories", () => {
    expect(oauthStateBindingFailure(undefined, undefined)).toBe("missing_query_state");
    expect(oauthStateBindingFailure("state", undefined)).toBe("missing_cookie_state");
    expect(oauthStateBindingFailure("state", "other")).toBe("cookie_mismatch");
    expect(oauthStateBindingFailure("state", "state")).toBeNull();
  });
});

describe("OAuth state cookie", () => {
  test("uses short-lived browser-bound production flags", () => {
    const cookie = oauthStateCookieString("state-id", true);
    expect(cookie).toContain("ua_oauth_state=state-id");
    expect(cookie).toContain("Path=/api/auth/google/callback");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=600");
    expect(cookie).toContain("Secure");
  });

  test("clears the cookie using the same scope", () => {
    const cookie = clearOAuthStateCookieString(true);
    expect(cookie).toContain("ua_oauth_state=");
    expect(cookie).toContain("Path=/api/auth/google/callback");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Secure");
  });
});

describe("OAuth post-login redirects", () => {
  const origin = "https://kingplapow.com";

  test("keeps same-origin redirects as application paths", () => {
    expect(normalizeOAuthRedirectPath("/student?tab=requests#latest", origin)).toBe("/student?tab=requests#latest");
    expect(normalizeOAuthRedirectPath("https://kingplapow.com/admin", origin)).toBe("/admin");
    expect(normalizeOAuthRedirectPath("student", origin)).toBe("/student");
  });

  test("rejects absolute, protocol-relative, and credentialed external redirects", () => {
    expect(normalizeOAuthRedirectPath("https://evil.example/phish", origin)).toBeUndefined();
    expect(normalizeOAuthRedirectPath("//evil.example/phish", origin)).toBeUndefined();
    expect(normalizeOAuthRedirectPath("https://kingplapow.com@evil.example/phish", origin)).toBeUndefined();
  });
});
