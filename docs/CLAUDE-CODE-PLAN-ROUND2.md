# แผนงานรอบแก้ไข 6 ข้อ + Prompt สำหรับ Claude Code

> วิธีใช้: เปิด Claude Code ที่ root ของ repo แล้ววาง **Prompt ร่วม (ส่วน A)** ก่อน ตามด้วย Prompt ของ Phase ที่จะทำ
> ทำทีละ Phase จบแล้วตรวจผลเองก่อนเริ่ม Phase ถัดไป (แนะนำเปิด session ใหม่ต่อ Phase เพื่อไม่ให้ context ล้น)
> ถ้าค่าใน "การตัดสินใจ" (ส่วน B) ไม่ตรงกับที่ต้องการ ให้แก้ในไฟล์นี้ก่อนวาง prompt

---

## ข้อเท็จจริงจากโค้ดปัจจุบัน (สำรวจแล้ว)

- Stack: Bun + Elysia (`apps/api/src/app.ts`), SvelteKit + Tailwind (`apps/web`), Drizzle/Postgres (`packages/db`), PDF ด้วย pdf-lib (`apps/api/src/certificate.ts`)
- **`docs/REQUIREMENTS.md` ข้อ 1.1/1.2 ระบุว่า Staff ห้ามเข้าถึง Request API ทุกกรณี** และโค้ดคืน 403 จริง (`/api/requests`, `/api/requests/:id`, ไฟล์แนบ) → **ข้อ 1 ขัดกับ Requirement เดิม ต้องแก้ REQUIREMENTS ก่อน**
- `requests.reviewedAt` / `reviewedById` ถูกใช้เป็น "การตัดสินของ Admin" อยู่แล้ว และถูกล้างเป็น null ตอน resubmit → การตรวจของ Staff ต้องใช้คอลัมน์ใหม่แยก (ต้องมี migration `0021`)
- `requests.submittedAt` มีอยู่แล้ว และ resubmit **ไม่** เปลี่ยนค่านี้
- PDF ปัจจุบัน: วันที่ด้านล่าง (`reviewedDate`, y=61.44) ใช้ "เวลาอนุมัติ" (`new Date()`), ชื่อบนเส้น "ชื่อ-สกุล" (y=242.54) ระบบเติมให้เลย, `studentName = firstName || ' ' || lastName`
- PDF ถูกสร้างที่เดียวตอน approve (ประมาณบรรทัด 870–900 ของ app.ts) ยังไม่มี endpoint สร้างใหม่/ส่งอีเมลซ้ำ
- มี `GET /api/stats/submission` (นับยื่น/ไม่ยื่นต่อสาขา + รายชื่อกลุ่ม dynamic) และ `GET /api/roster/not-submitted` (รายชื่อคนยังไม่ยื่น มี filter major/group/search + pagination) อยู่แล้ว แต่ **ยังไม่มี endpoint รายชื่อคน "ยื่นแล้ว"**
- นิยาม "ยื่นแล้ว" ปัจจุบัน = นักศึกษา active + ไม่ถูก soft-delete ที่มีคำร้องอย่างน้อย 1 รายการ (ทุกสถานะ ทุกปี) ยังไม่มีแนวคิด "รอบการยื่น" ใน schema
- Web ยังไม่มีไลบรารีกราฟ
- กฎทดสอบ (AGENTS.md): ห้ามรัน `bun test` เปล่า ๆ ใช้ได้แค่ `bun run test:db-guard`, `bun run test:roster`, `bun run --cwd apps/api test:gate-smoke`, `bun run --cwd apps/api test:oauth-security` และ test DB ต้องเป็น `127.0.0.1:8520/ua_roster_test` เท่านั้น

---

## B. การตัดสินใจ (ค่าเริ่มต้นที่แนะนำ — แก้ได้ก่อนใช้)

