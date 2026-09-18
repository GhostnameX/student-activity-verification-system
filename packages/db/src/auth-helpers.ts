import { db, pool } from "./client";
import { staff } from "./schema";
import { eq, desc } from "drizzle-orm";
import { hash, verify } from "@node-rs/argon2";

export interface StaffMember {
  id: string;
  email: string;
  staffCode: string;
  role: "student" | "staff" | "admin";
  fullName: string;
  isActive: boolean;
  kind: "main" | "emergency";
  createdAt: Date;
  updatedAt: Date;
}

export type StaffRole = "staff" | "admin";
export type StaffKind = "main" | "emergency";

function argon2Opts() {
  return {
    memoryCost: 19456,
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  };
}

export async function ensureStaff(opts: {
  email: string;
  staffCode?: string;
  fullName: string;
  role: StaffRole;
  password: string;
  kind?: StaffKind;
}) {
  const existing = await db.select().from(staff).where(eq(staff.email, opts.email));
  if (existing.length > 0) {
    return { user: existing[0], inserted: false };
  }

  const passwordHash = await hash(opts.password, argon2Opts());
  const code = (opts.staffCode ?? opts.email).trim().toLowerCase();

  const [user] = await db
    .insert(staff)
    .values({
      id: crypto.randomUUID(),
      email: opts.email,
      staffCode: code,
      passwordHash,
      role: opts.role,
      fullName: opts.fullName,
      kind: opts.kind ?? "main",
      createdAt: new Date(),
    })
    .returning();

  return { user, inserted: true };
}

export async function verifyStaffByCode(staffCode: string, password: string) {
  const [row] = await db.select().from(staff).where(eq(staff.staffCode, staffCode));
  if (!row || !row.passwordHash) return null;
  const ok = await verify(row.passwordHash, password);
  return { user: row, ok };
}

export { hash, verify };