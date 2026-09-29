-- 0019: Remove the legacy Activities entity and request denormalizations.
-- No CASCADE: an unexpected dependency must stop this migration for review.

--> statement-breakpoint
ALTER TABLE "public"."requests"
  DROP CONSTRAINT IF EXISTS "requests_activity_id_activities_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."requests_activity_idx";
--> statement-breakpoint
ALTER TABLE "public"."requests" DROP COLUMN IF EXISTS "activity_id";
--> statement-breakpoint
ALTER TABLE "public"."requests" DROP COLUMN IF EXISTS "activity_name";
--> statement-breakpoint
DROP TABLE IF EXISTS "public"."activities";
