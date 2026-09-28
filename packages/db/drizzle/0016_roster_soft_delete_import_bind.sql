-- 0016: Student roster soft delete, import rollback snapshot, pending OAuth bind sessions.
--       Extends 0015 (attachment_uploads).
--
--       Hard delete of a student is impossible while requests, notifications and
--       attachment_uploads reference it ON DELETE CASCADE, so V1 roster delete is
--       soft only: students.deleted_at. Restore sets deleted_at = NULL and never
--       touches the academic status.
--
--       import_batch_items is a persistent per-row snapshot so an import batch can
--       be rolled back: 'inserted' rows have before_data = NULL, 'updated' rows
--       store the exact pre-import row in before_data. student_id is intentionally
--       NOT a foreign key — rolling back an 'inserted' row must be able to keep
--       the snapshot for audit after the student row is gone.

--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "email_bound_at" timestamp;
--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'completed';

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_batch_items" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"student_id" text NOT NULL,
	"action" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "import_batch_items_action_check" CHECK ("action" IN ('inserted','updated')),
	CONSTRAINT "import_batch_items_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_batch_items_batch_student_uidx" ON "import_batch_items" USING btree ("batch_id","student_id");
--> statement-breakpoint
ALTER TABLE "import_batch_items" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_bind_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_bind_sessions_token_hash_uidx" ON "oauth_bind_sessions" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_bind_sessions_expires_at_idx" ON "oauth_bind_sessions" USING btree ("expires_at");
--> statement-breakpoint
ALTER TABLE "oauth_bind_sessions" ENABLE ROW LEVEL SECURITY;
