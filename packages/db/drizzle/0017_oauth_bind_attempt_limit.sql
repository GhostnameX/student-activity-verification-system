-- 0017: Bounded retry counter for first-login binding.
--       Extends 0016 (oauth_bind_sessions).
--
--       A bind session is a short-lived bearer token, so /auth/bind lets the user
--       retry a wrong studentId. Retrying is capped at BIND_MAX_ATTEMPTS (3) per
--       session to stop studentId enumeration; once the cap is hit the session is
--       invalidated by setting used_at.
--
--       The counter lives in Postgres rather than process memory so the cap holds
--       across multiple API instances and across restarts. Each attempt is
--       incremented under the same row lock (SELECT ... FOR UPDATE) that guards
--       the session, so concurrent requests cannot race past the limit.

--> statement-breakpoint
ALTER TABLE "oauth_bind_sessions" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0;
