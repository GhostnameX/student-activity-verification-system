import { Elysia, t } from "elysia";
import { db } from "@ua/db/client";
import { students } from "@ua/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  createSessionFor,
  getSession,
  destroySession,
} from "./auth/session";
import { verifyStaffPassword } from "@ua/db/auth-helpers";

const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:5173";
const API_BASE = process.env.PUBLIC_API_URL || "http://localhost:3000";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_HD = process.env.GOOGLE_HD === undefined ? "psru.ac.th" : (process.env.GOOGLE_HD.trim() || undefined);
const REDIRECT_URI = `${API_BASE}/api/auth/google/callback`;
const DEV_BYPASS = process.env.NODE_ENV !== "production" && process.env.AUTH_BYPASS_GOOGLE === "true";
console.log(
  `[auth] boot: API_BASE=${API_BASE} WEB_ORIGIN=${WEB_ORIGIN} REDIRECT_URI=${REDIRECT_URI} GOOGLE_HD=${GOOGLE_HD ? `"${GOOGLE_HD}"` : "(unset)"} NODE_ENV=${process.env.NODE_ENV ?? "(unset)"} DEV_BYPASS=${DEV_BYPASS}`,
);
const googleDevPath = `./auth/${"google"}.${"dev"}`;

const oauthStates = new Map<string, { redirect?: string; expires: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of oauthStates) {
    if (v.expires < now) oauthStates.delete(k);
  }
}, 60_000);

async function resolveGoogleProfile(code: string): Promise<{ email: string; name: string } | null> {
  if (DEV_BYPASS) {
    const mod = await import(googleDevPath);
    return mod.getDevGoogleProfile();
  }
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.log("[auth] GOOGLE_CLIENT_ID/SECRET not configured");
    return null;
  }
  try {
    const tokRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    if (!tokRes.ok) return null;
    const tok = (await tokRes.json()) as { access_token?: string };
    if (!tok.access_token) return null;
    const infoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (!infoRes.ok) return null;
    const info = (await infoRes.json()) as {
      email?: string;
      name?: string;
      email_verified?: boolean;
      hd?: string;
    };
    if (!info.email || !info.email_verified) return null;
    if (GOOGLE_HD && info.hd && info.hd !== GOOGLE_HD) return null;
    return { email: info.email, name: info.name ?? "" };
  } catch (e) {
    console.log(`[auth] google exchange failed: ${e}`);
    return null;
  }
}

export const auth = new Elysia()
  .get("/api/auth/session", async ({ headers }) => {
    const user = await getSession(headers);
    return { user };
  })

  .post(
    "/api/auth/password/signin",
    async ({ body, set, headers }) => {
      const email = body.email.trim().toLowerCase();
      const result = await verifyStaffPassword(email, body.password);
      if (!result || !result.ok) {
        set.status = 401;
        return { error: "invalidCredentials" };
      }
      const st = result.user;
      const user = {
        id: st.id,
        name: st.fullName,
        email: st.email,
        role: st.role === "admin" ? ("admin" as const) : ("staff" as const),
        faculty: null,
        studentId: null,
        phone: null,
        provider: "password" as const,
      };
      await createSessionFor(set.headers, st.id, st.role === "admin" ? "admin" : "staff", "password");
      return { user };
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String(),
      }),
    },
  )

  .get("/api/auth/google/url", async ({ query, set }) => {
    if (DEV_BYPASS) {
      return { redirectUrl: `${API_BASE}/api/auth/google/callback?code=dev` };
    }
    if (!GOOGLE_CLIENT_ID) {
      set.status = 500;
      return { error: "google_not_configured" };
    }
    const state = randomUUID();
    const redirect = typeof query.redirect === "string" ? query.redirect : undefined;
    oauthStates.set(state, { redirect, expires: Date.now() + 10 * 60 * 1000 });
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "online",
      prompt: "select_account",
    });
    if (GOOGLE_HD) params.set("hd", GOOGLE_HD);
    return { redirectUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
  })

  .get("/api/auth/google/callback", async ({ query, set }) => {
    const code = typeof query.code === "string" ? query.code : undefined;
    const state = typeof query.state === "string" ? query.state : undefined;
    let redirectTo = WEB_ORIGIN;
    if (state) {
      const saved = oauthStates.get(state);
      if (saved) {
        oauthStates.delete(state);
        if (saved.redirect) redirectTo = new URL(saved.redirect, WEB_ORIGIN).toString();
      }
    }
    const fail = (reason: string) => {
      set.status = 302;
      set.headers.Location = `${WEB_ORIGIN}/auth/signin?error=${encodeURIComponent(reason)}`;
    };
    if (!code) return fail("missing_code");

    const profile = await resolveGoogleProfile(code);
    if (!profile) return fail("google_auth_failed");

    const rows = await db
      .select()
      .from(students)
      .where(eq(students.email, profile.email.toLowerCase()))
      .limit(1);
    const stu = rows[0];
    if (!stu) {
      console.warn(`[auth] login_blocked: not_in_roster for ${profile.email.toLowerCase()}`);
      return fail("not_in_roster");
    }
    if (stu.status !== "active") {
      console.warn(`[auth] login_blocked: status=${stu.status} for ${profile.email.toLowerCase()}`);
      return fail("not_in_roster");
    }

    set.status = 302;
    await createSessionFor(set.headers, stu.studentId, "student", "google");
    set.headers.Location = redirectTo;
  })

  .post("/api/auth/signout", async ({ headers, set }) => {
    await destroySession(set.headers, headers);
    return { ok: true };
  });