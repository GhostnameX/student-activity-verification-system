import { Elysia, t } from "elysia";
import { db } from "@ua/db/client";
import { oauthBindSessions, sessions, students } from "@ua/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  appendSetCookie,
  createSessionFor,
  getSession,
  destroySession,
  parseCookies,
  sessionCookieString,
} from "./auth/session";
import {
  clearOAuthStateCookieString,
  consumeOAuthState,
  matchesGoogleHostedDomain,
  normalizeOAuthRedirectPath,
  oauthStateBindingFailure,
  oauthStateCookieString,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
} from "./auth/oauth-security";
import {
  oauthStateStore,
  type OAuthStateStore,
} from "./auth/oauth-state-store";
import {
  BIND_COOKIE,
  BIND_ERRORS,
  BIND_MAX_ATTEMPTS,
  BIND_TTL_SECONDS,
  BindRateLimiter,
  clearOauthBindCookieString,
  generateBindToken,
  emailMatchesStudentId,
  hashBindToken,
  isBindSessionUsable,
  normalizeThaiPhone,
  oauthBindCookieString,
} from "./auth/google-bind";
import { verifyStaffByCode } from "@ua/db/auth-helpers";
import { LoginRateLimiter, resolveLoginClientIp } from "./auth/login-rate-limit";

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

export const passwordLoginLimiter = new LoginRateLimiter({
  accountLimit: 5,
  ipLimit: 20,
  windowMs: 15 * 60 * 1000,
  maxEntries: 10_000,
});

export const bindRateLimiter = new BindRateLimiter({
  ipLimit: 5,
  windowMs: 10 * 60 * 1000,
  maxEntries: 10_000,
});

const OAUTH_STATE_RETENTION_MS = 24 * 60 * 60 * 1000;

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

