import { db } from "@ua/db/client";
import { sessions, students, staff } from "@ua/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export const SESSION_COOKIE = "ua_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface SessionUserBase {
  id: string;
  name: string;
  avatarUrl?: string | null;
  provider: "google" | "password";
}

export type SessionUser = SessionUserBase & (
  | {
      role: "student";
      studentId: string;
      email: string;
      phone: string | null;
      faculty: string | null;
      admissionYear: number | null;
      provider: "google";
    }
  | {
      role: "staff" | "admin";
      staffCode: string;
      kind: "main" | "emergency";
      provider: "password";
    }
);

export function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return out;
}

export function sessionCookieString(sid: string): string {
  const parts = [`${SESSION_COOKIE}=${sid}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookieString(): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

type SetHeader = Record<string, string | string[] | number | undefined>;

/**
 * Append a Set-Cookie value instead of replacing it.
 *
 * A single response may need several cookies at once (e.g. creating a login
 * session while clearing a temporary OAuth bind cookie), and Set-Cookie is the
 * one header that cannot be comma-joined — it must be sent as separate lines.
 */
export function appendSetCookie(setHeaders: SetHeader, cookie: string): void {
  // Elysia only preserves separate array entries under the canonical lowercase key.
  const current = setHeaders["set-cookie"];
  if (!current) setHeaders["set-cookie"] = [cookie];
  else if (Array.isArray(current)) current.push(cookie);
  else setHeaders["set-cookie"] = [String(current), cookie];
}

/** Minimal surface of the Drizzle executor needed by session writes. */
export type SessionWriteExecutor = Pick<typeof db, "insert">;

/**
 * Insert a login session and (unless deferred) set its cookie.
 *
 * `executor` lets the insert join an existing transaction so a session is never
 * created for work that later rolls back. When it is a transaction, pass
 * `deferCookie: true` and call appendSetCookie yourself only after COMMIT —
 * otherwise a rollback would still leave a Set-Cookie for a session row that
 * does not exist.
 */
export async function createSessionFor(
  setHeaders: SetHeader,
  userId: string,
  role: "student" | "staff" | "admin",
  provider: "google" | "password",
  executor: SessionWriteExecutor = db,
  deferCookie = false,
): Promise<string> {
  const sid = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await executor.insert(sessions).values({ id: sid, userId, authMethod: provider, role, expiresAt });
  if (!deferCookie) appendSetCookie(setHeaders, sessionCookieString(sid));
  return sid;
}

export async function getSession(headers: Record<string, unknown>): Promise<SessionUser | null> {
  const sid = parseCookies(headers.cookie as string | undefined)[SESSION_COOKIE];
  if (!sid) return null;

  const rows = await db.select().from(sessions).where(eq(sessions.id, sid)).limit(1);
  const row = rows[0];
  if (!row) return null;

  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, sid)).catch(() => {});
    return null;
  }

  if (row.authMethod === "google" || row.role === "student") {
    const stu = await db
      .select()
      .from(students)
      .where(eq(students.studentId, row.userId))
      .limit(1);
    const s = stu[0];
    if (!s) return null;
    // A soft-deleted student is no longer an account holder. Roster soft delete
    // already revokes live sessions in the same transaction, but this is the
    // invariant itself: any code path that sets deleted_at (a future bulk
    // import, a manual fix) must not leave a usable session behind.
    if (s.deletedAt !== null || s.status !== "active") {
      await db.delete(sessions).where(eq(sessions.id, sid)).catch(() => {});
      return null;
    }
    return {
      id: s.studentId,
      name: `${s.firstName} ${s.lastName}`,
      email: s.email ?? "",
      role: "student",
      faculty: s.major,
      studentId: s.studentId,
      phone: s.phone ?? null,
      avatarUrl: s.avatarUrl ?? null,
      admissionYear: s.admissionYear ?? null,
      provider: "google",
    };
  }

  const stf = await db.select().from(staff).where(eq(staff.id, row.userId)).limit(1);
  const st = stf[0];
  if (!st) return null;
  if (st.isActive === false) {
    await db.delete(sessions).where(eq(sessions.id, sid)).catch(() => {});
    return null;
  }
  return {
    id: st.id,
    name: st.fullName,
    role: st.role === "admin" ? "admin" : "staff",
    avatarUrl: st.avatarUrl ?? null,
    staffCode: st.staffCode,
    kind: st.kind,
    provider: "password",
  };
}

export async function destroySession(
  setHeaders: SetHeader,
  headers: Record<string, unknown>,
): Promise<void> {
  const sid = parseCookies(headers.cookie as string | undefined)[SESSION_COOKIE];
  if (sid) {
    await db.delete(sessions).where(eq(sessions.id, sid)).catch(() => {});
  }
  setHeaders["Set-Cookie"] = clearSessionCookieString();
}
