import { db, pool } from "../client";
import { staff } from "../schema";
import { eq } from "drizzle-orm";
import { verify } from "@node-rs/argon2";

const EMAIL = process.env.SEED_ADMIN_EMAIL || "weean2547@gmail.com";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || "";

async function verifyAdmin() {
  const conditions: string[] = [];
  const failures: string[] = [];

  const [row] = await db.select().from(staff).where(eq(staff.email, EMAIL));
  if (row) {
    conditions.push(`staff row exists for ${EMAIL}`);
  } else {
    failures.push(`NO staff row for ${EMAIL}`);
  }

  if (row?.passwordHash) {
    conditions.push("password_hash present");
  } else if (row) {
    failures.push("password_hash is NULL");
  }

  if (row?.passwordHash) {
    const len = row.passwordHash.length;
    const prefix = row.passwordHash.slice(0, 12);
    conditions.push(`hash_len=${len} prefix=${prefix}`);
    if (len < 87) failures.push(`hash_len ${len} < 87 (unexpected argon2id length)`);
    if (!row.passwordHash.startsWith("$argon2id$")) failures.push(`hash prefix not argon2id: ${prefix}`);
  }

  if (row?.passwordHash && PASSWORD) {
    const ok = await verify(row.passwordHash, PASSWORD);
    conditions.push(`argon2 verify(PASSWORD) roundtrip=${ok}`);
    if (!ok) failures.push("argon2 verify() FAILED for SEED_ADMIN_PASSWORD");
  } else if (row?.passwordHash) {
    failures.push("SEED_ADMIN_PASSWORD not set — cannot do real verify() roundtrip");
  }

  if (failures.length > 0) {
    console.error("VERIFY GATE FAILED:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error(`  (${conditions.length} conditions passed)`);
    process.exit(1);
  }

  console.log("VERIFY GATE PASSED:");
  for (const c of conditions) console.log(`  ✓ ${c}`);
}

verifyAdmin()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });