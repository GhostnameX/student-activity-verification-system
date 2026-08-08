import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@ua/db/client";
import * as schema from "@ua/db/schema";

const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:5173";
const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL || "http://localhost:3000";

export const auth = betterAuth({
  baseURL: BETTER_AUTH_URL,
  trustedOrigins: [WEB_ORIGIN],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        input: false,
        required: true,
      },
      faculty: {
        type: "string",
        input: false,
        required: false,
      },
      studentId: {
        type: "string",
        input: false,
        required: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },
  advanced: {
    cookiePrefix: "ua",
    useCrossSubDomainCookies: false,
  },
});
