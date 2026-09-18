-- 0007: Auth groundwork — new staff + custom sessions, students.email,
--       FK reviewer/import → staff. Old better-auth sessions renamed.
--       NOTE: does NOT drop any better-auth table yet (users/accounts stay
--       until 0010 so the API keeps working between deploys).

--> statement-breakpoint
ALTER TABLE "sessions" RENAME TO "better_auth_sessions";
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" NOT NULL,
	"full_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"auth_method" text NOT NULL,
	"role" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "email" text;
--> statement-breakpoint
ALTER TABLE "requests" DROP CONSTRAINT "requests_reviewed_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_reviewed_by_id_staff_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_imported_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_imported_by_staff_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "staff_email_unique" ON "staff" USING btree ("email");
--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "students_email_uidx" ON "students" USING btree ("email") WHERE "students"."email" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;