| # | เรื่อง | ค่าที่ใช้ |
|---|---|---|
| D1 | ขอบเขตสิทธิ์ Staff ในข้อ 1 | Staff **ดูรายการคำร้องและไฟล์แนบได้แบบอ่านอย่างเดียว** และกด "ตรวจสอบเอกสารแล้ว" ได้อย่างเดียว ห้าม approve/reject/request-revision/แก้ไขใด ๆ |
| D2 | เก็บข้อมูลการตรวจของ Staff | คอลัมน์ใหม่ `requests.staff_checked_at` (timestamptz null) + `requests.staff_checked_by_id` (FK staff.id null) ผ่าน migration `0021` + audit log action `staff_check` |
| D3 | เมื่อ Student resubmit | ล้าง `staff_checked_*` เป็น null (เอกสารเปลี่ยน ต้องตรวจใหม่) |
| D4 | ใครเห็นการแจ้งเตือน "เจ้าหน้าที่ตรวจสอบเอกสารแล้ว" | Student (หน้ารายละเอียดคำร้อง + notification) และ Admin (badge ในรายการ/หน้ารายละเอียด) |
| D5 | ตรวจได้เฉพาะสถานะไหน | เฉพาะ `pending` |
| D6 | นิยาม "ยื่นแล้ว" | นักศึกษา `status='active'` และ `deleted_at is null` ที่มีคำร้อง ≥1 รายการ **ทุกสถานะ** (นับคนไม่นับคำร้อง) "ยังไม่ยื่น" = active ที่เหลือ — ใช้ทั้งระบบ เหมือนพฤติกรรมเดิม แต่รวมไว้ใน helper เดียวเพื่อเปลี่ยนเป็นรายปี (`request_year`) ได้ภายหลัง |
| D7 | ใครเห็นรายชื่อ/กราฟ | Admin และ Staff (ตาม endpoint stats/submission เดิม) |
| D8 | เวลาใน PDF | `requests.submitted_at` (เวลายื่นครั้งแรก resubmit ไม่เปลี่ยน) แปลงเป็น Asia/Bangkok ปี พ.ศ. รูปแบบ `วันที่ 12/10/2569 เวลา 23:00 น.` แทนที่วันที่ด้านล่างเดิม — วันที่ด้านบน (วัน/เดือน/ปี) คงเดิม |
| D9 | ชื่อใน PDF | เลิกเติมชื่อบนเส้น "ชื่อ-สกุล" (ปล่อยว่างให้เขียนเอง) แล้วพิมพ์ `(ชื่อ นามสกุล)` ใต้เส้น จัดกึ่งกลาง ไม่มีคำนำหน้า |
| D10 | กราฟ | เขียนเองด้วย Svelte + Tailwind (div/SVG) ไม่เพิ่ม dependency |
| D11 | Git | ทำบน branch `feat/round2-changes` commit แยกต่อ Phase ห้าม push ห้าม deploy |

---

## A. Prompt ร่วม (วางทุกครั้งที่เปิด session ใหม่)

```text
คุณกำลังทำงานใน repo ระบบ Student Activity Verification (Bun + Elysia API ที่ apps/api, SvelteKit ที่ apps/web, Drizzle ที่ packages/db)

ก่อนทำอะไร ให้อ่าน: AGENTS.md, docs/REQUIREMENTS.md และ docs/CLAUDE-CODE-PLAN-ROUND2.md (ส่วน "ข้อเท็จจริง" และ "การตัดสินใจ D1–D11") แล้วยึดตามนั้น

กฎเหล็ก:
1. ห้ามแตะ Production DB, ห้าม deploy, ห้าม push, ห้ามตั้ง ALLOW_REMOTE_DATABASE=1
2. ห้ามรัน `bun test` เปล่า ๆ ใช้ได้เฉพาะคำสั่งใน AGENTS.md และ `bun run --cwd apps/api test:gate-smoke` เท่านั้น ถ้าต้องเพิ่ม test ให้เพิ่มใน scripts ที่ถูกรันผ่าน apps/api/scripts/with-test-db.ts (ใช้ TEST_DATABASE_URL 127.0.0.1:8520/ua_roster_test) ห้ามสร้าง test ที่อาจไปต่อ DATABASE_URL
3. ห้ามเปลี่ยน state machine การอนุมัติ, ห้ามเปลี่ยนการออกเลขคำร้อง/เลขใบรับรอง (request_counters, certificate_counters)
4. ห้ามแก้ migration เก่า ถ้าต้องเปลี่ยน schema ให้สร้าง migration ใหม่เลขถัดไปเท่านั้น และอย่ารันกับ production
5. รักษาสิทธิ์ Student/Staff/Admin ตาม REQUIREMENTS.md ทุก endpoint ใหม่ต้องเช็ก role ฝั่ง server ไม่พึ่ง UI
6. ข้อความที่ผู้ใช้เห็นให้ใส่ผ่าน apps/web/src/lib/i18n.ts ตามแบบเดิม
7. ทำงานบน branch feat/round2-changes (สร้างถ้ายังไม่มี) commit เมื่อจบ Phase พร้อมข้อความ commit ที่บอกว่าทำข้อไหน
8. ถ้าเจอสิ่งที่ขัดกับการตัดสินใจ D1–D11 หรือ REQUIREMENTS ให้หยุดแล้วถามก่อน อย่าเดาเอง

จบงานทุก Phase ต้องรายงาน: ไฟล์ที่แก้, คำสั่งทดสอบที่รันและผลลัพธ์จริง, สิ่งที่ยังไม่ได้ตรวจ, ความเสี่ยงก่อน deploy
```

