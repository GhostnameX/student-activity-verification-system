-- 0011: Add students.phone (nullable) so student profiles + certificates keep
--       working after the users table is dropped by migration 0010.

--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "phone" text;