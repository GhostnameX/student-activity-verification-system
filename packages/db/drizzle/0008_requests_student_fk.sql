-- 0008: Point requests.student_id at students (roster) instead of users
--       (better-auth). safe: pre-flight confirmed 0 request rows.

--> statement-breakpoint
ALTER TABLE "requests" DROP CONSTRAINT "requests_student_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_student_id_students_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("student_id") ON DELETE cascade ON UPDATE no action;