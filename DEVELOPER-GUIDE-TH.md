# คู่มือนักพัฒนา — ระบบคำร้องกิจกรรมนักศึกษา

> คู่มือฉบับสมบูรณ์สำหรับนักพัฒนาที่เข้ามาร่วมพัฒนาโปรเจคนี้ ครอบคลุมสถาปัตยกรรม การตั้งค่า ฐานข้อมูล API ส่วนหน้าเว็บ การ Deploy และงานทั่วไปที่ต้องทำบ่อย ๆ

---

## สารบัญ

1. [ภาพรวมโปรเจค](#1-ภาพรวมโปรเจค)
2. [เทคโนโลยีที่ใช้ (Tech Stack)](#2-เทคโนโลยีที่ใช้-tech-stack)
3. [สิ่งที่ต้องเตรียมก่อนเริ่ม](#3-สิ่งที่ต้องเตรียมก่อนเริ่ม)
4. [เริ่มต้นใช้งาน (Getting Started)](#4-เริ่มต้นใช้งาน-getting-started)
5. [สถาปัตยกรรม Monorepo](#5-สถาปัตยกรรม-monorepo)
6. [โครงสร้างฐานข้อมูล (Schema)](#6-โครงสร้างฐานข้อมูล-schema)
7. [การจัดการ Migrations](#7-การจัดการ-migrations)
8. [API Routes](#8-api-routes)
9. [หน้าเว็บและเส้นทาง (Frontend Routes)](#9-หน้าเว็บและเส้นทาง-frontend-routes)
10. [การยืนยันตัวตน (Authentication)](#10-การยืนยันตัวตน-authentication)
11. [การอัปโหลดไฟล์](#11-การอัปโหลดไฟล์)
12. [การสร้างใบรับรอง PDF](#12-การสร้างใบรับรอง-pdf)
13. [การส่งอีเมล (Resend)](#13-การส่งอีเมล-resend)
14. [การ Deploy](#14-การ-deploy)
15. [งานทั่วไปที่ต้องทำบ่อย](#15-งานทั่วไปที่ต้องทำบ่อย)
16. [ความปลอดภัย (Security)](#16-ความปลอดภัย-security)

---

## 1. ภาพรวมโปรเจค

**ระบบตรวจสอบการเข้าร่วมกิจกรรมนักศึกษา (Student Activity Verification System)** — เว็บแอปพลิเคชันสำหรับมหาวิทยาลัยไทย ใช้จัดการคำร้องขอเข้าร่วมกิจกรรมของนักศึกษา

### บทบาทผู้ใช้ (User Roles)

| บทบาท | รายละเอียด |
|-------|------------|
| **นักศึกษา (Student)** | ส่งคำร้องขอเข้าร่วมกิจกรรม พร้อมแนบภาพหลักฐาน |
| **เจ้าหน้าที่ (Staff)** | ตรวจสอบและอนุมัติ/ไม่อนุมัติคำร้อง, ออกใบรับรอง |
| **ผู้ดูแลระบบ (Admin)** | Dashboard ครบวงจร, ดูสถิติ, ตรวจสอบ audit log, จัดการกิจกรรม |

### Flow หลักของระบบ

```
นักศึกษาส่งคำร้อง → เจ้าหน้าที่ตรวจสอบ → อนุมัติ → สร้างใบรับรอง PDF → ส่งอีเมล
                                          → ไม่อนุมัติ → ส่งอีเมลแจ้งเหตุผล
```

### URL ของระบบจริง

- **เว็บ**: https://www.kingplapow.com (โฮสต์ที่ Vercel)
- **API**: https://ua-api-19x4.onrender.com (โฮสต์ที่ Render)
- **GitHub**: https://github.com/GhostnameX/student-activity-verification-system

---

## 2. เทคโนโลยีที่ใช้ (Tech Stack)

| ชั้น | เทคโนโลยี | เวอร์ชัน | ใช้ทำอะไร |
|-----|-----------|----------|-----------|
| **Monorepo** | Bun workspaces | 1.3+ | จัดการแพ็กเกจ + สคริปต์ |
| **Frontend** | SvelteKit | 2.63 | เฟรมเวิร์กเว็บ (SSR/CSR) |
| **UI Framework** | Svelte 5 | — | โหมด Runes (`$state`, `$derived`, `$effect`) |
| **CSS** | Tailwind CSS v4 | 4.3.3 | แต่งสไตล์ด้วยคลาส (ผ่าน `@tailwindcss/vite`) |
| **ไอคอน** | lucide-svelte | 1.0.1 | ไลบรารีไอคอน |
| **Backend** | ElysiaJS | 1.2.5 | REST API แบบ type-safe บน Bun |
| **Auth** | Better Auth | 1.6.26 (web) / 1.2.3 (api) | เข้าสู่ระบบ (email+password), session, บทบาท |
| **ORM** | Drizzle ORM | 0.38.3 | คิวรี PostgreSQL แบบ type-safe + migrations |
| **ฐานข้อมูล** | PostgreSQL | — | ผ่าน Supabase pooler (พอร์ต 6543) |
| **Storage** | Supabase Storage | — | Bucket: `request-attachments` |
| **PDF** | pdf-lib + fontkit | 1.17.1 | สร้างใบรับรองจาก template ภาษาไทย |
| **อีเมล** | Resend | — | อีเมลแจ้งเตือน + แนบไฟล์ PDF |
| **ตรวจสอบข้อมูล** | Zod | 3.24.1 | ตรวจสอบ request body (ฝั่ง API) |
| **Web Host** | Vercel | — | SvelteKit adapter-vercel |
| **API Host** | Render | — | Docker `oven/bun:1.3` |
| **Deploy สำรอง** | Fly.io | — | ภูมิภาคสิงคโปร์, shared-cpu-1x |
| **CI** | GitHub Actions | — | Gitleaks ตรวจหา secrets ในโค้ด |

---

## 3. สิ่งที่ต้องเตรียมก่อนเริ่ม

- [Bun](https://bun.sh/) เวอร์ชัน 1.3+ (ตรวจด้วย `bun --version`)
- [Node.js](https://nodejs.org/) เวอร์ชัน 18+ (สำหรับเครื่องมือที่ต้องพึ่ง Node)
- โปรเจค [Supabase](https://supabase.com/) (ฐานข้อมูล + storage)
- บัญชี [Vercel](https://vercel.com/) (สำหรับ deploy เว็บ)
- บัญชี [Render](https://render.com/) (สำหรับ deploy API)
- บัญชี [Resend](https://resend.com/) (สำหรับส่งอีเมล — ไม่บังคับ)

---

## 4. เริ่มต้นใช้งาน (Getting Started)

### 4.1 Clone และติดตั้ง

```bash
git clone https://github.com/GhostnameX/student-activity-verification-system.git
cd university-activity-requests
bun install
```

### 4.2 ตั้งค่า Environment Variables

คัดลอก `.env.example` ไปยังที่ต่าง ๆ 3 จุด:

```bash
cp .env.example .env                    # root (ค่าที่ใช้ร่วมกัน)
cp .env.example apps/api/.env           # API
cp .env.example packages/db/.env        # DB
cp .env.example apps/web/.env           # Web
```

กรอกค่าที่จำเป็น:

```env
# ฐานข้อมูล (Supabase pooler)
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres

# Better Auth
BETTER_AUTH_SECRET=<random-32-char-string>
BETTER_AUTH_URL=http://localhost:3000

# Supabase
PUBLIC_SUPABASE_URL=https://[project-ref].supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
PUBLIC_SUPABASE_ANON_KEY=eyJ...

# อีเมล (ไม่ใส่ = ปิดฟีเจอร์ส่งอีเมล)
RESEND_API_KEY=re_...
EMAIL_FROM=onboarding@resend.dev

# ใบรับรอง
CERTIFICATE_LOCATION=พิษณุโลก

# Frontend
PUBLIC_API_URL=http://localhost:3000
PUBLIC_APP_URL=http://localhost:5173
WEB_ORIGIN=http://localhost:5173

# API
API_PORT=3000
```

### 4.3 Seed ฐานข้อมูล

```bash
# Seed ผู้ใช้ทดสอบ + กิจกรรมตัวอย่าง
bun run --cwd packages/db seed

# Seed รายชื่อนักศึกษา 569 คน (optional — ต้องมีไฟล์ข้อมูลนักศึกษา)
bun run --cwd packages/db seed:students
```

### 4.4 รัน Development Server

เปิด **เทอร์มินัล 2 หน้าต่าง**:

```bash
# หน้าต่างที่ 1 — API server (พอร์ต 3000)
cd apps/api
bun run dev

# หน้าต่างที่ 2 — Web dev server (พอร์ต 5173)
cd apps/web
bun run dev
```

หรือรันจาก root:

```bash
bun run dev:api    # รัน API
bun run dev:web    # รัน web (ต้องแยกเทอร์มินัล)
```

### 4.5 บัญชีทดสอบ

| อีเมล | รหัสผ่าน | บทบาท |
|-------|----------|--------|
| `student@uni.ac.th` | `student123` | นักศึกษา |
| `staff@uni.ac.th` | `staff123` | เจ้าหน้าที่ |
| `admin@uni.ac.th` | `admin123` | ผู้ดูแลระบบ |
| `weean2547@gmail.com` | `test@123` | ผู้ดูแลระบบ (เจ้าของ) |

---

## 5. สถาปัตยกรรม Monorepo

```
university-activity-requests/
├── apps/
│   ├── api/                    # Elysia REST API (runtime: Bun)
│   │   ├── src/
│   │   │   ├── index.ts        # จุดเริ่มต้นโหมด standalone (Bun)
│   │   │   ├── index.vercel.ts # จุดเริ่มต้นสำหรับ Vercel serverless
│   │   │   ├── app.ts          # ALL routes (~1,200 บรรทัด)
│   │   │   ├── auth.ts         # ตั้งค่า Better Auth
│   │   │   └── certificate.ts  # สร้างใบรับรอง PDF
│   │   └── assets/
│   │       ├── forms/          # Template PDF
│   │       └── fonts/          # ฟอนต์ TH Sarabun New
│   │
│   └── web/                    # SvelteKit frontend
│       ├── src/
│       │   ├── routes/         # หน้าเว็บทั้งหมด (ปิด SSR)
│       │   ├── lib/
│       │   │   ├── api.ts      # API client + TypeScript types
│       │   │   ├── auth.ts     # store สถานะการล็อกอิน
│       │   │   ├── auth-client.ts # Better Auth client ฝั่งเบราว์เซอร์
│       │   │   ├── i18n.ts     # คำแปล ไทย/อังกฤษ
│       │   │   ├── store.ts    # store ภาษา + โหมดมืด
│       │   │   ├── supabase.ts # wrapper อัปโหลดไฟล์
│       │   │   └── components/ # คอมโพเนนต์ที่ใช้ซ้ำ
│       │   ├── app.css         # ตั้งค่า theme Tailwind v4
│       │   └── app.html        # HTML หลัก (Google Fonts)
│       └── vercel.json         # Proxy /api/* → Render
│
├── packages/
│   └── db/                     # แพ็กเกจฐานข้อมูลที่ใช้ร่วมกัน
│       ├── src/
│       │   ├── schema.ts       # นิยามตารางทั้งหมด (11 ตาราง)
│       │   ├── client.ts       # Drizzle + pg Pool
│       │   ├── seed.ts         # ผู้ใช้ทดสอบ + กิจกรรมตัวอย่าง
│       │   └── seed-students-2567.ts
│       ├── drizzle/            # ไฟล์ SQL ของ migrations
│       └── drizzle.config.ts   # ตั้งค่า Drizzle Kit
│
├── docs/                       # เอกสารโปรเจค
├── Dockerfile                  # คอนเทนเนอร์ API (oven/bun:1.3)
├── fly.toml                    # ตั้งค่า Fly.io
├── render.yaml                 # ตั้งค่า Render
└── package.json                # config workspace
```

### ความสัมพันธ์หลักระหว่างตาราง

```
┌─────────┐     ┌──────────┐     ┌────────────┐
│  users   │────<│ requests │>────│ activities │
└─────────┘     └──────────┘     └────────────┘
     │               │
     │               ├────< request_attachments
     │               ├────< notifications
     │               └────< audit_logs
     │
     ├────< sessions (Better Auth)
     ├────< accounts (Better Auth)
     └────< students (roster แยกจาก auth users)
```

---

## 6. โครงสร้างฐานข้อมูล (Schema)

ตารางทั้งหมดนิยามไว้ใน `packages/db/src/schema.ts`

### Enums

```typescript
role: 'student' | 'staff' | 'admin'
request_status: 'pending' | 'approved' | 'rejected'
notification_type: 'request_status_change'
student_status: 'active' | 'graduated' | 'withdrawn'
```

### ตาราง

#### ตารางธุรกิจหลัก

| ตาราง | PK | ใช้ทำอะไร |
|-------|-----|-----------|
| `users` | `id` (UUID) | ผู้ใช้ทุกคน — ชื่อ, อีเมล, บทบาท, คณะ, รหัสนักศึกษา, เบอร์โทร |
| `activities` | `id` (UUID) | กิจกรรมของมหาวิทยาลัย — ชื่อ, ประเภท, วันเวลา, สถานะเปิด/ปิด |
| `requests` | `id` (UUID) | คำร้องขอเข้าร่วม — สถานะ, หมายเหตุ, ข้อมูลใบรับรอง |
| `request_attachments` | `id` (UUID) | ไฟล์หลักฐานที่แนบกับคำร้อง |
| `certificate_counters` | `year` (int) | เลขที่ใบรับรองล่าสุดแยกตามปีพุทธศักราช |

#### ตารางระบบ

| ตาราง | PK | ใช้ทำอะไร |
|-------|-----|-----------|
| `sessions` | `id` | token ของ session (Better Auth) |
| `accounts` | `id` | เก็บข้อมูล credential (Better Auth) |
| `verifications` | `id` | token ยืนยันอีเมล (Better Auth) |
| `notifications` | `id` | การแจ้งเตือนในระบบ |
| `audit_logs` | `id` | ประวัติการทำงานทั้งหมด (สำหรับ admin) |

#### ตารางรายชื่อนักศึกษา

| ตาราง | PK | ใช้ทำอะไร |
|-------|-----|-----------|
| `students` | `student_id` | รายชื่อนักศึกษาที่ import เข้าระบบ (ข้อมูลส่วนบุคคล) |
| `import_batches` | `id` | บันทึกการ bulk import แต่ละครั้ง |

### ความสัมพันธ์สำคัญ

- `requests.studentId` → `users.id` (ใครเป็นผู้ส่ง)
- `requests.activityId` → `activities.id` (กิจกรรมไหน)
- `requests.reviewedById` → `users.id` (ใครอนุมัติ/ไม่อนุมัติ)
- `request_attachments.requestId` → `requests.id` (ลบแบบ cascade)
- `notifications.userId` → `users.id` (ลบแบบ cascade)
- `students.major` + `students.groupName` → ใช้คำนวณสถิติแบบกลุ่ม

### Indexes

```sql
-- Index เพื่อประสิทธิภาพ
users: email (unique), role
activities: date
requests: studentId, status, activityId
requests: (certificate_year, certificate_number) UNIQUE PARTIAL
request_attachments: requestId
notifications: userId, (userId + readAt)
audit_logs: actorId, (targetType + targetId), createdAt
students: major, status
```

---

## 7. การจัดการ Migrations

### เทคโนโลยี

- **Drizzle Kit** จัดการ migrations ในโฟลเดอร์ `packages/db/drizzle/`
- ไฟล์ migration เป็น SQL ที่ถูกสร้างอัตโนมัติ
- อาจต้องแก้ไฟล์ SQL ด้วยมือสำหรับงานซับซ้อน (เช่น การแปลงชนิดข้อมูล)

### สร้าง Migration

```bash
# 1. แก้ไข packages/db/src/schema.ts ตามที่ต้องการ

# 2. สร้างไฟล์ migration
cd packages/db
npx drizzle-kit generate

# 3. ตรวจสอบ SQL ที่สร้างใน drizzle/NNNN_*.sql

# 4. Apply ลงฐานข้อมูล
bun run migrate
# หรือรันด้วยมือผ่าน Supabase SQL Editor / เครื่องมือ MCP
```

### Apply Migration ขึ้น Production

```bash
# ผ่าน Supabase MCP (แนะนำ)
# ใช้เครื่องมือ supabase_apply_migration แล้ววางเนื้อหา SQL

# ผ่าน Dashboard ของ Supabase
# SQL Editor → วาง SQL → Run

# ผ่าน psql ตรง ๆ
psql $DATABASE_URL -f drizzle/NNNN_*.sql
```

### กฎสำคัญ

- **ทุกตารางใหม่ต้องเปิด RLS**: `ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;`
- **ทดสอบ migration ในเครื่องก่อน**เสมอ ก่อน apply ขึ้น production
- **สำรองข้อมูล production** ก่อน migration ที่อาจทำข้อมูลหาย
- **ห้ามรัน SQL แบบลบข้อมูล** (DROP, DELETE, TRUNCATE) โดยไม่ได้รับยืนยันจากผู้ใช้ก่อน

---

## 8. API Routes

Route ทั้งหมดอยู่ใน `apps/api/src/app.ts` ส่วน `/api/auth/*` จัดการโดย Better Auth ให้อัตโนมัติ

### Route สาธารณะ (ไม่ต้องล็อกอิน)

| Method | Path | รายละเอียด |
|--------|------|------------|
| `GET` | `/health` | ตรวจสอบสถานะเซิร์ฟเวอร์ |
| `GET` | `/api/activities` | รายชื่อกิจกรรมที่เปิดรับ (`?includeInactive=true` เพื่อดูทั้งหมด) |

### Route ที่ต้องล็อกอิน

| Method | Path | บทบาท | รายละเอียด |
|--------|------|--------|------------|
| `POST` | `/api/upload` | ทุกบทบาท | อัปโหลดไฟล์เข้าระบบ Supabase Storage |
| `GET` | `/api/requests` | ทุกบทบาท | รายการคำร้อง (กรองตามบทบาท) |
| `GET` | `/api/requests/:id` | ทุกบทบาท | ดูคำร้องเดียว พร้อมไฟล์แนบ |
| `POST` | `/api/requests` | นักศึกษา | ส่งคำร้องใหม่ |
| `PATCH` | `/api/requests/:id` | เจ้าของ | แก้ไขคำร้องที่ยังรออนุมัติ |
| `POST` | `/api/requests/:id/approve` | เจ้าหน้าที่/Admin | อนุมัติ + สร้างใบรับรอง + ส่งอีเมล |
| `POST` | `/api/requests/:id/reject` | เจ้าหน้าที่/Admin | ไม่อนุมัติ พร้อมเหตุผล + ส่งอีเมล |
| `GET` | `/api/me` | ทุกบทบาท | ดูโปรไฟล์ตัวเอง |
| `PATCH` | `/api/me` | ทุกบทบาท | แก้ไขเบอร์โทรศัพท์ |
| `GET` | `/api/notifications` | ทุกบทบาท | รายการแจ้งเตือนของตัวเอง |
| `POST` | `/api/notifications/:id/read` | ทุกบทบาท | ทำเครื่องหมายอ่านแล้ว |
| `POST` | `/api/notifications/read-all` | ทุกบทบาท | อ่านแล้วทั้งหมด |

### Route เฉพาะ Admin

| Method | Path | บทบาท | รายละเอียด |
|--------|------|--------|------------|
| `POST` | `/api/activities` | Admin | สร้างกิจกรรม |
| `PATCH` | `/api/activities/:id` | Admin | แก้ไขกิจกรรม |
| `DELETE` | `/api/activities/:id` | Admin | ปิดกิจกรรม (soft-delete → `isActive=false`) |
| `GET` | `/api/audit` | Admin | ประวัติการทำงาน (200 รายการล่าสุด) |
| `GET` | `/api/stats` | Admin | สถิติแยกตามกิจกรรม + คณะ |
| `GET` | `/api/stats/submission` | เจ้าหน้าที่/Admin | อัตราการยื่นคำร้องแยกรายสาขา (SQL aggregate) |
| `GET` | `/api/roster/not-submitted` | เจ้าหน้าที่/Admin | รายชื่อนักศึกษาที่ยังไม่ยื่น (แบ่งหน้า) |

### ตัวอย่าง Request/Response

#### ส่งคำร้อง

```bash
POST /api/requests
Content-Type: application/json
Cookie: ua_session=<token>

{
  "activityId": "uuid-of-activity",
  "note": "เข้าร่วมกิจกรรม sports day",
  "attachmentIds": ["uuid-of-uploaded-file"]
}
```

#### อนุมัติคำร้อง

```bash
POST /api/requests/:id/approve
Content-Type: application/json
Cookie: ua_session=<token>

{
  "activityName": "กิจกรรมกีฬาสีชิงถ้วยพระราชทาน"
}
```

**ผลลัพธ์**: ระบบเพิ่มเลขที่ใบรับรองแบบ atomic → สร้าง PDF → ส่งอีเมล

#### ดูสถิติการยื่นคำร้อง

```bash
GET /api/stats/submission
Cookie: ua_session=<token>
```

**Response**:
```json
{
  "total": 569,
  "submitted": 120,
  "notSubmitted": 449,
  "rate": 21.1,
  "byMajor": [
    { "major": "การจัดการ", "total": 80, "submitted": 15, "rate": 18.8 }
  ],
  "groups": ["กลุ่ม 1", "กลุ่ม 2"]
}
```

---

## 9. หน้าเว็บและเส้นทาง (Frontend Routes)

ทุกหน้าตั้งค่า `export const ssr = false` (เรนเดอร์ฝั่ง client ล้วน)

| Route | หน้า | ผู้เข้าถึง | รายละเอียด |
|-------|------|------------|------------|
| `/` | หน้าแรก | สาธารณะ | Feature cards (ยังไม่ล็อกอิน) / ปุ่มไปต่อตามบทบาท (ล็อกอินแล้ว) |
| `/auth/signin` | เข้าสู่ระบบ/สมัครสมาชิก | ผู้เยี่ยมชม | การ์ดสลับแบบ animated ระหว่าง login และ signup |
| `/auth/signup` | เปลี่ยนเส้นทาง | ผู้เยี่ยมชม | 307 redirect ไป `/auth/signin?mode=signup` |
| `/auth/signout` | ออกจากระบบ | ล็อกอินแล้ว | ล้าง session + กลับไป `/` |
| `/student` | หน้านักศึกษา | นักศึกษา | ฟอร์มส่งคำร้อง + รายการคำร้องของตัวเอง |
| `/staff` | หน้าเจ้าหน้าที่ | เจ้าหน้าที่/Admin | ตารางคำร้องทั้งหมด + modal อนุมัติ/ไม่อนุมัติ |
| `/stats` | หน้าสถิติ | เจ้าหน้าที่/Admin | การ์ดข้อมูล + ตารางรายสาขา + modal รายชื่อนักศึกษา |
| `/admin` | หน้า Admin | Admin | สถิติ + audit log + คำร้องทั้งหมด |
| `/profile` | หน้าโปรไฟล์ | ล็อกอินแล้ว | ดูข้อมูล + แก้ไขเบอร์โทร |

### Layout (`+layout.svelte`)

Layout หลักให้ส่วนประกอบเหล่านี้:

- **Header ติดด้านบน** — โลโก้, แถบเมนูตามบทบาท, กระดิ่งแจ้งเตือน, ปุ่มสลับภาษา, ปุ่มโหมดมืด, ข้อมูลผู้ใช้ + ออกจากระบบ
- **Dropdown แจ้งเตือน** — แสดงจำนวนที่ยังไม่อ่าน + ปุ่มอ่านแล้ว
- **Footer** — ชื่อเว็บ + ปี

### ไฟล์สำคัญฝั่ง Frontend

| ไฟล์ | ที่อยู่ | ใช้ทำอะไร |
|------|--------|-----------|
| `api.ts` | `apps/web/src/lib/api.ts` | ฟังก์ชัน fetch ทั้งหมด + TypeScript interfaces |
| `auth.ts` | `apps/web/src/lib/auth.ts` | store สถานะผู้ใช้ + `loadSession()` |
| `auth-client.ts` | `apps/web/src/lib/auth-client.ts` | Better Auth client ฝั่งเบราว์เซอร์ |
| `i18n.ts` | `apps/web/src/lib/i18n.ts` | คำแปล ไทย/อังกฤษ ~130 keys |
| `store.ts` | `apps/web/src/lib/store.ts` | store ภาษา + โหมดมืด (บันทึกใน localStorage) |
| `supabase.ts` | `apps/web/src/lib/supabase.ts` | wrapper อัปโหลด (เรียก API `/api/upload`) |
| `SuccessCheck.svelte` | `apps/web/src/lib/components/` | หน้าต่างแสดงความสำเร็จแบบ animated (CSS ล้วน) |

---

## 10. การยืนยันตัวตน (Authentication)

### การตั้งค่า Better Auth

- **ฝั่งเซิร์ฟเวอร์**: `apps/api/src/auth.ts`
- **ฝั่ง client**: `apps/web/src/lib/auth-client.ts`
- **Adapter**: Drizzle (PostgreSQL)
- **วิธี session**: เก็บ session ในฐานข้อมูล + ใช้ cookie
- **Prefix ของ cookie**: `ua`
- **อายุ session**: 7 วัน
- **อายุ update**: 1 วัน (refresh หากมีการใช้งาน)

### ระบบบทบาท (Role System)

บทบาทเก็บใน `users.role` และแนบไปกับ session ผู้ใช้ โดยประกาศใน `user.additionalFields`:

```typescript
// ใน auth config
user: {
  additionalFields: {
    role: { type: 'string', input: false },      // 'student' | 'staff' | 'admin'
    faculty: { type: 'string', input: false },
    studentId: { type: 'string', input: false },
    phone: { type: 'string', input: false }
  }
}
```

บทบาทกำหนดโดย **admin** (แก้ผ่าน DB โดยตรง) — ไม่มีระบบสมัครด้วยตัวเอง

### Rate Limiting

เปิดใช้ผ่าน `better-auth/rateLimit` เก็บในหน่วยความจำ:

| Endpoint | ขีดจำกัด |
|----------|----------|
| ทั้งระบบ | 20 คำขอ / 60 วินาที |
| เข้าสู่ระบบ | 5 ครั้ง / 60 วินาที |
| สมัครสมาชิก | 10 ครั้ง / 3600 วินาที |
| ลืมรหัสผ่าน | 5 ครั้ง / 300 วินาที |

### Trusted Origins

ต้องตั้งค่า `trustedOrigins` ของ Better Auth ใน **ระดับบนสุด** ของ config (ไม่ใช่ภายใต้ `advanced`) ซึ่งควบคุม CORS สำหรับการล็อกอินข้าม origin

---

## 11. การอัปโหลดไฟล์

```
Client                  API Server               Supabase Storage
  │                        │                          │
  ├─ POST /api/upload ────>│                          │
  │  (multipart form data) │                          │
  │                        ├─ อ่าน buffer ไฟล์        │
  │                        ├─ สร้าง storagePath        │
  │                        ├─ อัปโหลดด้วย service role ─>│
  │                        │                          │
  │                        │<─── คืน path ────────────┤
  │<─── คืน storagePath ───│                          │
  │                        │                          │
  ├─ POST /api/requests ──>│                          │
  │  { attachmentIds: [storagePath] }                 │
  │                        ├─ Insert แถว request_attachments
```

### ประเด็นสำคัญ

- การอัปโหลดผ่าน **API server** ด้วย service role key (bypass RLS)
- Client **ไม่เคย**ได้ key ตรง ๆ เพื่อเข้าถึง Supabase Storage
- ไฟล์เก็บใน bucket: `request-attachments`
- รูปแบบ storagePath: `{userId}/{timestamp}-{filename}`

---

## 12. การสร้างใบรับรอง PDF

### ตำแหน่งไฟล์

`apps/api/src/certificate.ts`

### วิธีการทำงาน

1. โหลด template PDF จาก `apps/api/assets/forms/activity-request-form.pdf`
2. ฝังฟอนต์ TH Sarabun New (ปกติ + ตัวหนา) จาก `apps/api/assets/fonts/`
3. เติมข้อความลงในตำแหน่งที่กำหนดบน template
4. คืนค่า buffer ของ PDF

### เลขที่ใบรับรอง (Atomic)

ใช้ตาราง `certificate_counters` พร้อม Row-Level Lock:

```sql
-- เพิ่มเลขแบบ atomic แยกตามปีพุทธศักราช
INSERT INTO certificate_counters (year, last_number)
VALUES (2569, 0)
ON CONFLICT (year) DO NOTHING;

UPDATE certificate_counters
SET last_number = last_number + 1
WHERE year = 2569
RETURNING last_number;
```

ป้องกัน race condition เมื่อมีการอนุมัติพร้อมกันหลายรายการ

### Flow การอนุมัติ

```
1. BEGIN TRANSACTION
2.   UPDATE requests SET status='approved' WHERE id=? AND status='pending' (กัน TOCTOU)
3.   เพิ่มเลขที่ใบรับรอง (row lock แบบ atomic)
4.   UPDATE requests SET certificate_number=?, certificate_year=?
5. COMMIT
6. สร้าง PDF (นอก transaction)
7. ส่งอีเมลแนบ PDF (นอก transaction, ข้ามถ้าไม่มี API key)
```

### ข้อกำหนดฟอนต์

- **THSarabunNew.ttf** — น้ำหนักปกติ (ฟอนต์ภาษาไทยสัญชาติ SIPA)
- **THSarabunNew-Bold.ttf** — น้ำหนักหนา

---

## 13. การส่งอีเมล (Resend)

### การตั้งค่า

```env
RESEND_API_KEY=re_...
EMAIL_FROM=onboarding@resend.dev    # ต้องเป็น sender ที่ยืนยันแล้ว
```

### ใช้เมื่อไหร่

- ส่งเมื่อ **อนุมัติ** และ **ไม่อนุมัติ**
- แนบไฟล์ PDF เมื่ออนุมัติ
- ข้ามเงียบ ๆ หากไม่ตั้งค่า `RESEND_API_KEY`

### Template อีเมล

จัดการ inline ใน `apps/api/src/app.ts` ใน route อนุมัติ/ไม่อนุมัติ — ไม่มีไฟล์ template แยก

---

## 14. การ Deploy

### สถาปัตยกรรม

```
                    ┌─────────────────┐
                    │  Vercel (Web)    │
                    │  SvelteKit       │
                    │  adapter-vercel  │
                    └────────┬────────┘
                             │ vercel.json rewrites
                             │ /api/* → Render
                             v
                    ┌─────────────────┐
                    │  Render (API)    │
                    │  Docker/Bun      │
                    │  ElysiaJS :3000  │
                    └────────┬────────┘
                             │
                             v
                    ┌─────────────────┐
                    │  Supabase        │
                    │  PostgreSQL +    │
                    │  Storage         │
                    └─────────────────┘
```

### เว็บ (Vercel)

- Framework: SvelteKit ด้วย `adapter-vercel`
- Build command: `bun run build:web`
- `vercel.json` rewrite `/api/*` ไปยัง URL ของ Render API

### API (Render)

- Docker image: `oven/bun:1.3`
- Start command: `bun run dist/index.js`
- `render.yaml` กำหนดค่า service

### API (Fly.io — ทางเลือก)

- Config: `fly.toml`
- ภูมิภาค: สิงคโปร์ (sin)
- Plan: shared-cpu-1x, RAM 512MB

### Environment Variables ใน Production

**Vercel** (web):
- `PUBLIC_API_URL` = `''` (ว่าง — ใช้ URL relative ผ่าน proxy)
- `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`

**Render** (API):
- env vars ฝั่ง API ทั้งหมดตาม `.env.example`
- `WEB_ORIGIN` = `https://www.kingplapow.com`
- `BETTER_AUTH_URL` = `https://ua-api-19x4.onrender.com`

### Checklist การ Deploy

1. Push ขึ้น branch `main`
2. Vercel auto-deploy เว็บ
3. Render auto-deploy API (หากเชื่อม repo)
4. ตรวจ endpoint `/health`
5. ทดสอบการล็อกอิน
6. ตรวจการส่งอีเมล (หากตั้งค่าไว้)

---

## 15. งานทั่วไปที่ต้องทำบ่อย

### เพิ่ม API Route ใหม่

1. เปิด `apps/api/src/app.ts`
2. เพิ่ม route ใน Elysia app:

```typescript
app.get('/api/new-route', async ({ user }) => {
  // user ถูกเติมให้อัตโนมัติจาก session
  if (!user) return { error: 'Unauthorized' };

  const data = await db.select().from(someTable);
  return (data as unknown[]);
}, { beforeHandle: [requireAuth] });
```

3. เพิ่ม TypeScript types ใน `apps/web/src/lib/api.ts`
4. เพิ่มฟังก์ชัน fetch ใน `api.ts`

### เพิ่มหน้าเว็บใหม่

1. สร้าง `apps/web/src/routes/new-page/+page.svelte`
2. สร้าง `apps/web/src/routes/new-page/+page.ts`:

```typescript
export const ssr = false;
```

3. เพิ่มลิงก์เมนูใน `apps/web/src/routes/+layout.svelte`
4. เพิ่มคำแปลใน `apps/web/src/lib/i18n.ts`

### เพิ่ม Column ในตาราง

1. แก้ไข `packages/db/src/schema.ts`:

```typescript
export const users = pgTable('users', {
  // ... คอลัมน์เดิม
  newColumn: text('new_column').default(''),
});
```

2. สร้าง migration: `cd packages/db && npx drizzle-kit generate`
3. ตรวจสอบ SQL ที่สร้างใน `drizzle/NNNN_*.sql`
4. Apply migration (ทั้ง local และ production)
5. อัปเดต API route เพื่อใช้คอลัมน์ใหม่
6. อัปเดต types ฝั่ง frontend ใน `apps/web/src/lib/api.ts`

### เพิ่มตารางใหม่

1. เพิ่มนิยามตารางใน `packages/db/src/schema.ts`
2. **ต้อง** เปิด RLS: ตั้งค่า `enableRLS: true` ใน options ของตาราง
3. สร้าง + apply migration
4. เพิ่ม RLS policies (ถ้าจำเป็น)

### แก้ไขคำแปล (i18n)

แก้ไข `apps/web/src/lib/i18n.ts` — เพิ่ม key ในทั้ง object `th` และ `en`:

```typescript
export const translations = {
  th: {
    newKey: 'ข้อความภาษาไทย',
    // ...
  },
  en: {
    newKey: 'English text',
    // ...
  }
};
```

ใช้ในคอมโพเนนต์: `t('newKey')` (import จาก `i18n.ts`)

---

## 16. ความปลอดภัย (Security)

### Row Level Security (RLS)

ทุกตารางเปิด RLS แล้ว โดยมี policies:

| ตาราง | Policy |
|-------|--------|
| `users` | ผู้ใช้ดู/แก้ไขได้เฉพาะข้อมูลตัวเอง |
| `activities` | อ่านได้สาธารณะ (เฉพาะที่เปิดรับ) |
| `requests` | นักศึกษาเห็นของตัวเอง; เจ้าหน้าที่/Admin เห็นทั้งหมด |
| `request_attachments` | นักศึกษาเห็นไฟล์ของคำร้องตัวเอง |
| `sessions` | ห้ามใครเข้าถึง (จัดการภายในโดย Better Auth) |
| `accounts` | ห้ามใครเข้าถึง |
| `verifications` | ห้ามใครเข้าถึง |

**สำคัญ**: API เชื่อมต่อด้วยบทบาท PostgreSQL owner ซึ่ง **bypass RLS** อยู่แล้ว RLS ป้องกันการเข้าถึงตรง ๆ ผ่าน anon/PostgREST

### ความปลอดภัยการอัปโหลด

- อัปโหลดผ่าน `/api/upload` (service role ฝั่งเซิร์ฟเวอร์)
- Client ไม่ได้รับหรือใช้ service role key
- Storage bucket policies เป็นด่านป้องกันชั้นที่สอง

### Rate Limiting

Endpoint ฝั่ง auth มีการจำกัดจำนวนคำขอ (ดู [หัวข้อการยืนยันตัวตน](#10-การยืนยันตัวตน-authentication))

### CORS

- `WEB_ORIGIN` กำหนด origin ที่อนุญาตให้เรียก API
- Better Auth `trustedOrigins` ต้องครอบคลุมทุก domain ของ frontend

### Gitleaks

CI รัน Gitleaks ทุกครั้งที่ push/PR เพื่อตรวจจับ secrets ที่เผลอ commit ตั้งค่าใน `gitleaks.toml`

### แนวปฏิบัติที่ดี

- ห้าม commit ไฟล์ `.env`
- ใช้ environment variables สำหรับ secrets ทั้งหมด
- ทดสอบ RLS policies หลังแก้ schema
- ใช้ `service role` เฉพาะฝั่งเซิร์ฟเวอร์เท่านั้น ห้ามอยู่ในโค้ดฝั่ง client
- ตรวจสอบ user input ทั้งหมดบนเซิร์ฟเวอร์ (Zod + Elysia types)

---

## Appendix: คำสั่งที่ใช้บ่อย

```bash
# ติดตั้ง dependencies
bun install

# รัน API dev server
cd apps/api && bun run dev

# รัน Web dev server
cd apps/web && bun run dev

# Seed ฐานข้อมูล
bun run --cwd packages/db seed

# สร้าง migration
cd packages/db && npx drizzle-kit generate

# Build สำหรับ production
bun run build          # ทั้งหมด
bun run build:web      # เฉพาะ web
bun run build:api      # เฉพาะ api

# ตรวจชนิดข้อมูล
cd apps/web && bun run check

# Lint
cd apps/web && bun run lint
```