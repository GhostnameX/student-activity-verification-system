-- 0013: Profile avatars (students + staff).
--       Adds avatar_url (nullable, storage path in the "avatars" bucket) so
--       users can set a profile picture on /profile.

--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "avatar_url" text;
--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "avatar_url" text;