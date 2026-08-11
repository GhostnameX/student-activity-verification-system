CREATE TABLE "certificate_counters" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "certificate_number" integer;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "certificate_year" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "requests_cert_number_uidx" ON "requests" USING btree ("certificate_year","certificate_number") WHERE "requests"."certificate_number" is not null;
--> statement-breakpoint
INSERT INTO "certificate_counters" ("year", "last_number")
SELECT (EXTRACT(YEAR FROM now())::int + 543), COUNT(*) FROM "requests" WHERE "status" = 'approved';