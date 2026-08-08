import { writable } from "svelte/store";
import type { SessionUser } from "./api";
import { getMe } from "./api";

export const user = writable<SessionUser | null>(null);
export const authLoading = writable<boolean>(true);

export async function loadSession(): Promise<void> {
  authLoading.set(true);
  try {
    const data = await getMe();
    user.set(data.user);
  } catch {
    user.set(null);
  } finally {
    authLoading.set(false);
  }
}
