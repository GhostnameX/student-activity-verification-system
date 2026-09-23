export interface OAuthStateEntry {
  redirect?: string;
  expires: number;
}

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

export function consumeOAuthState(
  states: Map<string, OAuthStateEntry>,
  state: string | undefined,
  cookieState: string | undefined,
  now = Date.now(),
): OAuthStateEntry | null {
  if (!state || !cookieState || state !== cookieState) return null;

  const saved = states.get(state);
  if (!saved) return null;

  states.delete(state);
  if (saved.expires <= now) return null;
  return saved;
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