---

## Phase 0 — สำรวจ + อัปเดต Requirement (ยังไม่เขียนโค้ด)

```text
Phase 0: ยังไม่ต้องแก้โค้ดใด ๆ ยกเว้น docs/REQUIREMENTS.md

1. ยืนยันข้อเท็จจริงในส่วน "ข้อเท็จจริงจากโค้ดปัจจุบัน" ของ docs/CLAUDE-CODE-PLAN-ROUND2.md ว่ายังตรงกับโค้ดหรือไม่ ถ้าไม่ตรงให้รายงาน
2. ตรวจเพิ่ม:
   - students.first_name ใน DB dev/test และใน apps/api/src/roster.ts (import) มีคำนำหน้า (นาย/นาง/นางสาว/น.ส./Mr./Ms.) ปนอยู่หรือไม่ มีคอลัมน์ prefix แยกหรือไม่
   - หน้า web ไหนบ้างที่ Staff ใช้ และ layout/nav กรองเมนูตาม role อย่างไร
   - หน้า stats/admin ใช้ /api/stats/submission และ /api/roster/not-submitted ตรงไหน
   - ระบบแจ้งเตือน (notifications + notifyUser) รองรับ staffId/admin อย่างไร
3. แก้ docs/REQUIREMENTS.md:
   - ข้อ 1.1/1.2: เปลี่ยนสิทธิ์ Staff ตาม D1 (อ่านคำร้อง+ไฟล์แนบได้, กดตรวจสอบได้, ห้ามตัดสิน) ระบุ endpoint ที่ Staff ยังต้องได้ 403
   - เพิ่มหัวข้อ "การตรวจเอกสารโดย Staff" ตาม D2–D5
   - เพิ่มนิยาม "ยื่นแล้ว/ยังไม่ยื่น" ตาม D6
   - เพิ่มกติกา PDF ตาม D8–D9
   - เพิ่มแถวใน Decisions Log วันที่วันนี้
4. รายงานแผนไฟล์ที่จะต้องแก้ในแต่ละ Phase 1–5 แบบสั้น แล้วหยุดรอผมอนุมัติ
```

---

## Phase 1 — PDF (ข้อ 5 + ข้อ 6)

