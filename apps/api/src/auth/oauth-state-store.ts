import { db, type DB } from "@ua/db/client";
import { oauthLoginStates } from "@ua/db/schema";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { hashOAuthState, type ConsumedOAuthState } from "./oauth-security";

export interface NewOAuthState {
  state: string;
  redirectPath?: string;
  expiresAt: Date;
}

export interface OAuthStateStore {
  create(input: NewOAuthState): Promise<void>;
  consumeByHash(stateHash: string, now: Date): Promise<ConsumedOAuthState | null>;
  cleanup(olderThan: Date): Promise<void>;
}

export function createPostgresOAuthStateStore(executor: DB = db): OAuthStateStore {
  return {
    async create(input) {
      await executor.insert(oauthLoginStates).values({
        stateHash: hashOAuthState(input.state),
        redirectPath: input.redirectPath,
        expiresAt: input.expiresAt,
      });
    },

    async consumeByHash(stateHash, now) {
      const consumed = await executor
        .update(oauthLoginStates)
        .set({ usedAt: now })
        .where(
          and(
            eq(oauthLoginStates.stateHash, stateHash),
            isNull(oauthLoginStates.usedAt),
            gt(oauthLoginStates.expiresAt, now),
          ),
        )
        .returning({ redirectPath: oauthLoginStates.redirectPath });

      if (consumed.length === 0) return null;
      if (consumed.length !== 1) throw new Error("oauth_state_consume_affected_unexpected_rows");
      return consumed[0];
    },

    async cleanup(olderThan) {
      await executor
        .delete(oauthLoginStates)
        .where(lt(oauthLoginStates.expiresAt, olderThan));
    },
  };
}

export const oauthStateStore = createPostgresOAuthStateStore();
