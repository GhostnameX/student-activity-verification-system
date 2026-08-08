import { createAuthClient } from "better-auth/client";
import { API_BASE } from "./api";

export const authClient = createAuthClient({
  baseURL: API_BASE,
});
