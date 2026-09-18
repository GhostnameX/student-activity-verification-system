# ข้อกำหนดระบบ (Source of Truth)

> เอกสารฉบับนี้เป็น **Source of Truth** ของ repo ระบบคำร้องขอตรวจสอบกิจกรรมนักศึกษา (University Student Activity Verification Request System)
> การตัดสินใจ/การแก้ไขข้อกำหนดทุกครั้ง ต้องบันทึกไว้ที่นี่ก่อนลงมือ implement
> ระเบียบเรียงตามความสำคัญ: ข้อกำหนดบังคับ (MUST) > ข้อกำหนดควรทำ (SHOULD) > หมายเหตุการออกแบบ (Note)

---

## 1. บทบาทและการเข้าถึง (Roles)

### 1.1 บทบาท (MUST)
| บทบาท | วิธีล็อกอิน | ขอบเขตการทำงาน |
|---|---|---|
| **Student** | Google OAuth เท่านั้น (บังคับ `hd=psru.ac.th`) | ส่งคำร้อง + แนบหลักฐาน + ติดตามสถานะ |
| **Staff** | Email + Password (Argon2) เท่านั้น | จัดการ Student Roster เท่านั้น — ห้ามแตะ Request |
| **Admin** | Email + Password (Argon2) เท่านั้น | จัดการ Request ทั้งหมด + สถิติ + บันทึก + กิจกรรม |

### 1.2 ข้อจำกัดสิทธิ์ (MUST)
- **Staff ห้ามเข้าถึง Request API ทุกกรณี** — `GET /api/requests`, `GET /api/requests/:id` ต้องคืน 403 เมื่อ role=staff
- **Student ห้ามเข้าถึง Roster API** — roster all endpoints ต้อง 403 เมื่อ role=student
- **Upload ไฟล์ ได้เฉพาะ Student** — `POST /api/upload` ต้อง 403 เมื่อ role ไม่ใช่ student
- **`includeInactive` ของ activities เฉพาะ Admin** — student/staff เห็นเฉพาะ activities ที่ active
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
- **request revision รับเฉพาะ `pending`** — admin ต้อง flag slot อย่างน้อย 1 slot ให้เป็น `needs_revision`
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
- Staff/Admin: email+password → Argon2 (`verifyStaffPassword`) — password hash ใน `staff.password_hash`
- Session: custom cookie `ua_session`, TTL 7 วัน, polymorphic student/staff, lazy delete เมื่อหมดอายุ
- `oauthStates` (in-memory) ต้องมี eviction ของ state หมดอายุ

---

## 5. ทุกการกระทำสำคัญต้องทำใน DB transaction เดียว (MUST)

- **Admin approve**: (1) request → `approved` (2) current attachment revisions ที่เกี่ยวข้อง → `approved` — transaction เดียว
- **Admin request revision**: (1) flag slot → `needs_revision` (อย่างน้อย 1 slot) (2) request → `revision_required` — transaction เดียว
- **Admin reject**: request → `rejected` — **ไม่แก้/ไม่ลบ attachment revisions**
- **Student resubmit**: ผ่าน validation → request → `pending` — transaction เดียว

---

## 6. Database Rules

- ทุกตารางใหม่ต้องเปิด RLS (ENABLE ROW LEVEL SECURITY) เสมอ (ตาม AGENTS.md)
- **ห้ามแก้ migration 0007–0009** (เคยรันกับ prod แล้ว) — schema changes รอบนี้ ใช้ migration 0012 สร้างใหม่
- Migration 0010 (drop better-auth tables) ยัง **deferred** แยก track — รอให้ auth ใหม่ stable บน production ≥48–72 ชม.
- destructive SQL ทุกชนิดต้องขอ confirm จากผู้ใช้ก่อน

---

## 7. หมายเหตุการออกแบบ / Decisions Log (chronological)

| วันที่ | การตัดสินใจ |
|---|---|
| 2026-09-16 | Slot 1 = เอกสารยืนยัน (required), Slot 2 = เอกสารประกอบ (optional) |
| 2026-09-16 | approve/reject/request-revision เฉพาะ pending; revision_required = student-owned only |
| 2026-09-16 | แยก naming: `requests.status = revision_required` ต่างจาก `request_attachment_revisions.revision_state` |
| 2026-09-16 | Versioned attachment: เก็บ revision history ทั้งหมด ห้ามลบ ไฟล์เก่าใน Storage เก็บก่อน |
| 2026-09-16 | Staff = Roster management เท่านั้น; Admin = Request management เท่านั้น |
| 2026-09-16 | Upload transport: ใช้ `POST /api/upload` (server-side, ควบคุม MIME/size ที่เดียว) + register ผ่าน API |