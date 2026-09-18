-- 0009: Split polymorphic recipient/actor columns on notifications &
--       audit_logs (define: notifications can target student OR staff;
--       audit actor is student OR staff). Adds CHECK guaranteeing exactly
--       one side is set. safe: both tables have 0 rows on prod.

--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "notifications_user_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "notifications_user_read_idx";
--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN IF EXISTS "user_id";
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "student_id" text;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "staff_id" text;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_student_id_students_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("student_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actor_id_users_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "audit_logs_actor_idx";
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "actor_id";
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "actor_student_id" text;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "actor_staff_id" text;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_student_id_students_student_id_fk" FOREIGN KEY ("actor_student_id") REFERENCES "public"."students"("student_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_staff_id_staff_id_fk" FOREIGN KEY ("actor_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "notifications_student_idx" ON "notifications" USING btree ("student_id");
--> statement-breakpoint
CREATE INDEX "notifications_staff_idx" ON "notifications" USING btree ("staff_id");
--> statement-breakpoint
CREATE INDEX "notifications_recipient_read_idx" ON "notifications" USING btree ("student_id","staff_id","read_at");
--> statement-breakpoint
CREATE INDEX "audit_logs_actor_student_idx" ON "audit_logs" USING btree ("actor_student_id");
--> statement-breakpoint
CREATE INDEX "audit_logs_actor_staff_idx" ON "audit_logs" USING btree ("actor_staff_id");
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_check" CHECK ((("student_id" IS NOT NULL AND "staff_id" IS NULL) OR ("student_id" IS NULL AND "staff_id" IS NOT NULL)));
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_check" CHECK ((("actor_student_id" IS NOT NULL AND "actor_staff_id" IS NULL) OR ("actor_student_id" IS NULL AND "actor_staff_id" IS NOT NULL)));