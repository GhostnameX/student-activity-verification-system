-- 0021: Staff document check on a pending request (round 2, D2).
-- Records that a staff member reviewed the attached documents. Separate from
-- reviewed_at / reviewed_by_id, which remain the admin's decision.
-- ADD COLUMN only: both columns are nullable, so existing rows are untouched.

--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "staff_checked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "staff_checked_by_id" text REFERENCES "public"."staff"("id") ON DELETE set null;