```text
Phase 1: ทำข้อ 5 และข้อ 6 ของงาน (PDF ใบรับรอง) ใน apps/api/src/certificate.ts และจุดเรียกใช้ใน apps/api/src/app.ts

ข้อ 5 — วันเวลาที่ยื่นคำร้อง:
- เพิ่มฟิลด์ใน CertificateData เช่น submittedAt: Date แทนการส่ง reviewedDate ที่คำนวณจาก new Date()
- ใน approve handler ให้ select requests.submitted_at มาจาก DB แล้วส่งเข้า PDF ห้ามใช้เวลาอนุมัติ/เวลาสร้าง PDF
- เขียนฟังก์ชัน formatSubmittedAtThai(d: Date) ที่แปลงเป็น Asia/Bangkok (ใช้ Intl แบบเดียวกับ thaiDateParts เดิม) ได้ผล "วันที่ 12/10/2569 เวลา 23:00 น." (วัน/เดือน 2 หลัก, ปี พ.ศ., 24 ชม.) ระวังกรณีเวลา UTC ข้ามวัน เช่น 2026-10-12T16:30Z ต้องเป็น 12/10 → 13/10/2569 เวลา 23:30 น.
- วาดข้อความนี้แทนที่วันที่ด้านล่างเดิม (ตำแหน่ง reviewedDate y≈61.44) ปรับ x/ความกว้างให้ไม่ทับเส้นและข้อความของ template — ถ้าข้อความยาวกว่าช่อง ให้ลดขนาด font อัตโนมัติ
- วันที่ด้านบน (dateDay/dateMonth/dateYear) คงพฤติกรรมเดิม
- ออกแบบให้ถ้าในอนาคตมีการสร้าง PDF ซ้ำ/ส่งอีเมลซ้ำ ฟังก์ชันจะรับ submittedAt จาก DB เสมอ (ไม่มี default เป็น now)

ข้อ 6 — ชื่อใต้ช่องลายเซ็น:
- เลิกวาดชื่อบนเส้น "ชื่อ - สกุล" (y≈242.54) ปล่อยว่างให้นักศึกษาเขียนเอง
- วาด "(ชื่อ นามสกุล)" บรรทัดใต้เส้นนั้น จัดกึ่งกลางใต้เส้น ไม่ทับเส้น/ข้อความเดิม ถ้าชื่อยาวเกินความกว้างเส้นให้ลด font size ลงทีละขั้นจนพอดี (ขั้นต่ำ ~12pt)
- ชื่อมาจาก students.first_name + last_name ของเจ้าของคำร้องเท่านั้น (ไม่ใช่ staff/admin) และตัดคำนำหน้าชื่อออก (นาย, นาง, นางสาว, น.ส., ด.ช., ด.ญ., Mr., Mrs., Ms., Miss) ด้วยฟังก์ชัน stripThaiNamePrefix ที่ตัดเฉพาะตอนเป็นคำนำหน้าจริง (ห้ามตัดชื่อที่บังเอิญขึ้นต้นด้วย "นาง" เช่น "นางนวล" — ต้องมีเงื่อนไขชัด เช่น prefix ตามด้วยช่องว่าง หรือเป็นรายการ exact ที่ตรวจตามผลสำรวจ Phase 0)
- ชื่อบรรทัด "ข้าพเจ้า" ด้านบนคงไว้ (แต่ใช้ชื่อที่ตัดคำนำหน้าแล้วให้สอดคล้องกัน — ถ้าเห็นว่าไม่ควร ให้ถามผมก่อน)

ตรวจสอบ:
- เขียนสคริปต์ apps/api/scripts/render-certificate-sample.ts ที่สร้าง PDF ตัวอย่างจากข้อมูลจำลอง (ไม่ต่อ DB) อย่างน้อย 3 เคส: ชื่อสั้น, ชื่อไทยยาวมาก (เช่น 45+ ตัวอักษร มีสระบน-ล่าง/วรรณยุกต์), เวลาข้ามวัน UTC → เขียนไฟล์ไปที่ tmp/ แล้วแปลงเป็น PNG (ใช้เครื่องมือที่มีในเครื่อง ถ้าไม่มีให้บอกผมเปิดดูเอง) แล้วตรวจด้วยตาว่าข้อความไม่ทับเส้น
- เพิ่ม unit test แบบไม่ต่อ DB สำหรับ formatSubmittedAtThai และ stripThaiNamePrefix ในไฟล์ที่รันได้โดยระบุ path ตรง เช่น `bun test apps/api/scripts/certificate-format.test.ts` (ไฟล์นี้ห้าม import app.ts หรือ @ua/db) และเพิ่ม script ใน apps/api/package.json ชื่อ test:certificate
- รัน bun run test:db-guard, bun run --cwd apps/api test:certificate และ bun run --cwd apps/api test:gate-smoke
- ทำให้ build ผ่าน: bun run --cwd apps/api build:check
```

