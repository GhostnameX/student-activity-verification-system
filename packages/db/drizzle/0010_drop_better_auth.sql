-- 0010: DROP better-auth leftovers (users/accounts/verifications/better_auth_sessions).
--       ⚠️ SEPARATE migration — do NOT run in the same deploy round as 0007-0009.
--       Run only AFTER ≥48-72h with the new auth stack live and zero errors.
--       Order matters: child FKs (accounts, verifications, better_auth_sessions) dropped before users.

--> statement-breakpoint
DROP TABLE "better_auth_sessions" CASCADE;
--> statement-breakpoint
DROP TABLE "accounts" CASCADE;
--> statement-breakpoint
DROP TABLE "verifications" CASCADE;
--> statement-breakpoint
DROP TABLE "users" CASCADE;