export function createAuth(stateStore: OAuthStateStore = oauthStateStore) {
  return new Elysia()
  .post(
    "/api/auth/password/signin",
    async ({ body, set, request, server }) => {
      const staffCode = body.staffCode.trim().toLowerCase();
      const clientIp = resolveLoginClientIp({
        isRender: process.env.RENDER === "true",
        forwardedFor: request.headers.get("x-forwarded-for"),
        socketAddress: server?.requestIP(request)?.address,
      });
      const rateLimit = passwordLoginLimiter.consumeAttempt(staffCode, clientIp);
      if (!rateLimit.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(rateLimit.retryAfterSeconds);
        return { error: "too_many_attempts" };
      }

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
      passwordLoginLimiter.recordSuccess(staffCode, clientIp);
      const user = {
        id: st.id,
        name: st.fullName,
        staffCode: st.staffCode,
        role: st.role === "admin" ? ("admin" as const) : ("staff" as const),
        avatarUrl: st.avatarUrl ?? null,
        kind: st.kind,
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
    const now = new Date();
    try {
      await stateStore.create({
        state,
        redirectPath: redirect,
        expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_SECONDS * 1000),
      });
    } catch {
      console.error("[auth] oauth_state_store_failed");
      set.status = 500;
      return { error: "oauth_state_unavailable" };
    }
    try {
      await stateStore.cleanup(new Date(now.getTime() - OAUTH_STATE_RETENTION_MS));
    } catch {
      // Cleanup is best-effort and never blocks a newly persisted login flow.
      console.warn("[auth] oauth_state_cleanup_failed");
    }
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
      const bindingFailure = oauthStateBindingFailure(state, cookieState);
      if (bindingFailure) {
        console.warn(`[auth] invalid_state reason=${bindingFailure}`);
        return fail("invalid_state");
      }

      let saved;
      try {
        saved = await consumeOAuthState(
          state,
          cookieState,
          (stateHash, now) => stateStore.consumeByHash(stateHash, now),
        );
      } catch {
        console.error("[auth] invalid_state reason=store_error");
        return fail("invalid_state");
      }
      if (!saved) {
        console.warn("[auth] invalid_state reason=missing_used_or_expired");
        return fail("invalid_state");
      }
      if (saved.redirectPath) {
        redirectTo = new URL(saved.redirectPath, `${new URL(WEB_ORIGIN).origin}/`).toString();
      }
    }
    if (!code) return fail("missing_code");

    const profile = await resolveGoogleProfile(code);
    if (!profile) return fail("google_auth_failed");

    const email = profile.email.toLowerCase();
    const rows = await db.select().from(students).where(eq(students.email, email)).limit(1);
    const stu = rows[0];

    if (!stu) {
      // Email is not in the roster at all. Start a bounded first-login bind: the
      // OAuth identity is parked server-side and the browser only gets an opaque
      // cookie. Deliberately no student is guessed from the roster, no studentId
      // and no email is put in the redirect.
      console.log(`[auth] login_bind_required for ${email}`);
      const token = generateBindToken();
      const expiresAt = new Date(Date.now() + BIND_TTL_SECONDS * 1000);
      try {
        await db.insert(oauthBindSessions).values({
          tokenHash: hashBindToken(token),
          email,
          expiresAt,
          attempts: 0,
        });
      } catch (e) {
        console.error(`[auth] bind session insert failed: ${e}`);
        return fail(BIND_ERRORS.failed);
      }
      set.status = 302;
      appendSetCookie(set.headers, clearStateCookie);
      appendSetCookie(set.headers, oauthBindCookieString(token, SECURE_COOKIES));
      set.headers.Location = `${WEB_ORIGIN}/auth/bind`;
      return;
    }

    if (stu.status !== "active") {
      console.warn(`[auth] login_blocked: status=${stu.status} for ${email}`);
      return fail("not_in_roster");
    }
    // Soft-deleted students keep their academic status, so deleted_at has to be
    // checked separately: they must not be able to log in.
    if (stu.deletedAt) {
      console.warn(`[auth] login_blocked: soft_deleted for ${email}`);
      return fail("not_in_roster");
    }

    set.status = 302;
    await createSessionFor(set.headers, stu.studentId, "student", "google");
    set.headers.Location = redirectTo;
  })

  .get("/api/auth/google/bind/session", async ({ headers }) => {
    // Answers only "is the bind cookie I already hold still usable". It never
    // echoes the OAuth email or any studentId, so it cannot be used to probe
    // the roster. Always 200 — the client renders a different form either way.
    const token = parseCookies(headers.cookie as string | undefined)[BIND_COOKIE];
    if (!token) return { valid: false };

    const rows = await db
      .select()
      .from(oauthBindSessions)
      .where(eq(oauthBindSessions.tokenHash, hashBindToken(token)))
      .limit(1);
    const row = rows[0];
    if (!isBindSessionUsable(row)) return { valid: false };
    return { valid: true, expiresAt: row.expiresAt.toISOString() };
  })

  .post(
    "/api/auth/google/bind",
    async ({ body, headers, set, request, server }) => {
      const clientIp = resolveLoginClientIp({
        isRender: process.env.RENDER === "true",
        forwardedFor: request.headers.get("x-forwarded-for"),
        socketAddress: server?.requestIP(request)?.address,
      });
      const rateLimit = bindRateLimiter.consumeAttempt(clientIp);
      if (!rateLimit.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(rateLimit.retryAfterSeconds);
        return { error: BIND_ERRORS.tooManyAttempts };
      }

      // The OAuth email is never accepted from the body — it comes only from a
      // valid temporary bind session.
      const token = parseCookies(headers.cookie as string | undefined)[BIND_COOKIE];
      if (!token) {
        set.status = 401;
        return { error: BIND_ERRORS.sessionInvalid };
      }

      const phone = normalizeThaiPhone(body.phone);
      if (!phone) {
        set.status = 400;
        return { error: BIND_ERRORS.invalidPhone };
      }

      const studentId = body.studentId.trim();
      const tokenHash = hashBindToken(token);
      let newSessionId = "";

      let outcome;
      try {
        outcome = await db.transaction(async (tx) => {
          // Row lock first: this serialises concurrent bind attempts for the same
          // session so the attempt counter cannot be raced past the limit.
          const locked = await tx
            .select()
            .from(oauthBindSessions)
            .where(eq(oauthBindSessions.tokenHash, tokenHash))
            .limit(1)
            .for("update");
          const bind = locked[0];
          if (!isBindSessionUsable(bind)) {
            return { kind: "sessionInvalid" as const };
          }

          // The Google email must be <studentId>@psru.ac.th. Checked before the roster
          // lookup so the answer never depends on whether the student exists, and a
          // mismatch burns an attempt exactly like an unknown student does.
          const emailMatches = emailMatchesStudentId(bind.email, studentId);

          const found = emailMatches
            ? await tx.select().from(students).where(eq(students.studentId, studentId)).limit(1)
            : [];
          const student = found[0];
          // One generic error for not-found / inactive / soft-deleted: which of
          // the three it was must not be observable, otherwise this endpoint
          // enumerates the roster. Retries are allowed but capped.
          if (!emailMatches || !student || student.status !== "active" || student.deletedAt) {
            const attempts = bind.attempts + 1;
            const exhausted = attempts >= BIND_MAX_ATTEMPTS;
            await tx
              .update(oauthBindSessions)
              .set({ attempts, usedAt: exhausted ? new Date() : null })
              .where(eq(oauthBindSessions.id, bind.id));
            if (exhausted) return { kind: "tooManyAttempts" as const };
            return { kind: emailMatches ? ("invalidStudent" as const) : ("emailMismatch" as const) };
          }

          // students.email must still be NULL. The conditional UPDATE is the real
          // guard: if another request won the race it updates 0 rows.
          const bound = await tx
            .update(students)
            .set({ email: bind.email, emailBoundAt: new Date(), phone })
            .where(and(eq(students.studentId, studentId), isNull(students.email)))
            .returning({ studentId: students.studentId });
          if (bound.length === 0) return { kind: "emailAlreadyBound" as const };

          const consumed = await tx
            .update(oauthBindSessions)
            .set({ usedAt: new Date() })
            .where(and(eq(oauthBindSessions.id, bind.id), isNull(oauthBindSessions.usedAt)))
            .returning({ id: oauthBindSessions.id });
          if (consumed.length === 0) throw new Error("bind_session_already_consumed");

          await tx
            .delete(sessions)
            .where(and(eq(sessions.userId, studentId), eq(sessions.role, "student")));

          newSessionId = await createSessionFor(set.headers, studentId, "student", "google", tx, true);
          return { kind: "ok" as const, student, email: bind.email };
        });
      } catch (e) {
        // Nothing was committed: no email bound, session still unused, still
        // retryable. The user can simply try again or sign in from scratch.
        console.error(`[auth] bind transaction failed: ${e}`);
        set.status = 500;
        return { error: BIND_ERRORS.failed };
      }

      if (outcome.kind === "ok") {
        // Only now that COMMIT succeeded: drop the bind cookie and hand out the
        // login session in the same response.
        appendSetCookie(set.headers, clearOauthBindCookieString(SECURE_COOKIES));
        appendSetCookie(set.headers, sessionCookieString(newSessionId));
        const stu = outcome.student;
        return {
          user: {
            id: stu.studentId,
            name: `${stu.firstName} ${stu.lastName}`,
            // stu was read before the UPDATE, so its own email column is still
            // null by construction — the bound value is the bind row's email.
            email: outcome.email,
            role: "student" as const,
            faculty: stu.major,
            studentId: stu.studentId,
            phone,
            avatarUrl: stu.avatarUrl ?? null,
            admissionYear: stu.admissionYear ?? null,
            provider: "google" as const,
          },
        };
      }

      if (outcome.kind === "sessionInvalid") {
        set.status = 401;
        return { error: BIND_ERRORS.sessionInvalid };
      }
      if (outcome.kind === "tooManyAttempts") {
        set.status = 429;
        appendSetCookie(set.headers, clearOauthBindCookieString(SECURE_COOKIES));
        return { error: BIND_ERRORS.tooManyAttempts };
      }
      if (outcome.kind === "emailMismatch") {
        set.status = 403;
        return { error: BIND_ERRORS.emailStudentMismatch };
      }
      if (outcome.kind === "emailAlreadyBound") {
        set.status = 409;
        return { error: BIND_ERRORS.emailAlreadyBound };
      }
      set.status = 400;
      return { error: BIND_ERRORS.invalidStudent };
    },
    {
      // Any key the client adds (e.g. `email`) is stripped by the schema, and the
      // handler never reads an email from the body anyway — the only source is the
      // bind row. Extra keys are not rejected, they are dropped, so this matches
      // the other endpoints in this file rather than changing the API contract.
      body: t.Object({
        studentId: t.String({ minLength: 1, maxLength: 64 }),
        phone: t.String({ minLength: 1, maxLength: 32 }),
      }),
    },
  )

  .post("/api/auth/signout", async ({ headers, set }) => {
    await destroySession(set.headers, headers);
    return { ok: true };
  });
}

export const auth = createAuth();
