# ข้อกำหนดระบบ (Source of Truth)

> เอกสารฉบับนี้เป็น **Source of Truth** ของ repo ระบบพิจารณาคำร้องขอฝึกประสบการณ์วิชาชีพ (Professional Experience Training Request Review System)
> การตัดสินใจ/การแก้ไขข้อกำหนดทุกครั้ง ต้องบันทึกไว้ที่นี่ก่อนลงมือ implement
> ระเบียบเรียงตามความสำคัญ: ข้อกำหนดบังคับ (MUST) > ข้อกำหนดควรทำ (SHOULD) > หมายเหตุการออกแบบ (Note)

---

## 1. บทบาทและการเข้าถึง (Roles)

### 1.1 บทบาท (MUST)
| บทบาท | วิธีล็อกอิน | ขอบเขตการทำงาน |
|---|---|---|
| **Student** | Google OAuth เท่านั้น (บังคับ `hd=psru.ac.th`) | ส่งคำร้อง + แนบหลักฐาน + ติดตามสถานะ |
| **Staff** | Staff Code + Password (Argon2) เท่านั้น | จัดการ Student Roster + **ดูคำร้องและไฟล์แนบแบบอ่านอย่างเดียว** + กด "ตรวจสอบเอกสารแล้ว" (ดูข้อ 8) — ห้ามตัดสินคำร้อง |
| **Admin** | Staff Code + Password (Argon2) เท่านั้น | จัดการ Request ทั้งหมด + สถิติ + บันทึก + กิจกรรม |

### 1.2 ข้อจำกัดสิทธิ์ (MUST)
- **Staff เข้าถึง Request ได้แบบอ่านอย่างเดียว** (แก้จากเดิมที่ห้ามทุกกรณี — ดู Decisions Log 2026-10-01):
  - อนุญาต: `GET /api/requests`, `GET /api/requests/:id`, `GET /api/attachments/:id/signed-url`, `POST /api/requests/:id/staff-check`
  - **ต้องคืน 403 เมื่อ role=staff**: `POST /api/requests/:id/approve`, `/reject`, `/request-revision`, `/resubmit`, และ endpoint แก้ไข/อัปโหลดอื่นของ request ทั้งหมด
  - `POST /api/requests/:id/staff-check` ต้องคืน 403 เมื่อ role=student หรือ admin (แยกบทบาทชัดเจน)
- **Student ห้ามเข้าถึง Roster API** — roster all endpoints ต้อง 403 เมื่อ role=student
- **แก้ `email` นักศึกษาผ่าน `PATCH /api/roster/students/:id` ได้เฉพาะ Admin** — staff ที่ส่งฟิลด์ `email` มาต้องได้ 403 `email_admin_only` (ฟิลด์อื่น staff แก้ได้เหมือนเดิม; email ที่ bind แล้วยังคง 409 `email_readonly_bound`) — ดู Decisions Log 2026-10-02 (audit P-4)
- **Upload ไฟล์ ได้เฉพาะ Student** — `POST /api/upload` ต้อง 403 เมื่อ role ไม่ใช่ student
- ~~`includeInactive` ของ activities~~ — ล้าสมัย: เอนทิตี Activities ถูกลบแล้ว (migration 0019, ยังไม่รันบน production — ดู `docs/DEPLOY-ROUND2.md`)
- นักศึกษาที่ `status != 'active'` (graduated/withdrawn) **ห้ามล็อกอินและห้ามมี session** — ต้องถูก block ทั้งตอน OAuth callback และตอน `getSession`

---

## 2. Workflow คำร้อง (Request State Machine)

### 2.1 สถานะ (MUST)
- `requests.status` ใช้ enum `request_status`: `pending` | `approved` | `rejected` | `revision_required`

### 2.2 State Machine (MUST)
```
pending
 ├─ admin approve          → approved (terminal)
 ├─ admin request revision → revision_required
 └─ admin reject           → rejected (terminal)

revision_required
 └─ student resubmit       → pending  (วนซ้ำจน admin ตัดสิน terminal)
```

