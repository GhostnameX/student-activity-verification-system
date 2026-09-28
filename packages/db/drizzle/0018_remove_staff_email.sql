-- 0018: Staff identity is staff_code. Email is student-only identity data.
-- Apply only after application compatibility code no longer reads staff.email.

--> statement-breakpoint
DROP INDEX IF EXISTS "public"."staff_email_unique";
--> statement-breakpoint
ALTER TABLE "public"."staff" DROP COLUMN IF EXISTS "email";
