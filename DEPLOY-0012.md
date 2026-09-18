# DEPLOY-0012 — Staff code login + staff management (prod)

> **STATUS: PLANNED — ยังไม่รัน prod ใดๆ**
> รอ Vee review + กด confirm ผ่าน SQL Editor ทีละ STEP ก่อนรันจริง
>
> - **เครื่องมือ:** Supabase Dashboard → **SQL Editor** (ไม่ใช่ drizzle-kit push เพราะ prod ใช้ manual SQL convention — เหมือน 0007+ ถึง 0011)
> - **หลักบังคับ:** `staff_code` column ต้องมี **ก่อน** รัน backfill + `SET NOT NULL` ต้องเกิด **หลัง** backfill
> - Deploy app ต้อง**หลัง** schema push เสมอ (ไม่งั้น code ใหม่อ่าน column ที่ไม่มี → ระเบิด)

---

## ลำดับบังคับ (สรุปย่อ)

```
[0] Checkpoint/backup prod
  ↓
[1] Schema: ADD COLUMN staff_code (nullable)  ← staff_code มี column ก่อน
  ↓
[2] Backfill: UPDATE staff SET staff_code = lower(email) WHERE staff_code IS NULL
  ↓
[2.5] STOP + Review: ตรวจ staff_code ครบ ไม่มี NULL/duplicate  ← ***หยุดรอ Vee confirm อีกครั้ง***
  ↓
[3] Enforce: SET NOT NULL + CREATE UNIQUE INDEX
  ↓
[4] Deploy app (API + web)  ← หลัง schema ครบเสมอ
  ↓
[5] Verify prod + สร้าง backup emergency admin ผ่าน UI
```

---

## STEP 0 — Checkpoint / Backup (รันก่อนแตะ prod)

ใน **Supabase Dashboard → Database → Backups**:
- ตรวจว่ามี **PITR** / recent backup ไว้ (จุด restore ถ้าพลาด)
- หรือ dump ตาราง staff เก็บไว้เป็น checkpoint:

```sql
-- (optional) dump staff ทั้งตารางก่อน migration — รันในขั้นตอนขั้นสูงหรือ psql
-- pg_dump -t public.staff --data-only ...
-- หรือใช้ Dashboard → SQL Editor: SELECT * แล้ว export
```

**Rollback/checkpoint เพิ่มเติม:** ให้ copy ผล `SELECT staff_code FROM staff` ก่อนรัน STEP 3 เพื่อใช้เทียบหลัง deploy

---

## STEP 1 — Schema: เพิ่ม column staff_code (PROD, SQL Editor)

```sql
-- ประเภท enum สำหรับ kind (main|emergency)
CREATE TYPE "staff_kind" AS ENUM ('main', 'emergency');

-- เพิ่ม column เป็น nullable ก่อน (ยังไม่บังคับ) — ห้ามใส่ NOT NULL ตรงนี้
ALTER TABLE "staff" ADD COLUMN "staff_code" text;
ALTER TABLE "staff" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;
ALTER TABLE "staff" ADD COLUMN "kind" "staff_kind" DEFAULT 'main' NOT NULL;
```

> ⚠️ `staff_code` ยัง **nullable** ตรงนี้ — ยังไม่ `SET NOT NULL`

---

## STEP 2 — Backfill (PROD, SQL Editor)

```sql
-- backfill staff_code = lower(email) — เฉพาะแถวที่ยัง NULL (คนเก่าจะได้ staff_code = email)
UPDATE "staff" SET "staff_code" = lower("email") WHERE "staff_code" IS NULL;
```

---

## STEP 2.5 — ⏸️ STOP + REVIEW (รอ Vee confirm เสมอ)

รัน verify ต่อไปนี้ — ผ่านครบทุกข้อ **ถึง** ไป STEP 3:

```sql
-- (1) ไม่มี NULL เหลือใน staff_code
SELECT count(*) AS total,
       count(staff_code) AS has_code,
       count(*) - count(staff_code) AS null_or_missing
FROM "staff";

-- (2) ไม่มี staff_code ซ้ำ (unique)
SELECT staff_code, count(*) AS n
FROM "staff"
GROUP BY staff_code
HAVING count(*) > 1;

-- (3) ตัวอย่างแถวหลัง backfill
SELECT "id", "email", "staff_code", "is_active", "kind"
FROM "staff"
ORDER BY "id" LIMIT 10;
```

**PASS criteria:**
- `null_or_missing = 0`
- Query (2) คืนค่า **0 แถว** (ไม่มี duplicate)
- Query (3) เห็น staff_code = email เดิมครบทุกแถว

> ถ้ายังเห็น NULL หรือ duplicate → **หยุด** ห้ามไป STEP 3 ต้องแก้ data ก่อน (ดู Rollback)

---

## STEP 3 — Enforce NOT NULL + Unique (PROD, SQL Editor) — เฉพาะเมื่อ STEP 2.5 PASS

```sql
-- บังคับ NOT NULL + unique สำหรับ staff_code
ALTER TABLE "staff" ALTER COLUMN "staff_code" SET NOT NULL;
CREATE UNIQUE INDEX "staff_code_unique" ON "staff" USING btree ("staff_code");
```

รัน verify ต่อ:

```sql
-- unique ทำงาน ไม่มี error
INSERT INTO "staff" ("email", "staff_code", "password_hash")
VALUES ('dup-test@x.dev', 'dup-test@x.dev', 'x') ON CONFLICT DO NOTHING;
-- ควรไม่ error (หรือจะข้ามไปก็ได้ ไม่อยากเพิ่ม test data บน prod)
```

---

## STEP 4 — Deploy App (เฉพาะเมื่อ schema ครบ PASS)

ตอนนี้ schema prod พร้อมแล้ว → deploy code ใหม่ (API + web):
- build + push ตาม flow deploy ของโปรเจค (branch ที่มี staff code login + staff mgmt)

---

## STEP 5 — Verify Prod + Post-deploy tasks

1. Sign in ด้วย **staff_code** (คนเก่า = email เดิม) — ผ่าน
2. เปิด admin UI → **จัดการเจ้าหน้าที่** → list/create/edit/reset password/disable — ครบ
3. **สร้าง backup emergency admin** ผ่าน UI (role=admin, kind=emergency, argon2, ไม่มี hardcoded password) — audit-log ครบ
4. เปลี่ยน `staff_code` ของ admin หลักจากค่า default (email) เป็น code ที่ต้องการผ่าน manage-staff UI
5. เช็ค audit-log ว่าทุก action ถูกบันทึก

---

## Rollback (ถ้า STEP 2.5 พบ NULL/duplicate หรือหลัง deploy เจอปัญหา)

```sql
-- reverse STEP 3 (NOT NULL + unique)
DROP INDEX IF EXISTS "staff_code_unique";
ALTER TABLE "staff" ALTER COLUMN "staff_code" DROP NOT NULL;

-- reverse STEP 1 (columns + enum)
ALTER TABLE "staff" DROP COLUMN IF EXISTS "staff_code";
ALTER TABLE "staff" DROP COLUMN IF EXISTS "is_active";
ALTER TABLE "staff" DROP COLUMN IF EXISTS "kind";
DROP TYPE IF EXISTS "staff_kind";
```

> Rollback = แผนเดิมกลับมา 100% (staff ที่มีอยู่ไม่ถูกลบ ข้อมูลครบ) + **ต้อง rollback app code เป็นรุ่นเก่าคู่กัน** เพราะ code ใหม่อ่าน column ที่หายไป

---

## Checklist สุดท้ายก่อน confirm

- [ ] Prod DB มี recent backup / PITR
- [ ] STEP 1 (add columns) รัน PASS
- [ ] STEP 2 (backfill) รัน PASS
- [ ] STEP 2.5 review: no NULL, no duplicate → **Vee confirm**
- [ ] STEP 3 (NOT NULL + unique)
- [ ] STEP 4 (deploy app)
- [ ] STEP 5 (verify + backup emergency admin + เปลี่ยน staff_code admin)