- **approve รับเฉพาะ `pending`** — หลัง revision_required ต้องรอ student resubmit กลับมาเป็น pending ก่อน
- **reject รับเฉพาะ `pending`** — ไม่สามารถ reject จาก `revision_required` (สถานะนั้น ownership ของการกระทำอยู่ฝั่ง student)
- **request revision รับเฉพาะ `pending`** — admin ต้อง flag slot อย่างน้อย 1 slot ให้เป็น `needs_revision` **ต้องมีเหตุผล (`note`) เสมอ**: ตัดช่องว่างหัวท้าย ห้ามว่าง ยาวไม่เกิน 1000 ตัวอักษร (ไม่มี/ว่าง → 400 `note_required`, ยาวเกิน → 400 `note_too_long`)
- **resubmit รับเฉพาะ `revision_required`** — ต้องไม่มี required slot ใดที่ current revision ค้าง `needs_revision`; ผ่าน validation จึงเปลี่ยน request → `pending`

---

## 3. ไฟล์แนบ (File Attachments) — แบบ versioned

### 3.1 โครงสร้าง (MUST)
แยกเป็น 2 ตาราง:

| ตาราง | หน้าที่ |
|---|---|
| `request_attachments` | **slot holder** ต่อ (request_id, slot) — ระบุ slot 1/2 และ `current_revision_id` |
| `request_attachment_revisions` | **ทุกเวอร์ชันไฟล์** ต่อ slot — revision_number, storage_path, file_name, file_type, file_size, revision_state |

### 3.2 Slot (MUST)
- แทน slot เป็น smallint — **เฉพาะค่า 1 และ 2** สำหรับสร้าง/แก้ไขใหม่
- `slot >= 3` = **legacy data เท่านั้น** — แสดงผลได้ แต่ห้ามสร้าง/replace ผ่าน UI/API ใหม่
- **Slot 1 = เอกสารยืนยันการเข้าร่วม (required)** — ทุกคำร้องต้องมีอย่างน้อย 1 revision ใน slot 1
- **Slot 2 = เอกสารประกอบ (optional)**
- Amendment: ต้นฉบับระบุแค่ "2 ช่องแยกอิสระ" — ปรับเป็น required/optional ในรอบนี้

### 3.3 revision_state (MUST)
`request_attachment_revisions.revision_state` ใช้ enum `attachment_revision_state`:
`unchanged` | `needs_revision` | `resubmitted` | `approved`

> **ห้ามใช้ค่า `revision_required` ใน attachment state** — `revision_required` ใช้เฉพาะ `requests.status` เท่านั้น เพื่อไม่ให้สับสนในโค้ด

ความหมาย:
| ค่า | ความหมาย |
|---|---|
| `unchanged` | revision นี้ไม่ถูก flag (ปกติ) |
| `needs_revision` | admin flag ให้แก้ ต้อง replace ก่อน resubmit |
| `resubmitted` | student ส่งใหม่มาใน revision ล่าสุด ที่ถูก flag ไปก่อนหน้า |
| `approved` | ผ่านการอนุมัติแล้ว (terminal ต่อไฟล์) |

### 3.4 Revision History (MUST — ห้ามลบประวัติ)
- **ห้าม delete revision เก่าจาก DB** ทุกกรณี
- **ห้าม delete ไฟล์เก่าจาก Supabase Storage** ใน revision flow
- Student replace ไฟล์ใน slot = INSERT revision ใหม่ (revision_number = MAX+1) + อัปเดต `current_revision_id` — revision เก่ายังอยู่ครบ
- Admin ต้องเห็น revision history ทั้งหมดของแต่ละ slot (ทุก round)
- Retention policy ของไฟล์เก่า = future work (เก็บไว้ก่อน)

---

## 4. Authentication & Session

