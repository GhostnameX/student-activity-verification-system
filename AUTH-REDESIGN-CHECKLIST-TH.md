# Checklist — Auth Redesign (groundwork 0007–0010)

Vee: ใช้ไฟล์นี้เป็นตัวเช็ค ขีด ✓ ตามลำดับก่อนกด deploy เท่านั้น

---

## Phase 0 — ก่อนทำอะไร (environment)

- [ ] `SEED_ADMIN_PASSWORD` ตั้งแล้วใน env ที่จะรัน seed (ไม่ใช่ไฟล์ใน git)
- [ ] `GOOGLE_CLIENT_ID` (Web application) มีอยู่แล้ว และ OAuth consent screen เสร็จ
- [ ] Google Console → APIs & Services → OAuth 2.0 Client IDs:
      - Authorized JavaScript origins: `https://www.kingplapow.com`
      - Authorized redirect URIs: ตาม URL ของ `/api/auth/google/callback` ที่ backend ใช้
- [ ] `AUTH_BYPASS_GOOGLE` **ไม่ถูกตั้งค่า** ใน production env (ต้องว่าง/absent)

## Phase 1 — Migration 0007 (ยังไม่ drop อะไร)

- [ ] Pre-flight SQL รันแล้ว: `SELECT imported_by, count(*) FROM import_batches GROUP BY imported_by;`
      → ต้องคืน `imported_by = NULL` เท่านั้น (ถ้ามี value ให้หยุด ไปแก้ข้อมูลก่อน)
- [ ] รัน `0007_auth_staff_sessions.sql` (ผ่าน Supabase MCP / SQL editor)
- [ ] ตรวจ `students.email` เป็น NULL column (nullable) ไม่ใช่ NOT NULL
- [ ] ตรวจใหม่: `SELECT count(*) FROM requests;` → 0 (สำคัญก่อน 0008)

## Phase 2 — Seed + VERIFY GATE (ก่อน 0008 เสมอ)

- [ ] `cd packages/db && bun install` (ดึง `@node-rs/argon2`)
- [ ] รัน `bun run seed` โดยมี `SEED_ADMIN_PASSWORD` ใน env (ผ่าน `.env` ของ `packages/db` หรือ inline)
- [ ] รัน `bun run verify:admin` → output ต้องเป็น **`VERIFY GATE PASSED`** ทั้ง 4 เงื่อนไข
      1. `staff` row มี `weean2547@gmail.com`
      2. `password_hash` ไม่ NULL
      3. `hash_len >= 87` + prefix `$argon2id$`
      4. argon2 `verify(PASSWORD)` roundtrip = true
- [ ] ถ้า gate ไม่ผ่าน → **STOP** ห้ามรัน 0008 และห้าม deploy จนกว่าจะแก้

## Phase 3 — Migration 0008 + 0009

- [ ] รัน `0008_requests_student_fk.sql` แล้วตรวจ `\d requests` → FK `student_id → students(student_id)`
- [ ] รัน `0009_split_polymorphic_fks.sql` แล้วตรวจ:
      - `notifications` มี `student_id` + `staff_id` (ไม่มี `user_id`)
      - `audit_logs` มี `actor_student_id` + `actor_staff_id` (ไม่มี `actor_id`)
      - CHECK `notifications_recipient_check` + `audit_logs_actor_check` มีอยู่
- [ ] `bun run cleanup:sessions` (dry-run ก่อน แล้วรันจริง) → zero-error

## Phase 4 — Deploy โค้ด auth ใหม่ (งาน *after* deliverable ทั้ง 5)

- [ ] โค้ด auth ใหม่ (password สำหรับ staff/admin + Google สำหรับ student) deploy แล้ว
- [ ] ล็อกอิน `weean2547@gmail.com` ผ่าน `/api/auth/password` จริงบน production
- [ ] นั่งรอ **≥ 48–72 ชม.** โดยไม่มี error ใหม่ใน logs (postgres / edge)
- [ ] ลอง flow สำคัญบน live site: สร้างคำร้อง, approve, approve-with-attachment, deny

## Phase 5 — Migration 0010 (drop better-auth)

- [ ] `bun run cleanup:sessions` ก่อน drop
- [ ] รัน `0010_drop_better_auth.sql` แยกไฟล์ แยก PR แยก deploy **ห้ามรวมกับ 0007–0009**
- [ ] หลัง drop: ตรวจ `\dt` ไม่มี `users`, `accounts`, `verifications`, `better_auth_sessions`
- [ ] ล็อกอินซ้ำทั้ง student (Google) และ staff/admin (password) — ยังเข้าได้

## กติกาห้าม — MUST

- ❌ ห้ามรัน 0010 ในรอบเดียวกับ 0007–0009
- ❌ ห้าม deploy ถ้า VERIFY GATE ยังไม่ PASS
- ❌ ห้ามตั้ง `AUTH_BYPASS_GOOGLE=true` บน production
- ❌ ห้ามปล่อย `requests`/`notifications`/`audit_logs` มีข้อมูลค้างก่อน migration ที่แก้ FK
- ❌ ห้ามรัน destructive SQL โดยไม่ถาม user ก่อน (AGENTS.md)