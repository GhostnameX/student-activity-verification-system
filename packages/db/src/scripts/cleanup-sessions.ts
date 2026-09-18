import { db, pool } from "../client";
import { sessions } from "../schema";
import { lt, count } from "drizzle-orm";

const DRY_RUN = process.argv.includes("--dry-run");

async function cleanup() {
  const now = new Date();

  const [{ value: total }] = await db.select({ value: count() }).from(sessions);
  const expired = await db
    .select({ count: count() })
    .from(sessions)
    .where(lt(sessions.expiresAt, now));

  const expiredCount = expired[0]?.count ?? 0;

  if (DRY_RUN) {
    console.log(`[cleanup:sessions] DRY-RUN — total=${total} expired=<${now.toISOString()}> count=${expiredCount} (no changes)`);
    return { deleted: 0, total, expired: expiredCount, dryRun: true };
  }

  const deleted = await db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.id });

  console.log(`[cleanup:sessions] deleted ${deleted.length}/${expiredCount} expired sessions (total=${total})`);
  return { deleted: deleted.length, total, expired: expiredCount, dryRun: false };
}

cleanup()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });