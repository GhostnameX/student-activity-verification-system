# DEPLOY-ROUND2 — แผน deploy รอบแก้ไข 6 ข้อ (branch `feat/round2-changes`)

> **STATUS: PLAN ONLY — ยังไม่ได้รันอะไรบน production**
> เอกสารนี้ไม่ใช่การอนุมัติให้เขียน production ทุก SQL ต้องได้รับการอนุมัติ "ตรงตัว" ทีละ stage ตาม AGENTS.md
> (การอนุมัติ stage หนึ่งไม่ครอบคลุม stage ถัดไป) ห้าม push / deploy / รัน migration จนกว่าจะได้รับอนุมัติ
> ห้ามใช้ `drizzle-kit migrate` กับ production — รันไฟล์ SQL ตรงตัวทีละไฟล์เท่านั้น ห้ามรัน 0000–0015 ซ้ำ

อ้างอิง: `docs/AUDIT-2026-10.md` (D-1, D-3, D-4, P-3, E-1), `docs/PRODUCTION-RECONSTRUCTION-ROLLOUT.md`, `DEPLOY-0012.md` (ประวัติ), `AGENTS.md`

---

## 0. ขั้นแรกสุด: ตรวจว่า production รัน migration ไหนไปแล้ว (อ่านอย่างเดียว)

**ห้ามเริ่ม §3–§6 จนกว่าจะรู้ผลข้อนี้** `origin/main` มี migration 0016–0020 ในโฟลเดอร์แล้ว (เนื้อหาตรงกับ branch นี้ byte ต่อ byte; branch นี้เพิ่มแค่ 0021) แต่ "มีไฟล์ใน main" ไม่ได้แปลว่า production DB รันแล้ว — production ไม่เคยใช้ `drizzle-kit migrate` จึงไม่มีตาราง migrations ให้ดู ต้องเช็กจาก schema จริงด้วยคำสั่งใน §2.2 (ข้อเดียวพอ: คอลัมน์ `has_0016_*`, `has_0017`, `has_0020`, `still_has_activity_id`, `still_has_staff_email`, `has_0021`)

หลักฐานที่มีอยู่ (ไม่ใช่การยืนยัน): คอมเมนต์ใน `roster-crud.integration.test.ts` ของ main ระบุว่า "deployed database still retains the legacy NOT NULL activity_id" และ commit `6d6137d` เก็บความเข้ากันได้ไว้ → น่าจะยังไม่รัน 0019 แต่ต้องตรวจจริง

เลือกแผนตามผล:

| ผลที่ตรวจได้ | แผน |
|---|---|
| **กรณี A** — production มี 0016, 0017, 0020 แล้ว (`has_0016_*`=true, `has_0017`=true, `has_0020`=true) | ข้าม §4.1–§4.3 ใช้ §4A: รัน 0019 → 0018 → 0021 ตามที่ยังไม่มีจริง (ดูแต่ละตัวว่า `still_has_*` ยังเป็น true ไหม) |
| **กรณี B** — production ยังไม่มีตัวใดตัวหนึ่งของ 0016/0017/0020 | ใช้ §4 เต็ม: 0016 → 0017 → 0020 → 0019 → 0018 → 0021 |
| ผลแบบผสม (มีบางตัว) | รันเฉพาะตัวที่ยังไม่มีตามลำดับเดิม **ห้ามข้ามลำดับ** (0020 ก่อน 0019, 0019 ก่อน 0018) และห้ามรันตัวที่มีแล้วเพื่อ "ให้ครบ" |
| ผลขัดกัน (เช่น มี 0017 แต่ไม่มี 0016) | หยุดและรายงาน ห้ามรันอะไร |

ไม่ว่ากรณีใด: 0019 และ 0018 ยังต้องขออนุมัติแยกด้วยวลีที่มี DESTRUCTIVE และ branch นี้ยังต้องผ่านการ review/merge ก่อน deploy (การ merge เข้า main ไม่ใช่การอนุมัติให้แตะ production)

---

## 1. สิ่งที่เปลี่ยนในรอบนี้ (แยกตามข้อ)

| ข้อ | งาน | ไฟล์หลัก |
|---|---|---|
| 1 | Staff ดูคำร้อง/ไฟล์แนบแบบอ่านอย่างเดียว + กด "ตรวจสอบเอกสารแล้ว" (D1–D5) | `packages/db/drizzle/0021_staff_document_check.sql`, `packages/db/src/schema.ts`, `apps/api/src/app.ts` (`POST /api/requests/:id/staff-check`, สิทธิ์ GET requests/attachments), `apps/web/src/routes/review/`, `routes/student`, `routes/staff`, `routes/admin` |
| 2 | ดีไซน์ + responsive (ไม่เปลี่ยน logic/API/สิทธิ์) | `apps/web/src/app.css` (tokens), `lib/components/{Button,Card,StatCard,StatusBadge,PageHeader,EmptyState}.svelte`, `routes/+layout.svelte` (nav + user menu), ทุกหน้า |
| 3 | คลิกดูรายชื่อ ยื่นแล้ว/ยังไม่ยื่น | `apps/api/src/submission.ts` (helper เดียว, D6), `GET /api/roster/submitted`, `lib/components/SubmissionRoster.svelte`, `routes/stats` |
| 4 | กราฟแท่งแนวนอน สาขา → กลุ่ม → รายชื่อ | `lib/components/HorizontalBarChart.svelte`, `/api/stats/submission` (`groupStats`), `routes/stats` |
| 5 | PDF: วันเวลาที่ยื่น (`submitted_at`, Asia/Bangkok) ในช่องผู้ตรวจสอบ | `apps/api/src/certificate.ts`, `certificate-format.ts`, จุดเรียกใน `app.ts` (approve) |
| 6 | PDF: `(ชื่อ นามสกุล)` ใต้เส้นลายเซ็น ตัดคำนำหน้า | `apps/api/src/certificate.ts` |
| เสริม | audit T-1 (`revisionRequired` ใน `/api/stats`), T-2 (helper เดียว), กลุ่ม "ไม่ระบุกลุ่ม", P-1, S-1, S-2, S-6, P-4, W-1 | ดู `docs/AUDIT-2026-10.md` |
| เสริม | เวลาทุกจุดในเว็บเป็น Asia/Bangkok (`apps/web/src/lib/datetime.ts`), คำว่า "คณะ" → "สาขา" | `lib/i18n.ts`, `lib/datetime.ts` |
| เสริม | เทสต์ไม่ขึ้นกับลำดับ (wrapper ล้างทั้ง test DB ก่อนทุกชุด) | `apps/api/scripts/with-test-db.ts` |
| เสริม | dev stack ข้อมูลปลอม `ua_dev_round2` | `packages/db/src/scripts/round2-devdb.ts`, `DEVELOPER-GUIDE.md` |

**ไม่มี** การเปลี่ยน state machine การอนุมัติ, การออกเลขคำร้อง/ใบรับรอง (`request_counters`, `certificate_counters`) หรือสิทธิ์ approve/reject/request-revision (ยังเป็น admin เท่านั้น; staff ได้ 403)

---

## 2. ก่อนเริ่ม: SQL อ่านอย่างเดียวบน production (Stage 0)

รันใน read-only transaction ผ่าน connection เดียวกับที่แอปใช้ (pooler) ด้วยผู้ใช้ที่ได้รับอนุมัติ **ทุกข้อต้องเป็นไปตามคาด ถ้าไม่ตรงให้หยุดและรายงาน**

```sql
BEGIN TRANSACTION READ ONLY;

-- 2.1 ยืนยันว่ากำลังอยู่บน production ที่ตั้งใจ (Supabase project eioaetihyoxzgpqfjkck, db postgres)
SELECT current_database(), inet_server_addr(), inet_server_port(), version();

-- 2.2 migration ที่ production "มีอยู่แล้ว" (prod ไม่เคยใช้ drizzle migrate จึงเช็กด้วย schema ไม่ใช่ตาราง migrations)
SELECT
  count(DISTINCT table_name)                                                        AS public_tables,         -- ก่อน 0016: 13
  count(*)                                                                          AS public_columns,        -- ก่อน 0016: 112
  bool_or(table_name='students'        AND column_name='deleted_at')                AS has_0016_deleted_at,   -- false = ยังไม่รัน 0016
  bool_or(table_name='students'        AND column_name='email_bound_at')            AS has_0016_bound_at,
  bool_or(table_name='import_batches'  AND column_name='status')                    AS has_0016_batch_status,
  bool_or(table_name='oauth_bind_sessions' AND column_name='attempts')              AS has_0017,
  bool_or(table_name='oauth_login_states')                                          AS has_0020,
  bool_or(table_name='requests'        AND column_name='activity_id')               AS still_has_activity_id, -- true = ยังไม่รัน 0019
  bool_or(table_name='staff'           AND column_name='email')                     AS still_has_staff_email, -- true = ยังไม่รัน 0018
  bool_or(table_name='requests'        AND column_name='staff_checked_at')          AS has_0021
FROM information_schema.columns WHERE table_schema='public';

SELECT table_name FROM information_schema.tables
 WHERE table_schema='public' AND table_name IN ('activities','import_batch_items','oauth_bind_sessions','oauth_login_states');

-- 2.3 ขนาดข้อมูลที่จะโดนแตะ
SELECT
  (SELECT count(*) FROM public.students)                      AS students,        -- ตามแผน reconstruction: 569
  (SELECT count(*) FROM public.staff)                         AS staff,
  (SELECT count(*) FROM public.activities)                    AS activities,      -- ถ้ามี (0019 จะลบตาราง)
  (SELECT count(*) FROM public.requests)                      AS requests,
  (SELECT count(*) FROM public.requests WHERE activity_id IS NOT NULL) AS requests_with_activity,
  (SELECT count(*) FROM public.request_attachments)           AS attachments;
SELECT year, last_number FROM public.certificate_counters ORDER BY year;  -- 2569 = 4 (ตาม rollout doc) ห้ามเปลี่ยน
SELECT year, last_number FROM public.request_counters     ORDER BY year;  -- 2569 = 3

-- 2.4 timezone (audit D-4): ต้องเป็น UTC เพราะ timestamp ไม่มี tz ถูกอ่านเป็น UTC แล้วแปลงเป็น Asia/Bangkok
SHOW timezone;                                   -- ต้องเป็น UTC (หรือ GMT)
SELECT now(), current_setting('TimeZone');
SELECT rolname, rolconfig FROM pg_roles WHERE rolconfig IS NOT NULL;   -- ดูว่า role ที่แอปใช้ตั้ง timezone ไว้หรือไม่

-- 2.5 RLS (audit D-3)
SELECT c.relname, c.relrowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1;
SELECT schemaname, tablename, policyname FROM pg_policies;
SELECT grantee, table_name, privilege_type
  FROM information_schema.role_table_grants
 WHERE grantee IN ('anon','authenticated') AND table_schema='public';

-- 2.6 Storage (audit P-3): bucket request-attachments ต้อง private
SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets;
SELECT policyname, cmd, roles, qual FROM pg_policies WHERE schemaname='storage' AND tablename='objects';

ROLLBACK;
```

ตรวจเพิ่มด้วยมือ (ไม่ใช่ SQL):
- `curl -I https://eioaetihyoxzgpqfjkck.supabase.co/storage/v1/object/public/request-attachments/<path จริง 1 ไฟล์>` ต้อง **ไม่ใช่ 200** (ถ้า 200 = bucket เป็น public → หยุด, ดู §7 รายการ P-3)
- Supabase Dashboard → Database → Advisors (Security): ดู "RLS disabled in public"
- Render → Service → Settings: Blueprint ผูกอยู่ไหม, branch ที่ auto-deploy, env ทั้งหมด (ดู §5)
- Resend → Domains: มีโดเมนที่ verified สำหรับ `EMAIL_FROM` หรือยัง (audit E-1)

**ผลที่ทำให้ต้องหยุด:** timezone ไม่ใช่ UTC (ต้องแก้ config DB/role ก่อน — ขออนุมัติแยก: `ALTER ROLE <role> SET timezone='UTC'`), students ไม่ตรง 569 ตาม reconstruction, counters ต่างจากที่บันทึก, bucket เป็น public

---

## 3. Backup ก่อนเริ่ม (ไม่เขียน production)

1. Supabase Dashboard → Database → Backups: ยืนยันมี PITR/backup ล่าสุด และจดเวลาจุดย้อนกลับ
2. `pg_dump` ฝั่ง client (อ่านอย่างเดียว) เก็บไว้นอก repo (มี PII ห้าม commit):
   ```
   pg_dump --data-only --table=public.staff --table=public.activities \
           --table=public.students --table=public.requests --table=public.sessions  <connection string>  > pre-round2-data.sql
   pg_dump --schema-only <connection string> > pre-round2-schema.sql
   ```
3. สำหรับ **0019** โดยเฉพาะ ให้ได้ไฟล์แยกที่ตรวจแล้วอ่านออก:
   ```sql
   \copy (SELECT * FROM public.activities) TO 'activities.csv' CSV HEADER
   \copy (SELECT id, activity_id, activity_name FROM public.requests) TO 'requests_activity.csv' CSV HEADER
   ```
4. สำหรับ **0018**: `\copy (SELECT id, staff_code, email FROM public.staff) TO 'staff_email.csv' CSV HEADER`
5. Storage: **ไม่แตะ** — ห้ามลบ/ย้าย object ใน bucket `request-attachments` และห้ามรีเซ็ต counters

---

## 4. Migration ที่ production ยังไม่มี — ลำดับที่โค้ดต้องการ

> ส่วนนี้คือ **กรณี B** (production ยังไม่มี 0016/0017/0020) ถ้าเป็น **กรณี A** ดู §4A ด้านล่างแล้วทำเฉพาะตัวที่ยังไม่มี

ลำดับ (audit D-1): **0016 → 0017 → 0020 → 0019 → 0018 → 0021** ทำใน maintenance window เดียวกัน โดย **API เก่าต้องหยุดให้บริการ** (Render → Suspend หรือหน้า maintenance) เพราะหลัง 0019/0018 โค้ดเก่าที่ยังอ้าง `requests.activity_id`/`staff.email` จะพัง และโค้ดใหม่ต้องการ 0016/0019/0020/0021 ครบก่อนเปิด

ถ้า Stage 0 (§2.2) บอกว่า migration ตัวใดมีอยู่แล้ว ให้ข้ามตัวนั้น (ทุกตัวเขียนแบบ `IF NOT EXISTS`/`IF EXISTS` จึงรันซ้ำได้ แต่ไม่ควรรันถ้าไม่จำเป็น)
แต่ละตัวต้องมีวลีอนุมัติแยกของมันเอง และรันเป็น transaction เดียวต่อไฟล์:

> ตัวอย่างวลี: `APPROVE PROD ROUND2 MIGRATION 0016` (แยกต่อเลขไฟล์ — 0019 และ 0018 ต้องมีคำว่า DESTRUCTIVE)

หลังแต่ละตัว: รัน §2.2 ซ้ำและเทียบค่า "คาดหวัง" ที่ระบุไว้ด้านล่าง

### 4.1 — 0016 `0016_roster_soft_delete_import_bind.sql` (additive, ปลอดภัยต่อข้อมูล)
```sql
BEGIN;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "email_bound_at" timestamp;
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'completed';
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
CREATE UNIQUE INDEX IF NOT EXISTS "import_batch_items_batch_student_uidx" ON "import_batch_items" USING btree ("batch_id","student_id");
ALTER TABLE "import_batch_items" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS "oauth_bind_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_bind_sessions_token_hash_uidx" ON "oauth_bind_sessions" USING btree ("token_hash");
CREATE INDEX IF NOT EXISTS "oauth_bind_sessions_expires_at_idx" ON "oauth_bind_sessions" USING btree ("expires_at");
ALTER TABLE "oauth_bind_sessions" ENABLE ROW LEVEL SECURITY;
COMMIT;
```
- ตรวจหลังรัน: `has_0016_deleted_at/bound_at/batch_status = true`, ตาราง `import_batch_items`, `oauth_bind_sessions` มี; `students` ยัง 569
- **Rollback (ใช้ได้เฉพาะก่อนเปิดแอปใหม่ — หลังเปิดแล้วจะทำให้ข้อมูล soft delete/bind หาย):**
  ```sql
  BEGIN;
  DROP TABLE IF EXISTS "oauth_bind_sessions";
  DROP TABLE IF EXISTS "import_batch_items";
  ALTER TABLE "import_batches" DROP COLUMN IF EXISTS "status";
  ALTER TABLE "students" DROP COLUMN IF EXISTS "email_bound_at";
  ALTER TABLE "students" DROP COLUMN IF EXISTS "deleted_at";
  COMMIT;
  ```

### 4.2 — 0017 `0017_oauth_bind_attempt_limit.sql` (additive)
```sql
BEGIN;
ALTER TABLE "oauth_bind_sessions" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0;
COMMIT;
```
- ต้องรันหลัง 0016 (ใช้ตาราง `oauth_bind_sessions`) · Rollback: `ALTER TABLE "oauth_bind_sessions" DROP COLUMN IF EXISTS "attempts";`

### 4.3 — 0020 `0020_durable_oauth_login_state.sql` (additive; ไม่มี 0020 = นักศึกษา login Google ไม่ได้ เพราะ `/api/auth/google/url` ตอบ 500)
```sql
BEGIN;
CREATE TABLE IF NOT EXISTS "oauth_login_states" (
	"id" text PRIMARY KEY NOT NULL,
	"state_hash" text NOT NULL,
	"redirect_path" text,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_login_states_state_hash_uidx" ON "oauth_login_states" USING btree ("state_hash");
CREATE INDEX IF NOT EXISTS "oauth_login_states_expires_at_idx" ON "oauth_login_states" USING btree ("expires_at");
ALTER TABLE "oauth_login_states" ENABLE ROW LEVEL SECURITY;
COMMIT;
```
- Rollback: `DROP TABLE IF EXISTS "oauth_login_states";` (ข้อมูลเป็น state อายุสั้น ไม่มีผลต่อข้อมูลจริง)

### 4.4 — 0019 `0019_remove_legacy_activities.sql` — **DESTRUCTIVE (ลบตาราง `activities` และคอลัมน์ `requests.activity_id`, `requests.activity_name`) ต้องขออนุมัติแยกด้วยวลีที่มีคำว่า DESTRUCTIVE**
เงื่อนไขก่อนรัน (ต้องผ่านทั้งหมด): มี backup §3 ข้อ 1–3 และตรวจแล้วอ่านไฟล์ได้; §2.3 แสดง `activities`/`requests_with_activity` ที่ผู้อนุมัติรับทราบแล้วว่าจะหายไป; ไม่มี view/FK อื่นพึ่ง `activities` (ไฟล์ไม่ใช้ CASCADE โดยตั้งใจ — ถ้ามี dependency จะ error และ rollback เอง)
```sql
BEGIN;
ALTER TABLE "public"."requests" DROP CONSTRAINT IF EXISTS "requests_activity_id_activities_id_fk";
DROP INDEX IF EXISTS "public"."requests_activity_idx";
ALTER TABLE "public"."requests" DROP COLUMN IF EXISTS "activity_id";
ALTER TABLE "public"."requests" DROP COLUMN IF EXISTS "activity_name";
DROP TABLE IF EXISTS "public"."activities";
COMMIT;
```
- ทำไมต้องรัน: `requests.activity_id` เป็น NOT NULL แต่โค้ดใหม่ INSERT ไม่ส่งค่า → **นักศึกษายื่นคำร้องไม่ได้เลยถ้าไม่รัน**
- **Rollback (โครงสร้างเท่านั้น — ข้อมูลกลับมาได้จาก backup §3 ข้อ 3 เท่านั้น):**
  ```sql
  BEGIN;
  CREATE TABLE "activities" (
    "id" text PRIMARY KEY NOT NULL, "title" text NOT NULL, "title_en" text NOT NULL, "type" text NOT NULL,
    "organizer" text NOT NULL, "date" timestamp NOT NULL, "location" text NOT NULL,
    "description" text, "description_en" text, "created_at" timestamp DEFAULT now() NOT NULL);
  ALTER TABLE "requests" ADD COLUMN "activity_name" text;
  ALTER TABLE "requests" ADD COLUMN "activity_id" text;          -- เดิม NOT NULL: ใส่ NOT NULL ได้หลังโหลดข้อมูลกลับเท่านั้น
  -- โหลดข้อมูลกลับจาก activities.csv / requests_activity.csv แล้ว:
  -- ALTER TABLE "requests" ALTER COLUMN "activity_id" SET NOT NULL;
  -- ALTER TABLE "requests" ADD CONSTRAINT "requests_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade;
  -- CREATE INDEX "requests_activity_idx" ON "requests" USING btree ("activity_id");
  COMMIT;
  ```
  **จุดที่ย้อนกลับไม่ได้จริง:** หลัง COMMIT ของ 0019 โค้ดเก่าใช้ไม่ได้และ `activity_id` ของคำร้องใหม่ไม่มีวันกลับมา — ให้ถือว่า "จุดไม่ย้อนกลับ" (point of no return)

### 4.5 — 0018 `0018_remove_staff_email.sql` — destructive ต่อข้อมูลอีเมล staff (forward-only หลังมีบัญชี staff แบบไม่มีอีเมลแล้ว) ขออนุมัติแยก
```sql
BEGIN;
DROP INDEX IF EXISTS "public"."staff_email_unique";
ALTER TABLE "public"."staff" DROP COLUMN IF EXISTS "email";
COMMIT;
```
- ทำไมต้องรัน: `staff.email` เป็น NOT NULL → **สร้าง staff ใหม่ไม่ได้**ถ้าไม่รัน (login staff เดิมยังใช้ได้)
- ต้องเช็กก่อนว่า `staff.staff_code` ครบทุกแถวและไม่ซ้ำ (`SELECT count(*) FROM staff WHERE staff_code IS NULL OR staff_code=''` ต้องเป็น 0)
- Rollback (โครงสร้าง; ค่าอีเมลเดิมต้องโหลดจาก `staff_email.csv`): `ALTER TABLE "staff" ADD COLUMN "email" text; -- โหลดข้อมูลกลับ แล้ว SET NOT NULL + CREATE UNIQUE INDEX "staff_email_unique" ON "staff" ("email");`

### 4.6 — 0021 `0021_staff_document_check.sql` (additive; ทุกคอลัมน์ nullable)
```sql
BEGIN;
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "staff_checked_at" timestamp with time zone;
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "staff_checked_by_id" text REFERENCES "public"."staff"("id") ON DELETE set null;
COMMIT;
```
- Rollback: `ALTER TABLE "requests" DROP COLUMN IF EXISTS "staff_checked_by_id", DROP COLUMN IF EXISTS "staff_checked_at";` (สูญเสียเฉพาะบันทึกการตรวจของ staff หลัง deploy)

### 4A — กรณี A: production มี 0016, 0017, 0020 อยู่แล้ว

SQL และ rollback ของแต่ละตัวเหมือน §4.4–§4.6 ทุกตัวอักษร ต่างกันที่ขั้นตอน:
1. **ข้าม** §4.1, §4.2, §4.3 (ไม่รันซ้ำ แม้จะเขียนแบบ `IF NOT EXISTS`)
2. ยืนยันว่า `oauth_login_states` มีจริงก่อนทำต่อ — ถ้าไม่มี แปลว่าไม่ใช่กรณี A ให้กลับไป §0
3. ลำดับที่เหลือ: **0019 (DESTRUCTIVE) → 0018 → 0021** เฉพาะตัวที่ `still_has_activity_id` / `still_has_staff_email` ยังเป็น true หรือ `has_0021` ยังเป็น false
4. ถ้า 0019 รันไปแล้วด้วย (`still_has_activity_id=false`) แต่ยังไม่มี 0018/0021 ให้รันเฉพาะที่เหลือ
5. §3 (backup) ยังต้องทำเต็ม โดยเฉพาะ backup `activities` ก่อน 0019 ถ้าตารางยังอยู่
6. แผนย้อนกลับ §6.3: แถว "ก่อน §4.4 (0019)" เหลือเพียง "ไม่มี migration ใดที่ต้อง rollback" เพราะ 0016/0017/0020 ไม่ได้ถูกรันในรอบนี้

### 4.7 (แยก ไม่ใช่ migration ในรอบนี้) — เปิด RLS ให้ 6 ตารางที่ยังไม่เปิด (audit D-3)
เฉพาะถ้า §2.5 ยืนยันว่ายังไม่เปิด และต้องได้รับอนุมัติแยกตามกติกา "ห้ามแก้สิทธิ์/RLS บน production โดยไม่ถามยืนยันพร้อม SQL ตรงตัว" — backend ใช้ role ที่ bypass RLS จึงไม่ต้องมี policy:
```sql
BEGIN;
ALTER TABLE "public"."requests"                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."request_attachments"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."request_attachment_revisions"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notifications"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."audit_logs"                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."certificate_counters"          ENABLE ROW LEVEL SECURITY;
COMMIT;
```
ตรวจหลังรัน: ทุก endpoint ผ่าน API ยังทำงาน (service role/owner ข้าม RLS); ถ้า API ต่อด้วย role ที่ไม่ bypass RLS จะเห็น 0 แถว → rollback ด้วย `DISABLE ROW LEVEL SECURITY` ทันที

---

## 5. Environment variables (ตรวจจากโค้ดจริง)

### Render (API, Docker, `bun run --filter @ua/api start`)
| ตัวแปร | ต้องมี | หมายเหตุ |
|---|---|---|
| `DATABASE_URL` | ✔ | production เท่านั้น ตั้งใน Render ห้ามอยู่ในไฟล์ local |
| `NODE_ENV=production` | ✔ | Dockerfile ตั้งให้แล้ว — ต้องเป็น production เพื่อปิด dev bypass และ cookie `Secure` |
| `WEB_ORIGIN` | ✔ | origin ของเว็บบน Vercel (CORS + Google redirect URI = `WEB_ORIGIN/api/auth/google/callback`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | ✔ | redirect URI ใน Google Console ต้องตรง `WEB_ORIGIN/api/auth/google/callback` |
| `GOOGLE_HD` | แนะนำ | default `psru.ac.th` |
| `PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | ✔ | อัปโหลด/ลิงก์ไฟล์แนบ (private bucket `request-attachments`) |
| `RESEND_API_KEY`, `EMAIL_FROM` | ✔ | **`EMAIL_FROM` ต้องเป็นที่อยู่บนโดเมนที่ verified ใน Resend** (default `onboarding@resend.dev` ส่งหาคนนอกบัญชี Resend ไม่ได้ — audit E-1) |
| `CERTIFICATE_LOCATION` | ไม่บังคับ | default `พิษณุโลก` (ช่อง "เขียนที่" ใน PDF) |
| `PORT` / `API_PORT` | – | Render ใส่ `PORT` ให้เอง |
| `RENDER=true` | – | Render ตั้งให้เอง ใช้เลือก IP ใน rate limit login |

**ต้องไม่มี (ลบถ้ามี):** `AUTH_BYPASS_GOOGLE`, `DEV_GOOGLE_EMAIL`, `GATE_SMOKE_MOCK_STORAGE`, `ALLOW_REMOTE_DATABASE`, `ROSTER_TEST`, `TEST_DATABASE_URL`, `SEED_ADMIN_*`, `PILOT_*`
**ลบได้ (โค้ดไม่อ่านแล้ว):** `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `PUBLIC_API_URL` (ใช้เฉพาะตอน `WEB_ORIGIN` ขึ้นต้น `http://localhost`), `PUBLIC_APP_URL`, `PUBLIC_SUPABASE_ANON_KEY` (เว็บไม่ใช้ Supabase client)
> หมายเหตุ: `render.yaml` ใน repo parse ไม่ได้และไม่ตรงกับ prod (audit G-1) — ให้ถือ Render dashboard เป็น source of truth

### Vercel (Web)
- ไม่ต้องมี env บังคับ: `apps/web/vercel.json` rewrite `/api/*` → `https://ua-api-19x4.onrender.com/api/*`
- `PUBLIC_SUPABASE_URL` (ไม่บังคับ — มีค่า fallback ในโค้ด) ใช้สร้าง URL รูปโปรไฟล์ (bucket `avatars` เป็น public ตามการออกแบบ)
- ไม่มี `TZ` ที่ต้องตั้ง: การแปลงเวลาทำด้วย `Intl` ที่ระบุ `Asia/Bangkok` ตรง ๆ ทั้งเว็บและ PDF

---

## 6. ลำดับ deploy, smoke test, ย้อนกลับ

### 6.1 ลำดับ
0. §0 (ตรวจว่ารัน migration ไหนแล้ว) + §2 (read-only) + §3 (backup) ผ่านครบ → ได้รับอนุมัติทีละ stage
1. ประกาศ maintenance → **Suspend API เก่า** บน Render
2. DB: ตามผล §0 — กรณี B: 0016 → 0017 → 0020 → 0019 → 0018 → 0021 (§4); กรณี A: เฉพาะที่ยังไม่มีของ 0019 → 0018 → 0021 (§4A) ตรวจ §2.2 หลังแต่ละตัว
3. (ถ้าอนุมัติ) §4.7 RLS
4. ตั้ง/ตรวจ env บน Render (§5) โดยเฉพาะ `EMAIL_FROM`
5. Deploy **API** (Render) จาก commit ที่ตรวจแล้ว → ดู log boot ต้องเห็น `DEV_BYPASS=false` และ `[db-target] production remote database allowed`
6. Deploy **Web** (Vercel) — ต้องหลัง API เสมอ
7. Resume / เปิดใช้งาน แล้วทำ smoke test §6.2

### 6.2 Smoke test หลัง deploy (ทีละ role, ใช้บัญชีทดสอบ ไม่ใช้ข้อมูลนักศึกษาจริงที่ไม่เกี่ยวข้อง)
- **ทั่วไป:** `/health` 200; เปิดเว็บที่ 375 และ 1280 ไม่ล้นจอ; เวลาทุกจุดเป็นเวลาไทย
- **Student:** login Google → เห็นหน้าคำร้องของฉัน → ยื่นคำร้องพร้อมรูป (ต้องได้เลข `NNN/2569`) → เห็นคำร้อง pending
- **Staff:** login staffCode → `/review` เห็นรายการ + เปิดไฟล์แนบได้ → กด "ยืนยันตรวจสอบเอกสารแล้ว" → Student เห็นแถบ "เจ้าหน้าที่ตรวจสอบเอกสารแล้ว · วันที่ … เวลา … น." และมี notification; Staff **ไม่มี**ปุ่มอนุมัติ/ไม่อนุมัติ/ขอแก้ไข และเรียก `POST /api/requests/:id/approve` ตรง ๆ ได้ 403
- **Admin:** `/staff` เห็น badge "เจ้าหน้าที่ตรวจสอบเอกสารแล้ว" และเหตุผลที่ไม่อนุมัติใต้ป้ายสถานะ; `/admin` ตัวเลขรวม = pending + ให้แก้ไข + อนุมัติ + ไม่อนุมัติ; audit log มีชื่อผู้กระทำและเวลาเป็นเวลาไทย
- **สถิติ (Staff/Admin):** `/stats` การ์ด ยื่นแล้ว + ยังไม่ยื่น = ผู้มีสิทธิ์ทั้งหมด; คลิกลงสาขา → กลุ่ม → รายชื่อ ตัวเลขทุกระดับตรงกัน; กลุ่มเรียง 1,2,…,10; "ไม่ระบุกลุ่ม" มาท้ายสุด
- **PDF:** ดู §6.4
- **ตรวจ DB (อ่านอย่างเดียว):** counters ปี 2569 เพิ่มตามจำนวนที่ใช้จริงเท่านั้น (ไม่รีเซ็ต), `staff_checked_at` ถูกตั้ง, `students` ยัง 569

### 6.3 แผนย้อนกลับ
| จุดที่พัง | วิธี |
|---|---|
| ก่อน §4.4 (0019) | ย้อนได้เต็มรูป: ไม่ต้องรัน migration ที่เหลือ; Resume API เก่า; rollback SQL ของ 0016/0017/0020 ถ้าต้องการ (§4) |
| หลัง 0019 ก่อนเปิดแอปใหม่ | โค้ดเก่าใช้ไม่ได้แล้ว → ต้อง "ไปข้างหน้า": แก้โค้ดใหม่ หรือกู้ DB จาก PITR/backup ที่จดเวลาไว้ (§3) แล้ว deploy โค้ดเก่า — **ตัดสินใจร่วมกับเจ้าของระบบก่อน** |
| API ใหม่พังหลัง deploy (DB ผ่านแล้ว) | Render → Deploy ก่อนหน้า **ใช้ไม่ได้** (โค้ดเก่าต้องการ `activity_id`/`staff.email`) → ให้ revert เป็น commit ก่อนหน้าใน branch นี้ที่เข้ากับ schema ใหม่ หรือแก้ไปข้างหน้า; DB ไม่ต้อง rollback เพราะ 0021/0016/0017/0020 เป็น additive |
| Web พัง | Vercel → Instant Rollback ไป deployment ก่อนหน้าได้ (เว็บเก่าคุยกับ API ใหม่ได้ ยกเว้นหน้าที่ใช้ endpoint ใหม่) |
| Resume ไม่ได้/ข้อมูลผิด | ห้ามลบ/ย้าย storage object, ห้ามรีเซ็ต counters; กู้จาก backup §3 ตามการอนุมัติ |

### 6.4 ทดสอบส่งอีเมลจริง 1 รอบ (ยังไม่เคยทดสอบกับผู้ใช้จริง)
เพราะ `EMAIL_FROM` เดิมเป็น `onboarding@resend.dev` (audit E-1) และการส่งเป็น background (`setImmediate`, ล้มแล้วไม่มีใครรู้ — audit E-2) จึงต้องทดสอบจริงหลัง deploy:
1. ใช้บัญชีที่ **อยู่ใน roster และเป็นอีเมลที่ผู้ทดสอบเข้าถึงได้จริง** (ของผู้ทดสอบเอง) login Google → ยื่นคำร้องทดสอบ 1 รายการ
2. Staff ตรวจเอกสาร (ยืนยันว่ามี notification)
3. Admin อนุมัติคำร้องนั้น
4. ภายใน ~1 นาที: กล่องจดหมายของผู้ทดสอบต้องได้อีเมล "คำร้องของคุณได้รับการอนุมัติ" พร้อมไฟล์ `ใบรับรองการตรวจสอบกิจกรรม_<เลขที่>_2569.pdf`
5. ตรวจ PDF: ● มุมขวาบน "คำร้องที่ N" (**ไม่มีปี**) ● `(ชื่อ นามสกุล)` อยู่ **ใต้** เส้น "ชื่อ - สกุล" และเส้นยังว่าง ● ใต้ "ผู้ตรวจสอบกิจกรรม" บรรทัด `วันที่ dd/mm/พ.ศ. เวลา HH:mm น.` = เวลาที่นักศึกษายื่น (เวลาไทย) ● วันที่ด้านบน = วันที่อนุมัติ ● ติ๊กสาขาถูกช่อง (ถ้าชื่อสาขาใน roster ไม่ตรงรายการ 10 สาขา จะไม่มีเครื่องหมายติ๊ก — audit E-3)
6. ถ้าไม่ได้อีเมล: ดู Render logs ค้น `[email] send failed:` และ `[certificate] generation failed:`, ดู Resend → Logs; อย่าอนุมัติคำร้องจริงของนักศึกษาจนกว่าขั้นนี้จะผ่าน

ตรวจจริงใน dev แล้ว (ไม่ได้ส่งอีเมลจริง): เรียก approve handler จริงกับ `ua_dev_round2` โดยดักการเรียก Resend → ได้ PDF แนบ 1 ไฟล์; ผล "คำร้องที่ 1" ไม่มีปี, `(ณัฐพล เจริญผล)` ใต้เส้น, บรรทัดผู้ตรวจ = `วันที่ 02/09/2569 เวลา 19:30 น.` (= `submitted_at` 12:30Z), วันที่ด้านบน = 2 ตุลาคม 2569 (= `reviewed_at`) — ภาพ `tmp/screens/phase6/pdf/approved-real.png` (local เท่านั้น)

---

## 7. ปัญหา/ข้อจำกัดที่ยังเหลือ (ยังไม่ได้แก้ในรอบนี้ — จาก AUDIT-2026-10.md)

**ต้องจัดการก่อน/ตอน deploy (ไม่ใช่โค้ด):** D-1 (แผนนี้), D-3 (RLS §4.7), D-4 (timezone §2.4), P-3 (bucket private §2.6), E-1 (`EMAIL_FROM` §5), G-1 (`render.yaml` เป็นของเก่า)

| ID | ระดับ | เรื่อง |
|---|---|---|
| E-2 | High | ส่งอีเมล/PDF ล้มเหลวแล้วไม่มีใครรู้ ไม่มี retry/ส่งซ้ำ/ดาวน์โหลดใบรับรอง; อีเมลแจ้ง staff-check ไม่ได้ทำ (แจ้งผ่าน notification ในระบบเท่านั้น) |
| E-3 | Medium | ชื่อสาขาใน roster ที่ไม่ตรง 10 สาขาที่ฝังใน PDF → ไม่ติ๊กสาขาเงียบ ๆ |
| S-5 | Medium | audit/notification เขียนหลัง commit แบบ best-effort (staff-check ทำตามแบบเดียวกัน) |
| P-2 | Medium | Admin ลด/ปิดสิทธิ์ admin คนสุดท้ายได้ |
| A-1 | Medium | rate limit login ทำให้คนนอกล็อกบัญชี admin ได้ (5 ครั้ง/15 นาที) — ควรแก้ก่อนใช้ช่วงอนุมัติจริง |
| A-3 | Medium | เปลี่ยน/รีเซ็ตรหัสผ่านไม่ยกเลิก session เดิม |
| F-1 | Medium | ไม่มี quota/cleanup ไฟล์อัปโหลดที่ไม่ได้ใช้ |
| D-2 | High | โฟลเดอร์ migration สร้าง schema ของ HEAD ใหม่ไม่ได้ (ไม่ครบ) — ใช้ `ua_dev` + 0016–0021 แทนใน dev/test |
| G-4 | Medium | `.dockerignore` ไม่กันไฟล์ลับในโฟลเดอร์ย่อย — อย่าใช้ `docker build` จากเครื่องที่มี `.env*` |
| X-1 | Medium | README / DEVELOPER-GUIDE / USER-MANUAL ส่วนใหญ่ล้าสมัย |
| – | Low | คำร้องเก่าที่ `request_sequence` เป็น NULL: PDF มุมขวาบนจะแสดงเลขใบรับรองแทนเลขคำร้อง (`app.ts` approve: `requestSequence ?? requestNumber`) — คำร้องใหม่ไม่โดน |
| – | Low | Staff ได้ `note`, `rejectionReason`, `storagePath` ของไฟล์แนบใน `GET /api/requests*` (อยู่ในขอบเขต D1 แต่ไม่ minimal; รายการไม่แบ่งหน้า) |
| – | Low | `stripThaiNamePrefix` ตัดคำนำหน้าเฉพาะที่มีช่องว่างตามหลัง ("นายสมชาย" ติดกันจะไม่ถูกตัด) — ยังไม่ได้สำรวจ `first_name` จริงบน production |
| อื่น ๆ | Low | A-2, A-4–A-7, S-3, S-4, F-2, F-3, W-2–W-4 (W-4: `/auth/signout` ออกจากระบบด้วย GET), G-2, G-3, G-5, D-5 |

**ข้อจำกัดของงานรอบนี้:** ตัวเลขสถิติใช้นิยาม "ยื่นแล้ว = มีคำร้อง ≥ 1 รายการ ทุกสถานะ ทุกปี" (D6) ยังไม่แยกรายปี (เปลี่ยนที่ `latestRequestSub` ใน `submission.ts` ที่เดียว); คำร้องที่ยื่นข้ามปี พ.ศ. ยังใช้ counter ตามปีของตัวเอง; ไม่ได้ตรวจกับข้อมูล production จริง (ไม่ได้ต่อ production)

## 8. ผลตรวจก่อนส่งมอบ (local, `ua_roster_test` / `ua_dev_round2`)
ดูรายงานท้าย session: `test:db-guard`, `test:requests`, `test:stats`, `test:roster`, `test:roster-import`, `test:gate-smoke`, `test:oauth-security`, `test:certificate`, `build:check`, svelte-check, build web — ผ่านทั้งหมดเมื่อรันต่อกัน 2 รอบสลับลำดับ; axe (wcag2a/aa) ไม่มี serious/critical ที่ 375/1280 ทั้ง light/dark ทุกหน้าหลัก

หลังรวม `origin/main` (merge commit "Merge origin/main into feat/round2-changes"): ตรวจซ้ำทั้งชุดบน tree ที่รวมแล้ว รวม roster import/export จาก main; หน้า `/roster` ของ main ถูกย้ายไปใช้ shared components

---

## 9. Follow-up: 0022 (เหตุผลตอนส่งคำร้องกลับไปแก้ไข) — branch `feat/round2-followups`

> **ต้องรันบน production ก่อน merge/deploy โค้ดของ branch นี้** เพราะ `POST /api/requests/:id/request-revision` และ `GET /api/requests/:id` อ่าน/เขียนตาราง `request_revision_notes` ถ้ายังไม่มีตาราง ทั้งสอง endpoint จะตอบ 500
> ขอวลีอนุมัติแยก (เช่น `APPROVE PROD ROUND2 MIGRATION 0022`) และเป็นการเพิ่มตารางใหม่ + เปิด RLS (AGENTS.md ต้องถามยืนยันก่อนแตะ RLS) — ไม่แตะตารางหรือข้อมูลเดิม ไม่ลบอะไร

**ตรวจก่อน (อ่านอย่างเดียว):** production มี 0021 แล้ว และยังไม่มีตารางนี้
```sql
BEGIN TRANSACTION READ ONLY;
SELECT bool_or(table_name='request_revision_notes') AS has_0022,
       bool_or(table_name='requests' AND column_name='staff_checked_at') AS has_0021
  FROM information_schema.columns WHERE table_schema='public';   -- ต้อง has_0021=true, has_0022=false/NULL
ROLLBACK;
```

**SQL ตรงตัวของ `packages/db/drizzle/0022_request_revision_notes.sql`** (รันเป็น transaction เดียว; ไม่รันซ้ำเพราะ `IF NOT EXISTS`):
```sql
BEGIN;

CREATE TABLE IF NOT EXISTS "request_revision_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL REFERENCES "public"."requests"("id") ON DELETE cascade,
	"author_staff_id" text REFERENCES "public"."staff"("id") ON DELETE set null,
	"note" text NOT NULL,
	"slots" smallint[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "request_revision_notes_request_created_idx" ON "request_revision_notes" USING btree ("request_id","created_at");
ALTER TABLE "request_revision_notes" ENABLE ROW LEVEL SECURITY;
COMMIT;
```

**ตรวจหลังรัน (อ่านอย่างเดียว):**
```sql
BEGIN TRANSACTION READ ONLY;
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_schema='public' AND table_name='request_revision_notes' ORDER BY ordinal_position;
   -- id text, request_id text, author_staff_id text, note text, slots ARRAY, created_at timestamp with time zone
SELECT indexname FROM pg_indexes WHERE tablename='request_revision_notes';   -- ต้องมี request_revision_notes_request_created_idx
SELECT relrowsecurity FROM pg_class WHERE relname='request_revision_notes';  -- ต้อง true
SELECT count(*) FROM public.request_revision_notes;                         -- 0
ROLLBACK;
```

**Rollback** (ใช้ได้เฉพาะก่อนมีใครกดส่งกลับแก้ไขด้วยโค้ดใหม่ — หลังจากนั้นตารางเก็บเหตุผลจริง ห้ามลบโดยไม่ได้อนุมัติ):
```sql
DROP TABLE IF EXISTS "request_revision_notes";   -- DESTRUCTIVE ต่อข้อมูลในตารางนี้เท่านั้น ขออนุมัติแยก
```

**ลำดับ:** รัน 0022 → ตรวจ → merge/deploy API → deploy Web (API ก่อนเสมอ: เว็บใหม่ส่ง `note` ที่ API เก่าไม่รู้จัก ส่วน API ใหม่รับคำขอจากเว็บเก่าไม่ได้เพราะเว็บเก่าไม่ส่ง `note` → ตอบ 400 `note_required` จนกว่า Web ใหม่จะขึ้น ให้ deploy สองฝั่งต่อเนื่อง)

**Smoke test หลัง deploy:** admin ส่งคำร้องกลับแก้ไขโดยไม่กรอกเหตุผล → ต้องไม่ผ่าน; กรอกเหตุผล → นักศึกษาเจ้าของเห็นกล่อง "สิ่งที่ต้องแก้ไข" + มีแจ้งเตือน; staff เรียก request-revision ได้ 403; นักศึกษาคนอื่นอ่านคำร้องนั้นได้ 403; อีเมลถึงนักศึกษา 1 ฉบับ (ทดสอบกับบัญชีทดสอบ)
