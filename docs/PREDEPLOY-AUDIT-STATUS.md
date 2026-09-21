# Pre-deploy Audit Status

Updated from source review at commit `1914981` on branch `main`.

## Status

The Auth/Session and Authorization audit completed reconnaissance only. Work stopped when the five-hour Codex window reached 80% used (20% remaining), as requested. No hunting wave, bounded security reproduction, or independent finding verification ran. The items below are therefore pending validation, not confirmed vulnerabilities.

## Source controls verified

- Staff/admin passwords are verified with Argon2id (`packages/db/src/auth-helpers.ts`).
- Google login requires a verified email and an active roster row (`apps/api/src/auth.ts`).
- Session lookup rechecks student/staff active status and the current staff role on every request (`apps/api/src/auth/session.ts`).
- `ua_session` is HttpOnly and SameSite=Lax; production mode adds Secure (`apps/api/src/auth/session.ts`).
- Credentialed CORS is restricted to configured `WEB_ORIGIN` (`apps/api/src/app.ts`).
- Backend guards deny Staff access to request list/detail and restrict roster/statistics to Staff/Admin (`apps/api/src/app.ts`).
- Student request reads and resubmissions are owner-scoped; review actions are Admin-only (`apps/api/src/app.ts`).
- Upload is restricted to Student at the API boundary (`apps/api/src/app.ts`).

## Priority validation backlog

1. Require valid, unexpired OAuth state; currently missing or unknown state does not stop callback processing (`apps/api/src/auth.ts:144`).
2. Restrict OAuth post-login redirects to same-origin application paths (`apps/api/src/auth.ts:129`).
3. Require the Google `hd` claim to equal the configured domain when domain enforcement is enabled (`apps/api/src/auth.ts:64`).
4. Add or verify rate limiting for password login and OAuth endpoints; none is visible in application source.
5. Decide whether the browser session cookie must persist for the same seven-day TTL as the database session; it currently has no Max-Age/Expires (`apps/api/src/auth/session.ts:34`).
6. Revoke existing sessions after password change/reset if that is the intended security contract (`apps/api/src/app.ts:1452`, `apps/api/src/app.ts:1697`).
7. Bind each uploaded Storage object to its uploader/request. Request create/resubmit currently accepts client-supplied `storagePath` metadata (`apps/api/src/app.ts:581`, `apps/api/src/app.ts:1101`).
8. Verify deployed Supabase bucket visibility, Storage policies, Data API exposure, grants, and RLS. These controls are not fully represented in checked-in migrations.
9. Replace or isolate `gate-smoke.ts` before treating it as audit evidence; it mutates configured PostgreSQL and Storage and does not clean all created records.
10. Continue with request state-machine/transaction, migration sequence, frontend/i18n, and performance audit scopes after closing Auth/Authorization.

## Known documentation drift

- `README.md` still describes Staff as request reviewers, while requirements and current backend reserve request review for Admin.
- Root `bun run check` does not exist; the web check is `bun run --filter @ua/web check`.
- The repository contains legacy Better Auth schema/dependencies while runtime authentication uses custom Google/password sessions; migration `0010` remains a deployment decision.

## Next audit session

Resume from the priority backlog above. Use a disposable local PostgreSQL/Storage fixture or an OS-enforced isolated test environment before running authentication and authorization integration tests. Do not run the current smoke script against production or shared Supabase resources.
