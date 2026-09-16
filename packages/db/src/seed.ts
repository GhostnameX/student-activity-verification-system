import { db, pool } from "./client";
import { users, accounts } from "./schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "@better-auth/utils/password";

async function ensureUser(opts: {
  email: string;
  name: string;
  role: "student" | "staff" | "admin";
  password: string;
  faculty?: string;
  studentId?: string;
}) {
  const existing = await db.select().from(users).where(eq(users.email, opts.email));
  if (existing.length > 0) return existing[0];

  const now = new Date();
  const [user] = await db
    .insert(users)
    .values({
      name: opts.name,
      email: opts.email,
      role: opts.role,
      faculty: opts.faculty ?? null,
      studentId: opts.studentId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await db.insert(accounts).values({
    id: crypto.randomUUID(),
    userId: user.id,
    accountId: user.email,
    providerId: "credential",
    password: await hashPassword(opts.password),
    createdAt: now,
    updatedAt: now,
  });

  return user;
}

async function seed() {
  console.log("Seeding...");

  const studentPassword = await hashPassword("student123");
  const staffPassword = await hashPassword("staff123");
  const adminPassword = await hashPassword("admin123");
  await ensureUser({
    email: "student@uni.ac.th",
    name: "นักศึกษา",
    role: "student",
    password: studentPassword,
    faculty: "วิศวกรรมศาสตร์",
    studentId: "64010001",
  });
  await ensureUser({
    email: "staff@uni.ac.th",
    name: "เจ้าหน้าที่",
    role: "staff",
    password: staffPassword,
    faculty: "สำนักงานกิจการนักศึกษา",
  });
  await ensureUser({
    email: "admin@uni.ac.th",
    name: "ผู้ดูแลระบบ",
    role: "admin",
    password: adminPassword,
  });

  console.log("Seed complete!");
  console.log("Test accounts:");
  console.log("  student@uni.ac.th / student123");
  console.log("  staff@uni.ac.th / staff123");
  console.log("  admin@uni.ac.th / admin123");
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
