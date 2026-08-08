export const API_BASE = import.meta.env.PUBLIC_API_URL || "http://localhost:3000";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  faculty?: string | null;
  studentId?: string | null;
}

export interface Activity {
  id: string;
  title: string;
  titleEn: string;
  type: string;
  organizer: string;
  date: string;
  location: string;
  description?: string | null;
  descriptionEn?: string | null;
}

export type RequestStatus = "pending" | "approved" | "rejected";

export interface RequestItem {
  id: string;
  status: RequestStatus;
  note?: string | null;
  submittedAt: string;
  reviewedAt?: string | null;
  activity: {
    id: string;
    title: string;
    titleEn: string;
    type: string;
    date: string;
  };
  student?: {
    id: string;
    name: string;
    email: string;
    faculty?: string | null;
    studentId?: string | null;
  };
  attachments?: Attachment[];
}

export interface Attachment {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  storagePath: string;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data as any)?.error || `Request failed: ${res.status}`);
  }
  return data as T;
}

export async function getMe(): Promise<{ user: SessionUser | null }> {
  return apiFetch("/api/me");
}

export async function getActivities(): Promise<Activity[]> {
  return apiFetch("/api/activities");
}

export async function getRequests(): Promise<RequestItem[]> {
  return apiFetch("/api/requests");
}

export async function getRequest(id: string): Promise<RequestItem> {
  return apiFetch(`/api/requests/${id}`);
}

export async function createRequest(body: {
  activityId: string;
  note?: string;
  attachments?: {
    fileName: string;
    fileType: string;
    fileSize: number;
    storagePath: string;
  }[];
}): Promise<{ id: string; status: string }> {
  return apiFetch("/api/requests", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function uploadFile(file: File): Promise<Attachment> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/api/upload`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `Upload failed: ${res.status}`);
  }
  return data as Attachment;
}

export async function approveRequest(id: string): Promise<void> {
  await apiFetch(`/api/requests/${id}/approve`, { method: "POST" });
}

export async function rejectRequest(id: string, reason?: string): Promise<void> {
  await apiFetch(`/api/requests/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}
