import { db, pool } from "../client";
import { students } from "../schema";
import { eq } from "drizzle-orm";

const STUDENT_ID = process.env.PILOT_STUDENT_ID || "6712602001";
const PILOT_EMAIL = process.env.PILOT_EMAIL || "weean2547@gmail.com";
const DRY_RUN = process.argv.includes("--dry-run");

async function setPilotEmail() {
  const rows = await db.select().from(students).where(eq(students.studentId, STUDENT_ID)).limit(1);
  const stu = rows[0];
  if (!stu) {
    console.error(`[pilot] NO student with studentId=${STUDENT_ID}`);
    process.exit(1);
  }
  console.log(`[pilot] before: studentId=${stu.studentId} name=${stu.firstName} ${stu.lastName} status=${stu.status} email=${stu.email ?? "NULL"}`);

  if (stu.status !== "active") {
    console.error(`[pilot] WARN: status is "${stu.status}" — Google login will be BLOCKED (auth.ts requires active)`);
  }

  if (DRY_RUN) {
    console.log(`[pilot] DRY-RUN — would set email=${PILOT_EMAIL} on ${STUDENT_ID} (no changes)`);
    return { updated: 0, dryRun: true };
  }

  await db
    .update(students)
    .set({ email: PILOT_EMAIL })
    .where(eq(students.studentId, STUDENT_ID));

  const after = await db.select().from(students).where(eq(students.studentId, STUDENT_ID)).limit(1);
  console.log(`[pilot] after: email=${after[0]?.email}`);
  console.log(`[pilot] SET email=${PILOT_EMAIL} on studentId=${STUDENT_ID}`);
  return { updated: 1, dryRun: false };
}

setPilotEmail()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });