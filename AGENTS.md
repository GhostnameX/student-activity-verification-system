# Database Safety Rules

- Production database writes are frozen until the user explicitly approves the exact operation.
- Never run plain `bun test` or `bun test --cwd apps/api`; Bun auto-discovery can import database-backed modules.
- Run DB guard tests first with `bun run test:db-guard`.
- Run request-route integration tests only with `bun run --cwd apps/api test:requests` (same wrapper, same `ua_roster_test` guard).
- Run submission stats/roster-list tests only with `bun run --cwd apps/api test:stats` (same wrapper and guard).
- Run web unit tests only with `bun run --cwd apps/web test:unit` (an explicit file list; pure functions, no database).
- Run roster integration tests only with `bun run test:roster`. This wrapper sets `ROSTER_TEST=1` and loads `apps/api/.env.test.local`.
- Integration tests must use `TEST_DATABASE_URL` on loopback port `8520`, database `ua_roster_test`. There is no fallback to `DATABASE_URL`.
- Local development uses `DATABASE_URL` on `127.0.0.1:8520/ua_dev`.
- Remote database access from local processes is denied unless `ALLOW_REMOTE_DATABASE=1` is explicitly set. Test runners always deny remote targets.
- Production `DATABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are Render environment variables. Do not put them in default local env files.
- Do not apply migrations `0016`, `0017`, `0018` (drops `staff.email`), `0019` (DESTRUCTIVE: drops `activities` and `requests.activity_*`), `0020` or `0021` to production without explicit, separate approval per file. Order is `0016` → `0017` → `0020` → `0019` → `0018` → `0021` (see `docs/DEPLOY-ROUND2.md`). Never replay migrations `0000` through `0015` against the existing production schema.
- Do not delete `feat/student-roster`, run aggressive Git garbage collection, or modify the recoverable `students_2567.json` blob.
- Do not reset production counters or delete/move objects in the `request-attachments` bucket.

# Approved Test Commands

```bash
bun run test:db-guard
bun run test:roster
bun run --cwd apps/api test:requests
bun run --cwd apps/api test:stats
bun run --cwd apps/api test:roster-import
bun run --cwd apps/web test:unit
bun run --cwd apps/api test:oauth-security
```

The roster test database setup and teardown commands are local-only and must continue to pass their loopback/target-name checks.
