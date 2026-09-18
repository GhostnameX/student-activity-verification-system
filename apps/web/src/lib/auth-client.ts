import { API_BASE } from "./api";
import type { SessionUser } from "./api";

export async function signInWithPassword(email: string, password: string) {
  const res = await fetch(`${API_BASE}/api/auth/password/signin`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return { user: null, error: (data as any)?.error || "invalidCredentials" };
  }
  return { user: (data as { user: SessionUser }).user, error: null };
}

export async function getGoogleSignInUrl(redirect?: string): Promise<string> {
  const q = redirect ? `?redirect=${encodeURIComponent(redirect)}` : "";
  const res = await fetch(`${API_BASE}/api/auth/google/url${q}`, {
    credentials: "include",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data as any)?.error || "google_not_configured");
  }
  return (data as { redirectUrl: string }).redirectUrl;
}

export async function signOut(): Promise<void> {
  await fetch(`${API_BASE}/api/auth/signout`, {
    method: "POST",
    credentials: "include",
  }).catch(() => undefined);
}