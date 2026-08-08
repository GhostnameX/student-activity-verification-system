# Student Activity Verification System

ระบบส่งคำร้องขอตรวจสอบกิจกรรมนักศึกษา — เว็บแอปพลิเคชันสำหรับนักศึกษาเจ้าหน้าที่ และผู้ดูแลระบบ เพื่อส่ง/ตรวจสอบคำร้องการเข้าร่วมกิจกรรมของมหาวิทยาลัย

## Features

- **นักศึกษา (Student):** ดูรายการกิจกรรม ส่งคำร้องพร้อมแนบรูปประกอบ และติดตามสถานะ (รอตรวจสอบ / อนุมัติ / ไม่อนุมัติ)
- **เจ้าหน้าที่ (Staff):** ตรวจสอบคำร้องทั้งหมด อนุมัติหรือไม่อนุมัติพร้อมระบุเหตุผล
- **ผู้ดูแลระบบ (Admin):** แดชบอร์ดแสดงสถิติคำร้อง และดูคำร้องทั้งหมด
- สองภาษา (ไทย / English)
- อัปโหลดไฟล์แนบผ่าน Supabase Storage

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | [SvelteKit](https://kit.svelte.dev) (Svelte 5 runes) + Tailwind CSS v4 + lucide-svelte |
| Backend | [ElysiaJS](https://elysiajs.com) on [Bun](https://bun.sh) |
| Auth | [Better Auth](https://better-auth.com) |
| ORM | [Drizzle](https://orm.drizzle.team) |
| Database | PostgreSQL (via [Supabase](https://supabase.com) pooler) |
| Storage | Supabase Storage (bucket `request-attachments`) |
| Deploy | [Vercel](https://vercel.com) (monorepo: web + Elysia as serverless functions) |

## Project Structure

```
university-activity-requests/
├── apps/
│   ├── api/          # Elysia API server (Better Auth, REST endpoints, upload)
│   └── web/          # SvelteKit frontend
├── packages/
│   └── db/           # Drizzle schema + migrations + seed
├── vercel.json
└── package.json      # Bun workspaces
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.x
- Supabase project (Postgres + Storage bucket `request-attachments`)

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment

Copy `.env.example` and fill in real values in each workspace:

| File | Contents |
|------|----------|
| `packages/db/.env` | `DATABASE_URL` (Supabase pooler) |
| `apps/api/.env` | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `WEB_ORIGIN`, `API_PORT`, `PUBLIC_API_URL`, `PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `apps/web/.env` | `PUBLIC_API_URL`, `PUBLIC_APP_URL`, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` |

> ⚠️ Never commit `.env` files. They are gitignored.

### 3. Run migrations & seed

```bash
bun run db:migrate
bun run db:seed
```

### 4. Start dev servers

```bash
bun run dev
```

- Web: http://localhost:5173
- API: http://localhost:3000

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start API + web dev servers |
| `bun run build` | Build all packages |
| `bun run build:web` | Build web (for Vercel) |
| `bun run check` | svelte-check (in `apps/web`) |
| `bun run db:generate` | Generate Drizzle migration |
| `bun run db:migrate` | Apply migrations |
| `bun run db:seed` | Seed database |
| `bun run db:studio` | Open Drizzle Studio |

## Security

- Row-Level Security (RLS) enabled on all 7 tables with policies
- Uploads go through the API server (`/api/upload`) using the service role key — never from the client
- Passwords hashed with Better Auth scrypt