- Student: Google OAuth (hd=psru.ac.th) — email ต้องตรง `students.email`, status ต้อง active
- **First-login bind** (อีเมลที่ยังไม่อยู่ใน roster, ผ่าน `/api/auth/google/bind`): อีเมลนักศึกษา PSRU คือ `<รหัสนักศึกษา>@psru.ac.th` — ผูกได้เฉพาะเมื่อโดเมนของอีเมล = `psru.ac.th` (ตรวจเองไม่พึ่ง `hd`) และ local-part ตรงกับ `studentId` ที่กรอกทุกตัวอักษร (ไม่สนตัวพิมพ์เล็ก/ใหญ่และช่องว่างหัวท้าย) ไม่ตรง → 403 `email_student_mismatch` และนับเป็น failed attempt (สูงสุด 3 ครั้ง/bind session) บัญชี `@psru.ac.th` ที่ไม่ใช่รหัสนักศึกษา (อาจารย์/เจ้าหน้าที่) ผูกกับนักศึกษาไม่ได้ทุกกรณี; เช็กนี้ทำก่อนค้นนักศึกษา คำตอบจึงไม่บอกว่ารหัสนั้นมีใน roster หรือไม่
- Staff/Admin: staffCode+password → Argon2 (`verifyStaffByCode`) — password hash ใน `staff.password_hash`; staff email ไม่ใช่ identity ใน V1
- Session: custom cookie `ua_session`, TTL 7 วัน, polymorphic student/staff, lazy delete เมื่อหมดอายุ
- `oauthStates` (in-memory) ต้องมี eviction ของ state หมดอายุ

---

## 5. ทุกการกระทำสำคัญต้องทำใน DB transaction เดียว (MUST)

- **Admin approve**: (1) request → `approved` (2) current attachment revisions ที่เกี่ยวข้อง → `approved` — transaction เดียว
- **Admin request revision**: (1) flag slot → `needs_revision` (อย่างน้อย 1 slot) (2) request → `revision_required` — transaction เดียว (3) insert แถวใน `request_revision_notes` (note + slots + ผู้เขียน) — transaction เดียวกัน; หลัง commit แจ้งเตือนนักศึกษา "คำร้องต้องแก้ไขเอกสาร" พร้อมเหตุผล และส่งอีเมลแบบ best-effort เหมือน reject
- **Admin reject**: request → `rejected` — **ไม่แก้/ไม่ลบ attachment revisions**
- **Student resubmit**: ผ่าน validation → request → `pending` — transaction เดียว

---

## 6. Database Rules

- ทุกตารางใหม่ต้องเปิด RLS (ENABLE ROW LEVEL SECURITY) เสมอ (ตาม AGENTS.md)
- **ห้ามแก้ migration 0007–0009** (เคยรันกับ prod แล้ว) — schema changes รอบนี้ ใช้ migration 0012 สร้างใหม่
- Migration 0010 (drop better-auth tables) ยัง **deferred** แยก track — รอให้ auth ใหม่ stable บน production ≥48–72 ชม.
- destructive SQL ทุกชนิดต้องขอ confirm จากผู้ใช้ก่อน

---

## 8. การตรวจเอกสารโดย Staff (MUST)

- ตรวจได้เฉพาะคำร้องสถานะ `pending` (D5) — สถานะอื่นคืน 400; ตรวจซ้ำคืน 409
- เก็บใน `requests.staff_checked_at` (timestamptz null) และ `requests.staff_checked_by_id` (FK `staff.id`, null, on delete set null) — migration `0021` แบบ ADD COLUMN เท่านั้น (D2)
- **แยกจาก `reviewed_at` / `reviewed_by_id`** ซึ่งเป็นการตัดสินของ Admin และถูกล้างเมื่อ resubmit
- การตรวจ **ห้ามแตะ** `status`, `reviewed_at`, `reviewed_by_id`, counters, `revision_state` ของไฟล์แนบ
- ทำใน DB transaction เดียว + audit log action `staff_check` + notification ให้นักศึกษาเจ้าของคำร้อง ("เจ้าหน้าที่ตรวจสอบเอกสารแล้ว")
- Student resubmit → ล้าง `staff_checked_at/by_id` เป็น null ใน transaction เดิม (D3)
- การมองเห็น (D4): Student เห็นเวลาที่ตรวจ (ไม่จำเป็นต้องเห็นชื่อ Staff); Admin เห็น badge + ชื่อผู้ตรวจ + เวลา แยกชัดจากสถานะอนุมัติ
- Notification schema รองรับ `staff_id` อยู่แล้ว แต่ `notifyUser` ปัจจุบันส่งให้ student เท่านั้น — รอบนี้ไม่ต้องแจ้งเตือน Admin/Staff (Admin เห็นผ่าน badge)