---

## Phase 2 — Staff ตรวจเอกสาร + แจ้งเตือน (ข้อ 1)

```text
Phase 2: ทำข้อ 1 ตามการตัดสินใจ D1–D5 และ REQUIREMENTS ที่อัปเดตใน Phase 0

DB:
- เพิ่มใน packages/db/src/schema.ts: requests.staffCheckedAt (timestamp null), requests.staffCheckedById (text FK staff.id null, onDelete set null)
- สร้าง migration ใหม่ packages/db/drizzle/0021_staff_document_check.sql (เลขถัดจาก 0020) เป็น ALTER TABLE ADD COLUMN แบบ non-destructive เท่านั้น และอัปเดต meta/_journal ให้ถูก — ห้ามรันกับ production ให้รันกับ dev/test DB เท่านั้น

API (apps/api/src/app.ts):
- อนุญาต Staff เรียก GET /api/requests และ GET /api/requests/:id และดาวน์โหลดไฟล์แนบได้ (อ่านอย่างเดียว) — ส่งเฉพาะฟิลด์ที่จำเป็น
- เพิ่ม POST /api/requests/:id/staff-check: role ต้องเป็น staff (admin ใช้ไม่ได้ เพื่อแยกบทบาทชัด — ถ้าเห็นต่างให้ถาม), status ต้อง pending, ทำใน transaction: set staff_checked_at=now(), staff_checked_by_id=user.id; ถ้าตรวจแล้วอยู่แล้วให้คืน 409; เขียน audit log action "staff_check"; ส่ง notification ให้นักศึกษาเจ้าของคำร้อง title "เจ้าหน้าที่ตรวจสอบเอกสารแล้ว"
- ห้ามให้ endpoint นี้แตะ status, reviewed_at, reviewed_by_id, counters หรือ attachment revision_state
- endpoint approve / reject / request-revision ต้องยังคืน 403 ให้ Staff (เพิ่ม test ยืนยัน)
- resubmit: ล้าง staff_checked_at/by เป็น null ใน transaction เดิม (D3)
- ส่ง staffCheckedAt + ชื่อผู้ตรวจ (staff.full_name) ใน response รายการ/รายละเอียดสำหรับ admin, ส่ง staffCheckedAt ให้ student (ไม่จำเป็นต้องส่งชื่อ staff ให้ student)

Web:
- หน้า Staff: เพิ่มแท็บ/ส่วน "ตรวจเอกสารคำร้อง" แสดงรายการ pending + ดูไฟล์แนบ + ปุ่ม "ยืนยันตรวจสอบเอกสารแล้ว" (มี confirm dialog แบบ in-page ไม่ใช้ window.confirm) ไม่มีปุ่มอนุมัติ/ปฏิเสธใด ๆ
- หน้า Student: แสดงแถบแจ้งเตือนเด่นในคำร้องที่ตรวจแล้ว "เจ้าหน้าที่ตรวจสอบเอกสารแล้ว · วันที่ dd/mm/พ.ศ. เวลา HH:mm น." (Asia/Bangkok)
- หน้า Admin: badge "Staff ตรวจแล้ว" ในรายการ + รายละเอียดผู้ตรวจและเวลาในหน้ารายละเอียด แยกชัดจากสถานะอนุมัติของ Admin

ทดสอบ (ผ่าน with-test-db เท่านั้น เพิ่มเคสใน gate-smoke หรือสร้าง mode ใหม่ใน with-test-db.ts):
- staff check pending → 200 และฟิลด์ถูกตั้ง, status ไม่เปลี่ยน
- staff check ซ้ำ → 409; staff check คำร้องที่ไม่ใช่ pending → 400
- student/admin เรียก staff-check → 403
- staff เรียก approve/reject/request-revision → 403
- resubmit ล้าง staff check
- notification ถูกสร้างให้ student เจ้าของ
รัน test:db-guard, test:roster, test:gate-smoke, test:oauth-security และ build ของ web (svelte-check) ให้ผ่าน
```

