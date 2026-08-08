import { db, pool } from "./client";
import { users, activities, accounts } from "./schema";
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

  const existingActivities = await db.select().from(activities);
  if (existingActivities.length === 0) {
    await db.insert(activities).values([
      {
        title: "ปฐมนิเทศนักศึกษาใหม่",
        titleEn: "New Student Orientation",
        type: "กิจกรรมบังคับ",
        organizer: "กองกิจการนักศึกษา",
        date: new Date(2026, 5, 15),
        location: "อาคารเฉลิมพระเกียรติ",
        description: "กิจกรรมปฐมนิเทศสำหรับนักศึกษาใหม่ทุกคณะ",
        descriptionEn: "Orientation activity for all new students",
      },
      {
        title: "ค่ายอาสาพัฒนาชุมชน",
        titleEn: "Community Development Camp",
        type: "กิจกรรมอาสา",
        organizer: "ชมรมอาสาพัฒนา",
        date: new Date(2026, 7, 10),
        location: "จังหวัดสระบุรี",
        description: "ค่ายอาสาพัฒนาชุมชน 3 วัน 2 คืน",
        descriptionEn: "3-day community development camp",
      },
      {
        title: "การแข่งขันกีฬาสีภายในมหาวิทยาลัย",
        titleEn: "University Sports Day",
        type: "กิจกรรมกีฬา",
        organizer: "สโมสรนักศึกษา",
        date: new Date(2026, 9, 20),
        location: "สนามกีฬากลาง",
        description: "การแข่งขันกีฬาสีภายในมหาวิทยาลัย",
        descriptionEn: "Inter-faculty sports competition",
      },
    ]);
  }

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