## 9. นิยาม "ยื่นแล้ว / ยังไม่ยื่น" (MUST)

- **ยื่นแล้ว** = นักศึกษา `status='active'` และ `deleted_at is null` ที่มีคำร้อง ≥ 1 รายการ **ทุกสถานะ ทุกปี** นับเป็นคน (distinct `student_id`) ไม่นับคำร้อง
- **ยังไม่ยื่น** = นักศึกษา active (ไม่ถูก soft-delete) ที่เหลือ
- ใช้นิยามเดียวกันใน `/api/stats/submission`, `/api/roster/not-submitted`, `/api/roster/submitted` และกราฟ ผ่าน helper เดียว เพื่อเปลี่ยนเป็นนับรายปี (`request_year`) ได้ภายหลัง
- Admin และ Staff เห็นรายชื่อ/กราฟได้ (D7); Student ต้อง 403
- นักศึกษาที่ `group_name` เป็น null รวมเป็นกลุ่ม "ไม่ระบุกลุ่ม" ในกราฟ

## 10. กติกา PDF ใบรับรอง (MUST)

- เวลายื่นคำร้องอยู่ที่บรรทัด "วันที่......" **ในช่องผู้ตรวจสอบกิจกรรม** (ใต้ `(ว่าที่ร้อยตรีหญิง…)` เหนือ "เจ้าหน้าที่ฝ่ายพัฒนานักศึกษา") บรรทัดเดียว จัดกึ่งกลาง = `requests.submitted_at` (เวลายื่นครั้งแรก; resubmit ไม่เปลี่ยน) แปลงเป็น Asia/Bangkok ปี พ.ศ. รูปแบบ `วันที่ dd/mm/yyyy เวลา HH:mm น.` — **ห้ามใช้เวลาอนุมัติหรือ `new Date()`** (D8, ผู้กำหนดงานยืนยัน 2026-10-02)
- วันที่ด้านบน (วัน/เดือน/ปี) = `requests.reviewed_at` (Asia/Bangkok, พ.ศ.) — แยกจากเวลายื่น; ช่องนักศึกษาไม่มีบรรทัดเวลายื่นและเส้นประคั่นอยู่ตำแหน่งเดิมของแม่แบบ
- ช่อง "ชื่อ - สกุล" บนเส้นลายเซ็น **ปล่อยว่าง** ให้เขียนเอง; พิมพ์ `(ชื่อ นามสกุล)` ใต้เส้น จัดกึ่งกลาง ไม่มีคำนำหน้า (D9)
- ชื่อมาจาก `students.first_name` + `last_name` ของเจ้าของคำร้องเท่านั้น และตัดคำนำหน้า (นาย, นาง, นางสาว, น.ส., ด.ช., ด.ญ., Mr., Mrs., Ms., Miss) เฉพาะเมื่อเป็นคำนำหน้าจริง
- ฟังก์ชันสร้าง PDF ต้องรับ `submittedAt` จาก DB เสมอ ไม่มีค่า default เป็นเวลาปัจจุบัน

---

## 11. หมายเหตุการออกแบบ / Decisions Log (chronological)

