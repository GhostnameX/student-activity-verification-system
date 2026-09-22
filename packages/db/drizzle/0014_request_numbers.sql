-- 0014: Request numbers (request_counters).
--       request_counters drives requests.request_sequence per (Buddhist) year.
--       certificate_number/certificate_counters already live in 0003 (kept here as no-op
--       CREATE TABLE IF NOT EXISTS so re-running on a DB that applied it is safe).
--       Kept idempotent so re-running against a DB that already applied it is a no-op.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "request_counters" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "request_sequence" integer;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "request_year" integer;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "requests_request_number_uidx" ON "requests" USING btree ("request_year","request_sequence") WHERE "requests"."request_sequence" is not null;
--> statement-breakpoint
ALTER TABLE "request_counters" ENABLE ROW LEVEL SECURITY;