---

## Phase 3 — คลิกดูรายชื่อ ยื่นแล้ว/ยังไม่ยื่น (ข้อ 3)

```text
Phase 3: ทำข้อ 3

API:
- สร้าง helper เดียว (เช่น submissionScope() ใน apps/api/src/) ที่นิยาม "ยื่นแล้ว" ตาม D6: นักศึกษา active + deleted_at is null ที่มีคำร้อง ≥1 รายการ (ทุกสถานะ) นับเป็นคน (distinct student_id) แล้วให้ /api/stats/submission, /api/roster/not-submitted และ endpoint ใหม่ใช้ helper นี้ร่วมกัน เพื่อให้ตัวเลขการ์ดตรงกับจำนวนรายชื่อเสมอ
- เพิ่ม GET /api/roster/submitted (admin + staff) โครงเดียวกับ not-submitted: filter major/group/search, pagination, คืน studentId, firstName, lastName, major, groupName, level และ "สถานะคำร้องล่าสุด" + วันที่ยื่นล่าสุด (เลือกคำร้องล่าสุดต่อคนด้วย DISTINCT ON หรือ window function เพื่อไม่ให้คนเดียวซ้ำหลายแถว)
- ถ้าเหมาะสม รวมเป็น endpoint เดียว /api/roster/submission-list?state=submitted|not_submitted ก็ได้ แต่ต้องคง /api/roster/not-submitted เดิมไว้ให้ไม่พังของเดิม

Web:
- ทำให้ตัวเลข "ยื่นแล้ว" และ "ยังไม่ยื่น" บน Dashboard/หน้า stats คลิกได้ (มี hover/cursor/aria ที่ชัด) เปิดหน้า/แผงรายชื่อ
- ตารางแสดง รหัส, ชื่อ-นามสกุล, สาขา, กลุ่ม, สถานะ (ยื่นแล้วแสดงสถานะคำร้องล่าสุดเป็น badge สี) มีช่องค้นหา (รหัส/ชื่อ), dropdown สาขา, dropdown กลุ่ม (ตามสาขาที่เลือก, dynamic), pagination
- บนมือถือให้ตารางเปลี่ยนเป็น card list

ทดสอบ (ผ่าน with-test-db):
- seed นักศึกษาหลายสาขา/กลุ่ม + บางคนมีหลายคำร้อง + คน inactive/soft-deleted ที่มีคำร้อง
- ตรวจว่า submitted + notSubmitted = total active, คนหลายคำร้องนับ 1, inactive/deleted ไม่ถูกนับ, จำนวนรายการจาก list endpoint = ตัวเลขจาก stats ทุก filter
- student เรียก → 403

เพิ่มเติม (ผู้ใช้สั่งจดไว้ 2026-10-02): /api/stats (byFaculty) ปัจจุบัน revision_required ไม่ถูกนับในช่องไหนเลย → เพิ่มฟิลด์ revisionRequired ทั้งระดับรวมและต่อสาขา แล้วแก้หน้า web ที่แสดงผลให้ผลรวมของสถานะตรงกับ total
```

---

## Phase 4 — กราฟแท่งแนวนอน สาขา → กลุ่ม → รายชื่อ (ข้อ 4)

