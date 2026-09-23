import { Elysia, t } from "elysia";
import { db } from "@ua/db/client";
import { students } from "@ua/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  createSessionFor,
  getSession,
  destroySession,
  parseCookies,
} from "./auth/session";
import {
  clearOAuthStateCookieString,
  consumeOAuthState,
  matchesGoogleHostedDomain,
  normalizeOAuthRedirectPath,
  oauthStateCookieString,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
  type OAuthStateEntry,
} from "./auth/oauth-security";
import { verifyStaffByCode } from "@ua/db/auth-helpers";

const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:5173";
const API_BASE = process.env.PUBLIC_API_URL || "http://localhost:3000";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_HD = (process.env.GOOGLE_HD?.trim() || "psru.ac.th").toLowerCase();
const REDIRECT_URI =
  (WEB_ORIGIN.startsWith("http://localhost") ? API_BASE : WEB_ORIGIN) +
  "/api/auth/google/callback";
const DEV_BYPASS = process.env.NODE_ENV !== "production" && process.env.AUTH_BYPASS_GOOGLE === "true";
const SECURE_COOKIES = process.env.NODE_ENV === "production";
console.log(
  `[auth] boot: API_BASE=${API_BASE} WEB_ORIGIN=${WEB_ORIGIN} REDIRECT_URI=${REDIRECT_URI} GOOGLE_HD=${GOOGLE_HD ? `"${GOOGLE_HD}"` : "(unset)"} NODE_ENV=${process.env.NODE_ENV ?? "(unset)"} DEV_BYPASS=${DEV_BYPASS}`,
);
const googleDevPath = `./auth/${"google"}.${"dev"}`;

const oauthStates = new Map<string, OAuthStateEntry>();

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
    if (!matchesGoogleHostedDomain(GOOGLE_HD, info.hd)) return null;
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
      const staffCode = body.staffCode.trim().toLowerCase();
      const result = await verifyStaffByCode(staffCode, body.password);
      let st = result?.user;
      if (!result || !result.ok || !st) {
        set.status = 401;
        return { error: "invalidCredentials" };
      }
      if (st.isActive === false) {
        set.status = 403;
        return { error: "account_disabled" };
      }
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
        staffCode: t.String(),
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
    const redirect = normalizeOAuthRedirectPath(
      typeof query.redirect === "string" ? query.redirect : undefined,
      WEB_ORIGIN,
    );
    oauthStates.set(state, { redirect, expires: Date.now() + OAUTH_STATE_TTL_SECONDS * 1000 });
    set.headers["Set-Cookie"] = oauthStateCookieString(state, SECURE_COOKIES);
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "online",
      prompt: "select_account",
    });
    params.set("hd", GOOGLE_HD);
    return { redirectUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
  })

  .get("/api/auth/google/callback", async ({ query, headers, set }) => {
    const code = typeof query.code === "string" ? query.code : undefined;
    const state = typeof query.state === "string" ? query.state : undefined;
    const cookieState = parseCookies(headers.cookie as string | undefined)[OAUTH_STATE_COOKIE];
    const clearStateCookie = clearOAuthStateCookieString(SECURE_COOKIES);
    const fail = (reason: string) => {
      set.status = 302;
      set.headers.Location = `${WEB_ORIGIN}/auth/signin?error=${encodeURIComponent(reason)}`;
      set.headers["Set-Cookie"] = clearStateCookie;
    };

    let redirectTo = WEB_ORIGIN;
    if (!DEV_BYPASS) {
      const saved = consumeOAuthState(oauthStates, state, cookieState);
      if (!saved) return fail("invalid_state");
      if (saved.redirect) redirectTo = new URL(saved.redirect, `${new URL(WEB_ORIGIN).origin}/`).toString();
    }
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
