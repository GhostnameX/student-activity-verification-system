import { db } from "@ua/db/client";
import { sessions, students, staff } from "@ua/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export const SESSION_COOKIE = "ua_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "student" | "staff" | "admin";
  faculty?: string | null;
  studentId?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  admissionYear?: number | null;
  kind?: "main" | "emergency" | null;
  provider: "google" | "password";
}

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

export async function createSessionFor(
  setHeaders: SetHeader,
  userId: string,
  role: SessionUser["role"],
  provider: SessionUser["provider"],
): Promise<string> {
  const sid = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: sid, userId, authMethod: provider, role, expiresAt });
  setHeaders["Set-Cookie"] = sessionCookieString(sid);
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
    if (s.status !== "active") {
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
    email: st.email,
    role: st.role === "admin" ? "admin" : "staff",
    faculty: null,
    studentId: null,
    phone: null,
    avatarUrl: st.avatarUrl ?? null,
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