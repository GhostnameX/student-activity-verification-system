import { db, pool } from "./client";
import { staff } from "./schema";
import { eq } from "drizzle-orm";
import { ensureStaff } from "./auth-helpers";

async function ensureAdmin(email: string) {
  const seedAdminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!seedAdminPassword) {
    const existing = await db.select().from(staff).where(eq(staff.email, email));
    if (existing.length > 0) {
      console.log(`[admin] existing staff row found (${email}) — skipping hash.`);
      return existing[0];
    }
    throw new Error(
      "Missing SEED_ADMIN_PASSWORD env. Set it before seeding the staff admin (weean2547@gmail.com).",
    );
  }

  const { user, inserted } = await ensureStaff({
    email,
    fullName: "Weean",
    role: "admin",
    password: seedAdminPassword,
  });
  console.log(`[admin] ${inserted ? "inserted" : "exists"} -> ${user.email} (${user.role})`);
  return user;
}

async function seed() {
  console.log("Seeding...");

  // Admin (new staff table). Requires SEED_ADMIN_PASSWORD.
  await ensureAdmin("weean2547@gmail.com");

  console.log("Seed complete!");
  console.log("Admin staff (from SEED_ADMIN_PASSWORD): weean2547@gmail.com");
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
