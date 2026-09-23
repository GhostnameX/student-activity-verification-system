import { writable } from "svelte/store";
import type { SessionUser } from "./api";
import { getMe } from "./api";

export const user = writable<SessionUser | null>(null);
export const authLoading = writable<boolean>(true);

let pendingSession: Promise<void> | null = null;

export function loadSession(): Promise<void> {
  if (pendingSession) return pendingSession;
  authLoading.set(true);
  pendingSession = (async () => {
    try {
      const data = await getMe();
      user.set(data.user);
    } catch {
      user.set(null);
    } finally {
      authLoading.set(false);
      pendingSession = null;
    }
  })();
  return pendingSession;
}
