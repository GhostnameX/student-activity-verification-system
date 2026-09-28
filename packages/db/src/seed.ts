import { db, pool } from "./client";
import { staff } from "./schema";
import { eq } from "drizzle-orm";
import { ensureStaff } from "./auth-helpers";

async function ensureAdmin(staffCode: string) {
  const seedAdminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!seedAdminPassword) {
    const existing = await db.select().from(staff).where(eq(staff.staffCode, staffCode));
    if (existing.length > 0) {
      console.log(`[admin] existing staff row found (${staffCode}) — skipping hash.`);
      return existing[0];
    }
    throw new Error(
      `Missing SEED_ADMIN_PASSWORD env. Set it before seeding staff admin ${staffCode}.`,
    );
  }

  const { user, inserted } = await ensureStaff({
    staffCode,
    fullName: "Weean",
    role: "admin",
    password: seedAdminPassword,
  });
  console.log(`[admin] ${inserted ? "inserted" : "exists"} -> ${user.staffCode} (${user.role})`);
  return user;
}

async function seed() {
  console.log("Seeding...");

  // Admin (new staff table). Requires SEED_ADMIN_PASSWORD.
  const staffCode = (process.env.SEED_ADMIN_STAFF_CODE || "admin-main").trim().toLowerCase();
  await ensureAdmin(staffCode);

  console.log("Seed complete!");
  console.log(`Admin staff (from SEED_ADMIN_PASSWORD): ${staffCode}`);
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
