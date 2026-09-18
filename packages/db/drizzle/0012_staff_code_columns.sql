-- 0012: Staff login via staffCode + account lifecycle.
--       Adds staff_code (unique), is_active, kind (main|emergency) to staff.
--       Backfills staff_code = lower(email) so existing accounts can still
--       sign in right after deploy (admin changes it later via the admin UI).

--> statement-breakpoint
CREATE TYPE "staff_kind" AS ENUM ('main', 'emergency');
--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "staff_code" text;
--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "kind" "staff_kind" DEFAULT 'main' NOT NULL;
--> statement-breakpoint
UPDATE "staff" SET "staff_code" = lower("email") WHERE "staff_code" IS NULL;
--> statement-breakpoint
ALTER TABLE "staff" ALTER COLUMN "staff_code" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "staff_code_unique" ON "staff" USING btree ("staff_code");