```text
Phase 4: ทำข้อ 4 ต่อจาก Phase 3 (ใช้ helper นิยามเดียวกัน)

API:
- ขยาย /api/stats/submission (หรือเพิ่ม /api/stats/submission/by-group?major=...) ให้คืนต่อกลุ่มของสาขา: groupName, total, submitted, notSubmitted — กลุ่มต้องได้จากข้อมูลจริง (distinct group_name ของนักศึกษา active) ห้าม hard-code 1/2/3 เรียงลำดับแบบ natural sort (กลุ่ม 2 มาก่อน กลุ่ม 10)
- นักศึกษาที่ group_name เป็น null ให้รวมเป็นกลุ่ม "ไม่ระบุกลุ่ม" แทนการหายไปจากผลรวม
- สาขาที่แสดง = สาขาที่มีนักศึกษา active ในระบบ (ตรงกับข้อมูลทะเบียน)

Web (ไม่เพิ่ม dependency ใช้ Svelte + Tailwind):
- คอมโพเนนต์ HorizontalBarChart.svelte ใช้ซ้ำได้: label ซ้าย, แท่งแนวนอน, ตัวเลข "ยื่นแล้ว X / ทั้งหมด Y (Z%)" แสดงชัดบนหรือข้างแท่ง, แท่งเป็นปุ่มที่กดได้ด้วยคีย์บอร์ด (button + aria-label), รองรับจำนวนแท่งเท่าไรก็ได้
- ระดับ 1: แท่งต่อสาขา → คลิก → ระดับ 2: แท่งต่อกลุ่มของสาขานั้น → คลิก → ระดับ 3: รายชื่อนักศึกษาของกลุ่มนั้น (ใช้ตาราง/คอมโพเนนต์จาก Phase 3 พร้อม filter major+group ล่วงหน้า และสลับดู ยื่นแล้ว/ยังไม่ยื่น ได้)
- มี breadcrumb "ทุกสาขา › สาขา X › กลุ่ม Y" กดย้อนกลับได้ และเก็บ state ใน URL query (?major=&group=) เพื่อให้กด back ของเบราว์เซอร์ได้
- บนมือถือ label ยาวต้องตัดบรรทัด/ย่อแล้วยังอ่านได้ ไม่ล้นจอ
- สถานะ loading / empty / error ครบ

ทดสอบ:
- (with-test-db) สาขาที่มี 2 กลุ่ม, สาขาที่มี 5 กลุ่ม, สาขาที่มีคน group null → ผลรวมกลุ่ม = ผลรวมสาขา = ตัวเลขการ์ด
- เปิดหน้าจริงใน dev (ข้อมูล dev DB) แล้วคลิกครบ 3 ระดับ ตรวจตัวเลขเทียบกับ SQL query ตรงบน dev DB อย่างน้อย 1 สาขา
```

---

## Phase 5 — ปรับดีไซน์ + Responsive (ข้อ 2)

```text
Phase 5: ทำข้อ 2 (ทำหลังสุด เพื่อไม่ให้ diff ปนกับ logic)

ข้อห้าม: ห้ามเปลี่ยน logic, API call, เงื่อนไข role หรือ flow ใด ๆ — แก้เฉพาะ markup/class/style/คอมโพเนนต์ UI ถ้าจำเป็นต้องแตะ script ให้เป็นแค่การย้ายไปใช้คอมโพเนนต์ร่วม

1. ก่อนแก้ ถ่ายภาพหน้าจอ (Playwright) ทุกหน้า: /, /student, /staff, /admin, /stats, /roster, /profile, /auth/signin ที่ความกว้าง 375, 768, 1280 เก็บไว้ที่ tmp/screens/before/
2. กำหนด design tokens ใน apps/web/src/app.css (Tailwind v4 @theme): สีหลัก/สีรอง/สี neutral, สีสถานะ (pending=amber, revision_required=orange, approved=green, rejected=red, staff-checked=blue/teal), radius, shadow, ระยะห่าง และฟอนต์ไทยที่อ่านง่าย (เช่น Noto Sans Thai/IBM Plex Sans Thai) โทนเป็นทางการเหมาะกับมหาวิทยาลัย
3. สร้างคอมโพเนนต์ร่วมใน apps/web/src/lib/components/: Button, Card, StatCard (ตัวเลขเด่นบน Dashboard คลิกได้), StatusBadge (ใช้ทุกที่ที่แสดงสถานะ), PageHeader, EmptyState แล้วเปลี่ยนหน้าเดิมมาใช้
4. Dashboard แต่ละ role: ตัวเลขสำคัญอยู่บนสุดเป็น StatCard, สิ่งที่ต้องทำต่อ (เช่น คำร้อง pending, รายการต้องแก้ไข) เด่นกว่าข้อมูลรอง
5. Responsive: nav เป็น hamburger/drawer บนมือถือ, ตารางเปลี่ยนเป็น card บน < 640px, ปุ่ม/ช่องกดสูง ≥ 44px, ไม่มี horizontal scroll ทั้งหน้า
6. ความเข้าถึง: contrast ตัวอักษร ≥ 4.5:1, focus ring ชัด, ไอคอนที่ไม่มีข้อความมี aria-label
7. หลังแก้ ถ่ายภาพชุด after/ ที่ความกว้างเดิม แล้วสรุปเทียบ before/after รายหน้า

ตรวจ: svelte-check ผ่าน, build web ผ่าน, ไล่ใช้งานจริงใน dev ทุก role (login student ผ่าน AUTH_BYPASS ของ dev ถ้ามี, staff/admin ด้วยบัญชี seed) ว่าทุกปุ่ม/ฟังก์ชันเดิมทำงานเหมือนเดิม
```

