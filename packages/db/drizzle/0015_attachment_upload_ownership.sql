-- 0015: Server-owned upload ledger for request attachment ownership and one-time use.
-- Existing request attachments remain valid; only uploads created after this migration
-- need a ledger row before they can be attached to a request or revision.

CREATE TABLE IF NOT EXISTS "attachment_uploads" (
	"storage_path" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"request_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"consumed_at" timestamp,
	CONSTRAINT "attachment_uploads_student_id_students_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("student_id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "attachment_uploads_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachment_uploads_student_unconsumed_idx" ON "attachment_uploads" USING btree ("student_id") WHERE "attachment_uploads"."consumed_at" is null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachment_uploads_request_idx" ON "attachment_uploads" USING btree ("request_id");
--> statement-breakpoint
ALTER TABLE "attachment_uploads" ENABLE ROW LEVEL SECURITY;
