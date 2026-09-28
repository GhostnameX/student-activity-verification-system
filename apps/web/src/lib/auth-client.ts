import { API_BASE } from "./api";
import type { SessionUser } from "./api";

export async function signInWithPassword(staffCode: string, password: string) {
  const res = await fetch(`${API_BASE}/api/auth/password/signin`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ staffCode, password }),
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

export interface BindSessionStatus {
	valid: boolean;
	expiresAt?: string;
}

/**
 * Whether the temporary OAuth bind cookie is still usable. The response never
 * contains the Google email or a studentId — only this flag and an expiry.
 */
export async function getBindSessionStatus(): Promise<BindSessionStatus> {
	try {
		const res = await fetch(`${API_BASE}/api/auth/google/bind/session`, {
			credentials: "include",
		});
		if (!res.ok) return { valid: false };
		return (await res.json()) as BindSessionStatus;
	} catch {
		return { valid: false };
	}
}

/**
 * Link the Google identity held server-side to a student record. The body
 * carries only what the user typed: the email is never sent from the client.
 */
export async function bindStudentAccount(studentId: string, phone: string) {
	const res = await fetch(`${API_BASE}/api/auth/google/bind`, {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ studentId, phone }),
	});
	const data = await res.json().catch(() => null);
	if (!res.ok) {
		return { user: null as SessionUser | null, error: (data as { error?: string })?.error ?? "bind_failed" };
	}
	return { user: (data as { user: SessionUser }).user, error: null as string | null };
}