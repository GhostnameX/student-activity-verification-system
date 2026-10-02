-- 0022: Reason history for "send back for revision" (round 2 follow-up).
-- New table only: no existing table or column is touched. Each admin request-revision
-- call stores one row (note + flagged slots) in the same transaction as the status change.
-- RLS is enabled with no policy: the API uses the service role, direct anon access stays denied.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "request_revision_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL REFERENCES "public"."requests"("id") ON DELETE cascade,
	"author_staff_id" text REFERENCES "public"."staff"("id") ON DELETE set null,
	"note" text NOT NULL,
	"slots" smallint[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "request_revision_notes_request_created_idx" ON "request_revision_notes" USING btree ("request_id","created_at");
--> statement-breakpoint
ALTER TABLE "request_revision_notes" ENABLE ROW LEVEL SECURITY;
