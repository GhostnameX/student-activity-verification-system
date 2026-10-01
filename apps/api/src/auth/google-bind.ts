// Pure helpers for the first-login Google binding flow.
//
// Kept free of any database or request dependency (like oauth-security.ts) so the
// cookie, token, phone and rate-limit logic can be unit tested without a DB.
//
// Security model:
//  - The client only ever holds an opaque bearer token in an HttpOnly cookie.
//  - The database stores only a SHA-256 hash of that token, never the token.
//  - The OAuth email lives server-side in oauth_bind_sessions and is never read
//    from, or accepted in, a bind request body.

import { createHash, randomBytes } from "node:crypto";

export const BIND_COOKIE = "ua_oauth_bind";
export const BIND_TTL_SECONDS = 10 * 60;

// Wrong-studentId attempts allowed per bind session before it is invalidated.
// Prevents studentId enumeration while still allowing a typo or two.
export const BIND_MAX_ATTEMPTS = 3;

export const BIND_ERRORS = {
  sessionInvalid: "bind_session_invalid",
  tooManyAttempts: "too_many_attempts",
  invalidPhone: "invalid_phone",
  invalidStudent: "invalid_student",
  emailStudentMismatch: "email_student_mismatch",
  emailAlreadyBound: "email_already_bound",
  failed: "bind_failed",
} as const;

export type BindErrorCode = (typeof BIND_ERRORS)[keyof typeof BIND_ERRORS];

// --- token -----------------------------------------------------------------

/** 256 bits of entropy, base64url so the value is cookie-safe as-is. */
export function generateBindToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashBindToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// --- cookies ---------------------------------------------------------------

export function oauthBindCookieString(token: string, secure: boolean): string {
  const parts = [
    `${BIND_COOKIE}=${token}`,
    "Path=/api/auth",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${BIND_TTL_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearOauthBindCookieString(secure: boolean): string {
  const parts = [
    `${BIND_COOKIE}=`,
    "Path=/api/auth",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

// --- email <-> student id --------------------------------------------------

/** Student mailboxes are `<studentId>@psru.ac.th`; any other local-part is not a student. */
export const BIND_EMAIL_DOMAIN = "psru.ac.th";

/**
 * True only when `email` is exactly `<studentId>@psru.ac.th`. Case and surrounding
 * whitespace are ignored; everything else is compared character for character, so
 * a staff/teacher mailbox (e.g. `somchai.k@psru.ac.th`) can never match a student.
 * The domain is checked here rather than trusting the Google `hd` claim alone.
 */
export function emailMatchesStudentId(email: string, studentId: string): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  const id = studentId.trim().toLowerCase();
  if (id === "") return false;
  const parts = normalizedEmail.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return domain === BIND_EMAIL_DOMAIN && local === id;
}

// --- phone -----------------------------------------------------------------

/**
 * Normalize a Thai mobile number to its canonical 10-digit local form.
 *
 * Accepts spaces, dashes and the +66 / 66 country prefix, with or without the
 * national leading zero (+66812345678, +660812345678 and 66-081-234-5678 all
 * resolve to 0812345678). Returns null for anything that is not a Thai mobile
 * number (mobile/02/08/09 only, 10 digits). This is a profile field, not a
 * login credential: V1 has no phone OTP.
 */
export function normalizeThaiPhone(raw: string): string | null {
  const compact = raw.trim().replace(/[\s-]+/g, "");
  let digits = compact;
  if (digits.startsWith("+66")) digits = digits.slice(3);
  else if (digits.startsWith("66")) digits = digits.slice(2);
  if (digits && !digits.startsWith("0")) digits = `0${digits}`;
  return /^0[689]\d{8}$/.test(digits) ? digits : null;
}

// --- session validity ------------------------------------------------------

export interface BindSessionRow {
  usedAt: Date | null;
  expiresAt: Date;
  attempts: number;
}

/** A bind session is usable only when it is unused, unexpired and under the cap. */
export function isBindSessionUsable(
  row: BindSessionRow | undefined | null,
  now: number = Date.now(),
): row is BindSessionRow {
  if (!row) return false;
  if (row.usedAt) return false;
  if (row.expiresAt.getTime() <= now) return false;
  return row.attempts < BIND_MAX_ATTEMPTS;
}

// --- rate limiting ---------------------------------------------------------

export interface BindRateLimitOptions {
  ipLimit: number;
  windowMs: number;
  maxEntries: number;
  now?: () => number;
}

export interface BindRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface BindBucket {
  failures: number;
  resetAt: number;
}

/**
 * IP-only fixed-window limiter, sized for unauthenticated endpoints. Unlike
 * LoginRateLimiter it has no account dimension: a bind attempt is not
 * associated with a staff code, and keying on one would leak whether a given
 * account exists.
 */
export class BindRateLimiter {
  private readonly attempts = new Map<string, BindBucket>();
  private readonly now: () => number;

  constructor(private readonly options: BindRateLimitOptions) {
    this.now = options.now ?? Date.now;
  }

  consumeAttempt(ip: string | undefined): BindRateLimitResult {
    if (!ip) return { allowed: true, retryAfterSeconds: 0 };

    const now = this.now();
    this.sweep(now);

    const bucket = this.attempts.get(ip);
    if (bucket && bucket.failures >= this.options.ipLimit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }

    if (!bucket || bucket.resetAt <= now) {
      this.ensureCapacity();
      this.attempts.set(ip, { failures: 1, resetAt: now + this.options.windowMs });
    } else {
      bucket.failures += 1;
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }

  private ensureCapacity(): void {
    while (this.attempts.size >= this.options.maxEntries) {
      const oldest = this.attempts.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.attempts.delete(oldest);
    }
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.attempts) {
      if (bucket.resetAt <= now) this.attempts.delete(key);
    }
  }
}
