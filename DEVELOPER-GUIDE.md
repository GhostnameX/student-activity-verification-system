# Developer Guide — University Activity Requests

> A comprehensive guide for developers joining this project. Covers architecture, setup, database, API, frontend, deployment, and common tasks.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Prerequisites](#3-prerequisites)
4. [Getting Started](#4-getting-started)
5. [Monorepo Architecture](#5-monorepo-architecture)
6. [Database Schema](#6-database-schema)
7. [Migrations](#7-migrations)
8. [API Routes](#8-api-routes)
9. [Frontend Routes & Pages](#9-frontend-routes--pages)
10. [Authentication](#10-authentication)
11. [File Upload Flow](#11-file-upload-flow)
12. [PDF Certificate Generation](#12-pdf-certificate-generation)
13. [Email (Resend)](#13-email-resend)
14. [Deployment](#14-deployment)
15. [Common Tasks](#15-common-tasks)
16. [Security](#16-security)

---

## 1. Project Overview

**Student Activity Verification System** — a Thai university web application for managing student activity participation requests.

### User Roles

| Role | Description |
|------|-------------|
| **Student** | Submit activity participation requests with photo attachments |
| **Staff** | Review and approve/reject requests, generate certificates |
| **Admin** | Full dashboard with stats, audit logs, activity management |

### Core Flows

```
Student submits request → Staff reviews → Approve → PDF certificate generated → Email sent
                                                  → Reject → Email with reason sent
```

### Live URLs

- **Web**: https://www.kingplapow.com (Vercel)
- **API**: https://ua-api-19x4.onrender.com (Render)
- **GitHub**: https://github.com/GhostnameX/student-activity-verification-system

---

## 2. Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Monorepo** | Bun workspaces | 1.3+ | Package management + scripts |
| **Frontend** | SvelteKit | 2.63 | SSR/CSR web framework |
| **UI Framework** | Svelte 5 | — | Runes mode (`$state`, `$derived`, `$effect`) |
| **CSS** | Tailwind CSS v4 | 4.3.3 | Utility-first styling via `@tailwindcss/vite` |
| **Icons** | lucide-svelte | 1.0.1 | Icon library |
| **Backend** | ElysiaJS | 1.2.5 | Type-safe REST API on Bun |
| **Auth** | Better Auth | 1.6.26 (web) / 1.2.3 (api) | Email+password auth, sessions, roles |
| **ORM** | Drizzle ORM | 0.38.3 | Type-safe PostgreSQL queries + migrations |
| **Database** | PostgreSQL | — | Via Supabase pooler (port 6543) |
| **Storage** | Supabase Storage | — | Bucket: `request-attachments` |
| **PDF** | pdf-lib + fontkit | 1.17.1 | Certificate generation from Thai template |
| **Email** | Resend | — | Transactional email with PDF attachment |
| **Validation** | Zod | 3.24.1 | Request body validation (API) |
| **Web Frontend** | Vercel | — | SvelteKit adapter-vercel |
| **API Host** | Render | — | Docker `oven/bun:1.3` |
| **Alt Deploy** | Fly.io | — | Singapore region, shared-cpu-1x |
| **CI** | GitHub Actions | — | Gitleaks secret scanning |

---

## 3. Prerequisites

- [Bun](https://bun.sh/) 1.3+ (`bun --version`)
- [Node.js](https://nodejs.org/) 18+ (for tooling compatibility)
- A [Supabase](https://supabase.com/) project (database + storage)
- A [Vercel](https://vercel.com/) account (for web deployment)
- A [Render](https://render.com/) account (for API deployment)
- A [Resend](https://resend.com/) account (for email, optional)

---

## 4. Getting Started

### 4.1 Clone & Install

```bash
git clone https://github.com/GhostnameX/student-activity-verification-system.git
cd university-activity-requests
bun install
```

### 4.2 Environment Variables

Copy `.env.example` to three locations:

```bash
cp .env.example .env                    # root (shared vars)
cp .env.example apps/api/.env           # API
cp .env.example packages/db/.env        # DB
cp .env.example apps/web/.env           # Web
```

Fill in the required values:

```env
# Database (Supabase pooler)
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres

# Better Auth
BETTER_AUTH_SECRET=<random-32-char-string>
BETTER_AUTH_URL=http://localhost:3000

# Supabase
PUBLIC_SUPABASE_URL=https://[project-ref].supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Email (optional — skip to disable)
RESEND_API_KEY=re_...
EMAIL_FROM=onboarding@resend.dev

# Certificate
CERTIFICATE_LOCATION=พิษณุโลก

# Frontend
PUBLIC_API_URL=http://localhost:3000
PUBLIC_APP_URL=http://localhost:5173
WEB_ORIGIN=http://localhost:5173

# API
API_PORT=3000
```

### 4.3 Seed the Database

```bash
# Seed test users + sample activities
bun run --cwd packages/db seed

# Seed 569 students (optional — requires student data JSON)
bun run --cwd packages/db seed:students
```

### 4.4 Run Development Servers

Open **two terminals**:

```bash
# Terminal 1 — API server (port 3000)
cd apps/api
bun run dev

# Terminal 2 — Web dev server (port 5173)
cd apps/web
bun run dev
```

Or from the root:

```bash
bun run dev:api    # starts API
bun run dev:web    # starts web (separate terminal)
```

### 4.5 Test Accounts

| Email | Password | Role |
|-------|----------|------|
| `student@uni.ac.th` | `student123` | Student |
| `staff@uni.ac.th` | `staff123` | Staff |
| `admin@uni.ac.th` | `admin123` | Admin |
| `weean2547@gmail.com` | `test@123` | Admin (owner) |

---

## 5. Monorepo Architecture

```
university-activity-requests/
├── apps/
│   ├── api/                    # Elysia REST API (Bun runtime)
│   │   ├── src/
│   │   │   ├── index.ts        # Bun standalone entry
│   │   │   ├── index.vercel.ts # Vercel serverless entry
│   │   │   ├── app.ts          # ALL API routes (~1200 lines)
│   │   │   ├── auth.ts         # Better Auth configuration
│   │   │   └── certificate.ts  # PDF certificate generator
│   │   └── assets/
│   │       ├── forms/          # PDF template
│   │       └── fonts/          # TH Sarabun New fonts
│   │
│   └── web/                    # SvelteKit frontend
│       ├── src/
│       │   ├── routes/         # Page routes (SSR disabled)
│       │   ├── lib/
│       │   │   ├── api.ts      # API client + TypeScript types
│       │   │   ├── auth.ts     # Auth state stores
│       │   │   ├── auth-client.ts # Better Auth browser client
│       │   │   ├── i18n.ts     # Thai/English translations
│       │   │   ├── store.ts    # Language + dark mode stores
│       │   │   ├── supabase.ts # Upload wrapper
│       │   │   └── components/ # Reusable Svelte components
│       │   ├── app.css         # Tailwind v4 theme config
│       │   └── app.html        # HTML shell (Google Fonts)
│       └── vercel.json         # Proxy /api/* → Render
│
├── packages/
│   └── db/                     # Shared database package
│       ├── src/
│       │   ├── schema.ts       # ALL table definitions (11 tables)
│       │   ├── client.ts       # Drizzle + pg Pool
│       │   ├── seed.ts         # Test data seeder
│       │   └── seed-students-2567.ts
│       ├── drizzle/            # Migration SQL files
│       └── drizzle.config.ts   # Kit config
│
├── docs/                       # Documentation
├── Dockerfile                  # API container (oven/bun:1.3)
├── fly.toml                    # Fly.io config
├── render.yaml                 # Render config
└── package.json                # Root workspace config
```

### Key Relationships

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
     └────< students (roster, separate from auth users)
```

---

## 6. Database Schema

All tables defined in `packages/db/src/schema.ts`.

### Enums

```typescript
role: 'student' | 'staff' | 'admin'
request_status: 'pending' | 'approved' | 'rejected'
notification_type: 'request_status_change'
student_status: 'active' | 'graduated' | 'withdrawn'
```

### Tables

#### Core Business Tables

| Table | PK | Purpose |
|-------|-----|---------|
| `users` | `id` (UUID) | All users — name, email, role, faculty, studentId, phone |
| `activities` | `id` (UUID) | University activities — title, type, dates, isActive flag |
| `requests` | `id` (UUID) | Student participation requests — status, notes, certificate info |
| `request_attachments` | `id` (UUID) | Photo files attached to requests |
| `certificate_counters` | `year` (int) | Running certificate number per Buddhist year |

#### System Tables

| Table | PK | Purpose |
|-------|-----|---------|
| `sessions` | `id` | Better Auth session tokens |
| `accounts` | `id` | Better Auth credential storage |
| `verifications` | `id` | Better Auth email verification tokens |
| `notifications` | `id` | In-app notification messages |
| `audit_logs` | `id` | Admin audit trail (all actions) |

#### Roster Tables

| Table | PK | Purpose |
|-------|-----|---------|
| `students` | `student_id` | Imported student roster (PII) |
| `import_batches` | `id` | Tracks bulk import operations |

### Key Relationships

- `requests.studentId` → `users.id` (who submitted)
- `requests.activityId` → `activities.id` (which activity)
- `requests.reviewedById` → `users.id` (who approved/rejected)
- `request_attachments.requestId` → `requests.id` (cascade delete)
- `notifications.userId` → `users.id` (cascade delete)
- `students.major` + `students.groupName` → used for stats aggregation

### Indexes

```sql
-- Performance indexes
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

## 7. Migrations

### Technology

- **Drizzle Kit** manages migrations in `packages/db/drizzle/`
- Migration files are auto-generated SQL
- Manual edits may be needed for complex operations (e.g., type casts)

### Creating a Migration

```bash
# 1. Edit packages/db/src/schema.ts with your changes

# 2. Generate migration SQL
cd packages/db
npx drizzle-kit generate

# 3. Review the generated SQL in drizzle/NNNN_*.sql

# 4. Apply to database
bun run migrate
# Or manually via Supabase SQL Editor / MCP tools
```

### Applying Migrations to Production

```bash
# Via Supabase MCP (recommended)
# Use supabase_apply_migration tool with the SQL content

# Via Supabase Dashboard
# SQL Editor → paste migration SQL → Run

# Via psql (direct)
psql $DATABASE_URL -f drizzle/NNNN_*.sql
```

### Important Rules

- **Always enable RLS** on new tables: `ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;`
- **Test migrations locally** before applying to production
- **Back up production data** before destructive migrations
- **Never run destructive SQL** (DROP, DELETE, TRUNCATE) without explicit user confirmation

---

## 8. API Routes

All routes defined in `apps/api/src/app.ts`. Better Auth handles `/api/auth/*` automatically.

### Public Routes (No Auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/activities` | List active activities (`?includeInactive=true` for all) |

### Authenticated Routes

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `POST` | `/api/upload` | Any | Upload file to Supabase Storage |
| `GET` | `/api/requests` | Any | List requests (filtered by role) |
| `GET` | `/api/requests/:id` | Any | Get single request with attachments |
| `POST` | `/api/requests` | Student | Submit new request |
| `PATCH` | `/api/requests/:id` | Owner | Update own pending request |
| `POST` | `/api/requests/:id/approve` | Staff/Admin | Approve + generate certificate + email |
| `POST` | `/api/requests/:id/reject` | Staff/Admin | Reject with reason + email |
| `GET` | `/api/me` | Any | Get current user profile |
| `PATCH` | `/api/me` | Any | Update phone number |
| `GET` | `/api/notifications` | Any | List user notifications |
| `POST` | `/api/notifications/:id/read` | Any | Mark notification read |
| `POST` | `/api/notifications/read-all` | Any | Mark all read |

### Admin-Only Routes

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `POST` | `/api/activities` | Admin | Create activity |
| `PATCH` | `/api/activities/:id` | Admin | Update activity |
| `DELETE` | `/api/activities/:id` | Admin | Soft-delete (set `isActive=false`) |
| `GET` | `/api/audit` | Admin | Audit log (last 200 entries) |
| `GET` | `/api/stats` | Admin | Stats by activity + faculty |
| `GET` | `/api/stats/submission` | Staff/Admin | Submission rate by major (SQL aggregate) |
| `GET` | `/api/roster/not-submitted` | Staff/Admin | Paginated list of non-submitted students |

### Request/Response Examples

#### Submit a Request

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

#### Approve a Request

```bash
POST /api/requests/:id/approve
Content-Type: application/json
Cookie: ua_session=<token>

{
  "activityName": "กิจกรรมกีฬาสีชิงถ้วยพระราชทาน"
}
```

**Response**: Triggers atomic certificate number increment → PDF generation → email send.

#### Get Submission Stats

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

## 9. Frontend Routes & Pages

All pages use `export const ssr = false` (client-side rendered).

| Route | Page | Role Access | Description |
|-------|------|-------------|-------------|
| `/` | Landing | Public | Feature cards (guest) or role-based CTA (logged in) |
| `/auth/signin` | Sign In/Up | Guest | Animated toggle card between sign-in and sign-up |
| `/auth/signup` | Redirect | Guest | 307 redirect to `/auth/signin?mode=signup` |
| `/auth/signout` | Sign Out | Auth | Clears session + redirects to `/` |
| `/student` | Student Dashboard | Student | Submit request form + view own requests |
| `/staff` | Staff Review | Staff/Admin | Table of all requests + approve/reject modal |
| `/stats` | Submission Stats | Staff/Admin | Cards + by-major table + roster modal |
| `/admin` | Admin Dashboard | Admin | Stats + audit log + all requests |
| `/profile` | User Profile | Auth | View info + update phone number |

### Layout (`+layout.svelte`)

The root layout provides:
- **Sticky header** with brand, nav tabs, notification bell, language toggle, dark mode toggle, user info + logout
- **Notifications dropdown** with unread count badge + mark-as-read
- **Footer** with app name + year

### Key Frontend Files

| File | Path | Purpose |
|------|------|---------|
| `api.ts` | `apps/web/src/lib/api.ts` | All fetch functions + TypeScript interfaces |
| `auth.ts` | `apps/web/src/lib/auth.ts` | Auth state store + `loadSession()` |
| `auth-client.ts` | `apps/web/src/lib/auth-client.ts` | Better Auth browser client |
| `i18n.ts` | `apps/web/src/lib/i18n.ts` | ~130 Thai/English translation keys |
| `store.ts` | `apps/web/src/lib/store.ts` | Language + dark mode localStorage stores |
| `supabase.ts` | `apps/web/src/lib/supabase.ts` | Upload wrapper (calls API `/api/upload`) |
| `SuccessCheck.svelte` | `apps/web/src/lib/components/` | Animated success overlay (CSS-only) |

---

## 10. Authentication

### Better Auth Setup

- **Server config**: `apps/api/src/auth.ts`
- **Client config**: `apps/web/src/lib/auth-client.ts`
- **Adapter**: Drizzle (PostgreSQL)
- **Session strategy**: Database sessions with cookies
- **Cookie prefix**: `ua`
- **Session expiry**: 7 days
- **Update age**: 1 day (refresh if active)

### Role System

Roles are stored in `users.role` and attached to the session. Better Auth `user.additionalFields` declares:

```typescript
// In auth config
user: {
  additionalFields: {
    role: { type: 'string', input: false },      // 'student' | 'staff' | 'admin'
    faculty: { type: 'string', input: false },
    studentId: { type: 'string', input: false },
    phone: { type: 'string', input: false }
  }
}
```

Roles are assigned manually (via DB update) — there's no self-service role registration.

### Rate Limiting

Enabled via `better-auth/rateLimit` with in-memory storage:

| Endpoint | Limit |
|----------|-------|
| Global | 20 requests / 60 seconds |
| Sign-in | 5 attempts / 60 seconds |
| Sign-up | 10 attempts / 3600 seconds |
| Forgot Password | 5 attempts / 300 seconds |

### Trusted Origins

Better Auth `trustedOrigins` must be set at the **top level** of the config (not under `advanced`). This controls CORS for cross-origin login requests.

---

## 11. File Upload Flow

```
Client                  API Server               Supabase Storage
  │                        │                          │
  ├─ POST /api/upload ────>│                          │
  │  (multipart form data) │                          │
  │                        ├─ Read file buffer        │
  │                        ├─ Generate storagePath    │
  │                        ├─ Upload via service role ─>│
  │                        │                          │
  │                        │<─── Return path ─────────┤
  │<─── Return storagePath │                          │
  │                        │                          │
  ├─ POST /api/requests ──>│                          │
  │  { attachmentIds: [storagePath] }                 │
  │                        ├─ Insert request_attachments rows
```

### Key Points

- Uploads go through the **API server** using the service role key (bypasses RLS)
- Client never has direct access to Supabase Storage
- Files stored in bucket: `request-attachments`
- Storage path format: `{userId}/{timestamp}-{filename}`

---

## 12. PDF Certificate Generation

### Location

`apps/api/src/certificate.ts`

### How It Works

1. Load PDF template from `apps/api/assets/forms/activity-request-form.pdf`
2. Embed TH Sarabun New fonts (regular + bold) from `apps/api/assets/fonts/`
3. Fill in text fields at specific coordinates on the template
4. Return PDF buffer

### Certificate Number (Atomic)

Uses a `certificate_counters` table with row-level locking:

```sql
-- Atomic increment per Buddhist year
INSERT INTO certificate_counters (year, last_number)
VALUES (2569, 0)
ON CONFLICT (year) DO NOTHING;

UPDATE certificate_counters
SET last_number = last_number + 1
WHERE year = 2569
RETURNING last_number;
```

This prevents race conditions when multiple approvals happen simultaneously.

### Approval Flow

```
1. BEGIN TRANSACTION
2.   UPDATE requests SET status='approved' WHERE id=? AND status='pending' (atomic TOCTOU guard)
3.   Increment certificate counter (atomic row lock)
4.   UPDATE requests SET certificate_number=?, certificate_year=?
5. COMMIT
6. Generate PDF (outside transaction)
7. Send email with PDF attachment (outside transaction, skip if no API key)
```

### Font Requirements

- **THSarabunNew.ttf** — Regular weight (SIPA-licensed Thai font)
- **THSarabunNew-Bold.ttf** — Bold weight
- Download from [f0nt.com](https://www.f0nt.com/release/thai-sarabun-new/)

---

## 13. Email (Resend)

### Configuration

```env
RESEND_API_KEY=re_...
EMAIL_FROM=onboarding@resend.dev    # Must be verified sender
```

### How It's Used

- Sent on **approve** and **reject** actions
- Includes PDF attachment on approval
- Skipped silently if `RESEND_API_KEY` is not set

### Email Templates

Handled inline in `apps/api/src/app.ts` within the approve/reject routes. No separate template files.

---

## 14. Deployment

### Architecture

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

### Web (Vercel)

- Framework: SvelteKit with `adapter-vercel`
- Build command: `bun run build:web`
- `vercel.json` rewrites `/api/*` to the Render API URL

### API (Render)

- Docker image: `oven/bun:1.3`
- Start command: `bun run dist/index.js`
- `render.yaml` defines the service configuration

### API (Fly.io — Alternative)

- Config: `fly.toml`
- Region: Singapore (sin)
- Plan: shared-cpu-1x, 512MB RAM

### Environment Variables in Production

**Vercel** (web):
- `PUBLIC_API_URL` = `''` (empty — uses relative URLs via proxy)
- `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`

**Render** (API):
- All API-side env vars from `.env.example`
- `WEB_ORIGIN` = `https://www.kingplapow.com`
- `BETTER_AUTH_URL` = `https://ua-api-19x4.onrender.com`

### Deploy Checklist

1. Push to `main` branch
2. Vercel auto-deploys web
3. Render auto-deploys API (if connected to repo)
4. Verify `/health` endpoint
5. Test login flow
6. Check email delivery (if configured)

---

## 15. Common Tasks

### Adding a New API Route

1. Open `apps/api/src/app.ts`
2. Add route inside the Elysia app:

```typescript
app.get('/api/new-route', async ({ user }) => {
  // user is automatically populated from session
  if (!user) return { error: 'Unauthorized' };

  const data = await db.select().from(someTable);
  return data;
}, { beforeHandle: [requireAuth] });
```

3. Add TypeScript types to `apps/web/src/lib/api.ts`
4. Add fetch function in `api.ts`

### Adding a New Frontend Page

1. Create `apps/web/src/routes/new-page/+page.svelte`
2. Create `apps/web/src/routes/new-page/+page.ts`:

```typescript
export const ssr = false;
```

3. Add nav link in `apps/web/src/routes/+layout.svelte`
4. Add i18n keys in `apps/web/src/lib/i18n.ts`

### Adding a Database Column

1. Edit `packages/db/src/schema.ts`:

```typescript
export const users = pgTable('users', {
  // ... existing columns
  newColumn: text('new_column').default(''),
});
```

2. Generate migration: `cd packages/db && npx drizzle-kit generate`
3. Review generated SQL in `drizzle/NNNN_*.sql`
4. Apply migration (locally then production)
5. Update API routes to use the new column
6. Update frontend types in `apps/web/src/lib/api.ts`

### Adding a New Table

1. Add table definition in `packages/db/src/schema.ts`
2. **MUST** enable RLS: add `enableRLS: true` in table options
3. Generate + apply migration
4. Add RLS policies if needed

### Changing i18n Strings

Edit `apps/web/src/lib/i18n.ts` — add key to both `th` and `en` objects:

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

Use in components: `t('newKey')` (imported from `i18n.ts`)

---

## 16. Security

### Row Level Security (RLS)

All tables have RLS enabled. Policies:

| Table | Policy |
|-------|--------|
| `users` | Users can read/update their own record |
| `activities` | Public read (active only) |
| `requests` | Students see own; staff/admin see all |
| `request_attachments` | Students see own request's files |
| `sessions` | Deny all (managed by Better Auth internally) |
| `accounts` | Deny all |
| `verifications` | Deny all |

**Important**: The API connects as the PostgreSQL owner role, which **bypasses RLS**. RLS protects against anon/PostgREST direct access.

### Upload Security

- Files uploaded through `/api/upload` (server-side service role)
- Client never receives or uses the Supabase service role key
- Storage bucket policies are a secondary defense layer

### Rate Limiting

Auth endpoints are rate-limited (see [Authentication](#10-authentication)).

### CORS

- `WEB_ORIGIN` controls allowed origin for API requests
- Better Auth `trustedOrigins` must include all frontend domains

### Gitleaks

CI runs Gitleaks on every push/PR to detect committed secrets. Config in `gitleaks.toml`.

### Best Practices

- Never commit `.env` files
- Use environment variables for all secrets
- Test RLS policies after schema changes
- Use `service role` only on the server, never in client code
- Validate all user input on the server (Zod + Elysia types)

---

## Appendix: Useful Commands

```bash
# Install dependencies
bun install

# Run API dev server
cd apps/api && bun run dev

# Run Web dev server
cd apps/web && bun run dev

# Seed database
bun run --cwd packages/db seed

# Generate migration
cd packages/db && npx drizzle-kit generate

# Build for production
bun run build          # everything
bun run build:web      # web only
bun run build:api      # api only

# Type check
cd apps/web && bun run check

# Lint
cd apps/web && bun run lint
```
