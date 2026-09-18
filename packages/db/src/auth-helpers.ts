import { db, pool } from "./client";
import { staff } from "./schema";
import { eq } from "drizzle-orm";
import { hash, verify } from "@node-rs/argon2";

export async function ensureStaff(opts: {
  email: string;
  fullName: string;
  role: "student" | "staff" | "admin";
  password: string;
}) {
  const existing = await db.select().from(staff).where(eq(staff.email, opts.email));
  if (existing.length > 0) {
    return { user: existing[0], inserted: false };
  }

  const passwordHash = await hash(opts.password, {
    memoryCost: 19456,
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  });

  const [user] = await db
    .insert(staff)
    .values({
      id: crypto.randomUUID(),
      email: opts.email,
      passwordHash,
      role: opts.role,
      fullName: opts.fullName,
      createdAt: new Date(),
    })
    .returning();

  return { user, inserted: true };
}

export async function verifyStaffPassword(email: string, password: string) {
  const [row] = await db.select().from(staff).where(eq(staff.email, email));
  if (!row || !row.passwordHash) return null;
  const ok = await verify(row.passwordHash, password);
  return { user: row, ok };
}

export { hash, verify };