-- 0020: Durable, one-time Google OAuth login state.
-- Stores only a SHA-256 hash of the browser state so API restarts and
-- multi-instance routing cannot invalidate an otherwise valid callback.
-- No foreign keys or CASCADE behavior are needed for this isolated TTL data.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_login_states" (
	"id" text PRIMARY KEY NOT NULL,
	"state_hash" text NOT NULL,
	"redirect_path" text,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_login_states_state_hash_uidx" ON "oauth_login_states" USING btree ("state_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_login_states_expires_at_idx" ON "oauth_login_states" USING btree ("expires_at");
--> statement-breakpoint
ALTER TABLE "oauth_login_states" ENABLE ROW LEVEL SECURITY;
