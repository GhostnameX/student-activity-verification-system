import { describe, expect, test } from "bun:test";
import {
  clearOAuthStateCookieString,
  consumeOAuthState,
  matchesGoogleHostedDomain,
  normalizeOAuthRedirectPath,
  oauthStateCookieString,
  type OAuthStateEntry,
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
  const validEntry = (): OAuthStateEntry => ({ redirect: "/student", expires: 2_000 });

  test("rejects missing, unknown, and expired states", () => {
    expect(consumeOAuthState(new Map(), undefined, undefined, 1_000)).toBeNull();
    expect(consumeOAuthState(new Map(), "unknown", "unknown", 1_000)).toBeNull();

    const expired = new Map([["expired", { expires: 1_000 }]]);
    expect(consumeOAuthState(expired, "expired", "expired", 1_000)).toBeNull();
    expect(expired.has("expired")).toBe(false);
  });

  test("rejects a state issued to a different browser without consuming it", () => {
    const states = new Map([["valid", validEntry()]]);
    expect(consumeOAuthState(states, "valid", "different", 1_000)).toBeNull();
    expect(states.has("valid")).toBe(true);
  });

  test("accepts a valid state exactly once", () => {
    const states = new Map([["valid", validEntry()]]);
    expect(consumeOAuthState(states, "valid", "valid", 1_000)).toEqual(validEntry());
    expect(consumeOAuthState(states, "valid", "valid", 1_000)).toBeNull();
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