| วันที่ | การตัดสินใจ |
|---|---|
| 2026-09-16 | Slot 1 = เอกสารยืนยัน (required), Slot 2 = เอกสารประกอบ (optional) |
| 2026-09-16 | approve/reject/request-revision เฉพาะ pending; revision_required = student-owned only |
| 2026-09-16 | แยก naming: `requests.status = revision_required` ต่างจาก `request_attachment_revisions.revision_state` |
| 2026-09-16 | Versioned attachment: เก็บ revision history ทั้งหมด ห้ามลบ ไฟล์เก่าใน Storage เก็บก่อน |
| 2026-09-16 | Staff = Roster management เท่านั้น; Admin = Request management เท่านั้น |
| 2026-09-16 | Upload transport: ใช้ `POST /api/upload` (server-side, ควบคุม MIME/size ที่เดียว) + register ผ่าน API |
| 2026-10-01 | **แก้ข้อ 1.1/1.2 (round 2, D1):** Staff ดูคำร้อง+ไฟล์แนบแบบอ่านอย่างเดียวได้ และกด "ตรวจสอบเอกสารแล้ว" ได้อย่างเดียว ห้าม approve/reject/request-revision/แก้ไข; Admin กด staff-check แทนไม่ได้ |
| 2026-10-01 | D2/D3/D5: เก็บการตรวจใน `requests.staff_checked_at/by_id` (migration 0021), ล้างเมื่อ resubmit, ตรวจได้เฉพาะ pending |
| 2026-10-01 | D4: Student เห็นแจ้งเตือน+เวลาตรวจ, Admin เห็น badge ผู้ตรวจ/เวลา |
| 2026-10-01 | D6/D7: "ยื่นแล้ว" = active ที่มีคำร้อง ≥1 (ทุกสถานะ/ทุกปี) นับคน ผ่าน helper เดียว; Admin+Staff เห็นรายชื่อ/กราฟ |
| 2026-10-02 | PDF แสดงเลขคำร้องไม่มีปี (ชื่อไฟล์แนบยังมีปี) — เปลี่ยนเฉพาะข้อความที่วาดมุมขวาบน ไม่เปลี่ยนการออกเลข/`request_year`/`requestNumberLabel` ที่หน้าเว็บ |
| 2026-10-02 | audit S-1/S-2/S-5: `reject` ใช้ `UPDATE … WHERE status='pending' RETURNING` (ไม่ได้แถว → 400 `already_reviewed`), เขียนเหตุผลลง `rejection_reason` เท่านั้น ไม่แตะ `note` ของนักศึกษา; audit/notification/email เป็น best-effort หลัง commit แบบเดียวกับ approve (ไม่ทำให้คำขอล้ม) — web อ่านเหตุผลจาก `rejectionReason` |
| 2026-10-02 | audit P-4: แก้ email นักศึกษาผ่าน roster PATCH ได้เฉพาะ admin (staff → 403 `email_admin_only`) |
| 2026-10-01 | D8/D9: PDF ใช้ `submitted_at` (ยื่นครั้งแรก) แทนเวลาอนุมัติ; ชื่อ `(ชื่อ นามสกุล)` ใต้เส้นลายเซ็น ไม่มีคำนำหน้า |
| 2026-10-02 | Audit P-1: bind flow ต้องให้ local-part ของอีเมล = รหัสนักศึกษา และโดเมน = psru.ac.th (ผู้กำหนดงานยืนยันรูปแบบ `<รหัส>@psru.ac.th`) — 403 `email_student_mismatch` |
| 2026-10-02 | ผู้กำหนดงานยืนยัน 2026-10-02: เวลายื่นอยู่บรรทัดวันที่ของช่องผู้ตรวจสอบ (ไม่ใช่ใต้ช่องนักศึกษา); วันที่ด้านบนมาจาก `reviewed_at`; ยกเลิกบรรทัด "ยื่นคำร้องเมื่อ" ใต้ลายเซ็นนักศึกษา และเส้นประกลับตำแหน่งเดิม (แก้ D8) |
| 2026-10-02 | Phase 6 review: staff-check เขียน audit log + notification ใน transaction เดียวกับการตั้ง `staff_checked_*` ตาม §8 (ต่างจาก approve/reject ที่เป็น best-effort หลัง commit); เปอร์เซ็นต์ในกราฟ/การ์ดไม่แสดง 100% ถ้ายังมีคนไม่ยื่น |
| 2026-10-03 | Follow-up (migration 0022): ตาราง `request_revision_notes` (request_id FK cascade, author_staff_id FK set null, note, slots smallint[], created_at timestamptz; index (request_id, created_at); RLS เปิด) เก็บเหตุผลทุกรอบที่ส่งกลับแก้ไข; `GET /api/requests/:id` ส่ง `revisionNotes` (ใหม่สุดก่อน) ให้นักศึกษาเจ้าของ/staff/admin — ชื่อผู้เขียนเห็นเฉพาะ staff/admin ฝั่งนักศึกษาแสดงเป็น "เจ้าหน้าที่"; รายการของนักศึกษามี `latestRevisionNote` เฉพาะคำร้องที่ถูกส่งกลับ; staff ยังเรียก request-revision ไม่ได้ (403) |
