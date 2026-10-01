import { createHash } from "node:crypto";

export interface ConsumedOAuthState {
  redirectPath: string | null;
}

export type OAuthStateConsumer = (
  stateHash: string,
  now: Date,
) => Promise<ConsumedOAuthState | null>;

export type OAuthStateBindingFailure =
  | "missing_query_state"
  | "missing_cookie_state"
  | "cookie_mismatch";

export const OAUTH_STATE_COOKIE = "ua_oauth_state";
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export function matchesGoogleHostedDomain(expected: string, actual?: string): boolean {
  return typeof actual === "string" && actual.trim().toLowerCase() === expected.trim().toLowerCase();
}

export function normalizeOAuthRedirectPath(raw: string | undefined, webOrigin: string): string | undefined {
  if (!raw) return undefined;

  try {
    const allowedOrigin = new URL(webOrigin).origin;
    const target = new URL(raw, `${allowedOrigin}/`);
    if (target.origin !== allowedOrigin || target.username || target.password) return undefined;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return undefined;
  }
}

export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

export function oauthStateBindingFailure(
  state: string | undefined,
  cookieState: string | undefined,
): OAuthStateBindingFailure | null {
  if (!state) return "missing_query_state";
  if (!cookieState) return "missing_cookie_state";
  if (state !== cookieState) return "cookie_mismatch";
  return null;
}

export async function consumeOAuthState(
  state: string | undefined,
  cookieState: string | undefined,
  consumeByHash: OAuthStateConsumer,
  now = new Date(),
): Promise<ConsumedOAuthState | null> {
  if (oauthStateBindingFailure(state, cookieState)) return null;
  return consumeByHash(hashOAuthState(state as string), now);
}

export function oauthStateCookieString(state: string, secure: boolean): string {
  const parts = [
    `${OAUTH_STATE_COOKIE}=${state}`,
    "Path=/api/auth/google/callback",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${OAUTH_STATE_TTL_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearOAuthStateCookieString(secure: boolean): string {
  const parts = [
    `${OAUTH_STATE_COOKIE}=`,
    "Path=/api/auth/google/callback",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