---

## Phase 6 — ตรวจรวม + สรุปก่อน Deploy

```text
Phase 6: ไม่เพิ่มฟีเจอร์ ตรวจรวมทั้งหมดเท่านั้น

1. รันทุกคำสั่งทดสอบที่อนุญาต: test:db-guard, test:roster, test:gate-smoke, test:oauth-security, test:certificate, build:check (api), build + svelte-check (web) รายงานผลจริงทุกคำสั่ง
2. ไล่ checklist ใน dev ด้วย Playwright หรือมือ:
   - Student: ยื่นคำร้อง → เห็นแจ้งเตือน staff ตรวจแล้ว พร้อมวันเวลา
   - Staff: ดูคำร้อง/ไฟล์ได้, กดตรวจได้, ไม่มีปุ่มตัดสิน, เรียก API approve ตรง ๆ ได้ 403
   - Admin: เห็น badge staff ตรวจแล้ว, approve แล้ว PDF ที่แนบอีเมล (ใช้ mock) มีวันเวลายื่น + (ชื่อ) ใต้ลายเซ็นถูกต้อง
   - ตัวเลขการ์ด = จำนวนในรายชื่อ = ผลรวมกราฟ ทุกระดับ
   - ทุกหน้าที่ 375/768/1280 ไม่ล้นจอ
3. เขียน docs/DEPLOY-ROUND2.md: รายการไฟล์ที่แก้แยกตามข้อ, migration ที่ต้องรันบน production (0021) พร้อม SQL ตรงตัวและวิธี rollback, env ใหม่ (ถ้ามี), ลำดับ deploy (DB migration → API → Web), สิ่งที่ต้องตรวจหลัง deploy, ปัญหา/ข้อจำกัดที่เหลือ
4. ห้าม deploy ห้ามรัน migration บน production — รอผมอนุมัติ
5. (ผู้ใช้สั่งเพิ่ม 2026-10-02) DEPLOY-ROUND2.md ต้องระบุ **migration ทั้งหมดที่ยังไม่เคยรันบน production** ไม่ใช่แค่ 0021: ตรวจ 0016–0021 ทีละตัวว่ารันแล้ว/ยังไม่รัน จาก docs/PRODUCTION-RECONSTRUCTION-ROLLOUT.md และ DEPLOY-0012.md (อ่านอย่างเดียว ห้ามต่อ production) โดยเฉพาะ **0019 ที่ลบตาราง activities เป็น destructive ต้องขออนุมัติแยกต่างหาก** พร้อม SQL ตรงตัว วิธีตรวจก่อนรัน และแผนสำรองข้อมูล
6. (ผู้ใช้สั่งเพิ่ม 2026-10-02) เช็กลิสต์ก่อน deploy: **ยืนยัน timezone ของ production DB = UTC ก่อน deploy** (`reviewed_at`/`submitted_at` เป็น `timestamp` ไม่มี tz — โค้ดอ่านเป็น UTC แล้วแปลงเป็น Asia/Bangkok ตอนวาด PDF) ใน dev/test ตรวจแล้ว `SHOW timezone` = GMT (offset 0) ทั้ง ua_dev และ ua_roster_test; production ต้องตรวจเองแบบอ่านอย่างเดียวผ่านผู้ใช้ ห้ามต่อ production จาก local
```
