import { readFileSync } from "node:fs";
import { db, pool } from "./client";
import { students, importBatches } from "./schema";
import { eq } from "drizzle-orm";

type RosterRow = {
  studentId: string;
  firstName: string;
  lastName: string;
  major: string;
  groupName?: string;
  level?: string;
};

type RosterFile = {
  admissionYear: number;
  source: string;
  students: RosterRow[];
};

async function main() {
  const data = JSON.parse(
    readFileSync(new URL("./data/students_2567.json", import.meta.url), "utf-8"),
  ) as RosterFile;

  const rows = data.students;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("students_2567.json: empty dataset");
  }

  const [batch] = await db
    .insert(importBatches)
    .values({
      fileName: "students_2567.json",
      totalRows: rows.length,
      importedRows: 0,
    })
    .returning();

  let imported = 0;
  for (const r of rows) {
    await db
      .insert(students)
      .values({
        studentId: r.studentId,
        firstName: r.firstName,
        lastName: r.lastName,
        major: r.major,
        groupName: r.groupName ?? null,
        level: r.level ?? null,
        admissionYear: data.admissionYear,
        importBatchId: batch.id,
      })
      .onConflictDoUpdate({
        target: students.studentId,
        set: {
          firstName: r.firstName,
          lastName: r.lastName,
          major: r.major,
          groupName: r.groupName ?? null,
          level: r.level ?? null,
          admissionYear: data.admissionYear,
          importBatchId: batch.id,
          updatedAt: new Date(),
        },
      });
    imported++;
  }

  await db
    .update(importBatches)
    .set({ importedRows: imported })
    .where(eq(importBatches.id, batch.id));

  console.log(`Imported ${imported}/${rows.length} students (batch ${batch.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
