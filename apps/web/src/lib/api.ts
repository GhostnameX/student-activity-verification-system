export const API_BASE = import.meta.env.DEV
	? import.meta.env.PUBLIC_API_URL || "http://localhost:3000"
	: "";

const SUPABASE_URL =
	import.meta.env.PUBLIC_SUPABASE_URL || "https://eioaetihyoxzgpqfjkck.supabase.co";

export function attachmentUrl(storagePath: string): string {
	return `${SUPABASE_URL}/storage/v1/object/public/request-attachments/${storagePath}`;
}

export function avatarUrl(storagePath: string): string {
	return `${SUPABASE_URL}/storage/v1/object/public/avatars/${storagePath}`;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  faculty?: string | null;
  studentId?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  admissionYear?: number | null;
  kind?: "main" | "emergency" | null;
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
  submissionDeadline?: string | null;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type ActivityInput = {
  title: string;
  titleEn: string;
  type: string;
  organizer: string;
  date: string;
  location: string;
  description?: string | null;
  descriptionEn?: string | null;
  submissionDeadline?: string | null;
  isActive?: boolean;
};

export type RequestStatus = "pending" | "approved" | "rejected" | "revision_required";

export type AttachmentRevisionState = "unchanged" | "needs_revision" | "resubmitted" | "approved";

export interface AttachmentRevision {
  id: string;
  attachmentId: string;
  revisionNumber: number;
  revisionState: AttachmentRevisionState;
  fileName: string;
  fileType: string;
  fileSize: number;
  storagePath: string;
  uploadedAt: string;
}

export interface RequestItem {
  id: string;
  status: RequestStatus;
  note?: string | null;
  rejectionReason?: string | null;
  activityName?: string | null;
  requestSequence?: number | null;
  requestYear?: number | null;
  requestNumber?: string | null;
  submittedAt: string;
  reviewedAt?: string | null;
  activity: {
    id: string;
    title: string;
    titleEn: string;
    type: string;
    date: string;
  } | null;
  student?: {
    id: string;
    name: string;
    email: string;
    faculty?: string | null;
    studentId?: string | null;
  };
  attachments?: Attachment[];
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  requestId?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface AuditLogItem {
  id: string;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface Attachment {
  id: string;
  slot?: number | null;
  currentRevisionId?: string | null;
  fileName: string;
  fileType: string;
  fileSize: number;
  storagePath: string;
  revisions?: AttachmentRevision[];
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

export async function updateMe(body: { phone?: string; name?: string }): Promise<{
  phone?: string | null;
  name?: string | null;
}> {
  return apiFetch("/api/me", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function uploadAvatar(file: File): Promise<{ avatarUrl: string; url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/api/me/avatar`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `Upload failed: ${res.status}`);
  }
  return data as { avatarUrl: string; url: string };
}

export async function removeAvatar(): Promise<{ ok: boolean }> {
  return apiFetch("/api/me/avatar", { method: "DELETE" });
}

export async function changePassword(body: {
  currentPassword: string;
  newPassword: string;
}): Promise<{ ok: boolean }> {
  return apiFetch("/api/me/password", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getActivities(includeInactive = false): Promise<Activity[]> {
  return apiFetch(`/api/activities${includeInactive ? "?includeInactive=true" : ""}`);
}

export async function createActivity(body: ActivityInput): Promise<Activity> {
  return apiFetch("/api/activities", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateActivity(
  id: string,
  body: Partial<ActivityInput>,
): Promise<Activity> {
  return apiFetch(`/api/activities/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteActivity(id: string): Promise<Activity> {
  return apiFetch(`/api/activities/${id}`, { method: "DELETE" });
}

export async function getRequests(): Promise<RequestItem[]> {
  return apiFetch("/api/requests");
}

export async function getRequest(id: string): Promise<RequestItem> {
  return apiFetch(`/api/requests/${id}`);
}

export interface AttachmentInput {
  slot: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  storagePath: string;
}

export async function createRequest(body: {
  activityId?: string;
  note?: string;
  attachments?: AttachmentInput[];
}): Promise<{ id: string; status: string; requestNumber?: string | null }> {
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
  await apiFetch(`/api/requests/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function rejectRequest(id: string, reason?: string): Promise<void> {
  await apiFetch(`/api/requests/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function requestRevisionRequest(id: string, slots: number[]): Promise<void> {
  await apiFetch(`/api/requests/${id}/request-revision`, {
    method: "POST",
    body: JSON.stringify({ slots }),
  });
}

export async function resubmitRequest(
  id: string,
  attachments: AttachmentInput[],
): Promise<void> {
  await apiFetch(`/api/requests/${id}/resubmit`, {
    method: "POST",
    body: JSON.stringify({ attachments }),
  });
}

export async function getNotifications(): Promise<NotificationItem[]> {
  return apiFetch("/api/notifications");
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiFetch(`/api/notifications/${id}/read`, { method: "POST" });
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiFetch("/api/notifications/read-all", { method: "POST" });
}

export async function getAuditLogs(): Promise<AuditLogItem[]> {
  return apiFetch("/api/audit");
}

export interface StaffMember {
  id: string;
  email: string;
  staffCode: string;
  fullName: string;
  role: "staff" | "admin";
  isActive: boolean;
  kind: "main" | "emergency";
  createdAt: string;
  updatedAt: string;
}

export interface StaffInput {
  email?: string;
  staffCode: string;
  fullName: string;
  password?: string;
  role?: "staff" | "admin";
  kind?: "main" | "emergency";
  isActive?: boolean;
}

export async function getStaffList(): Promise<StaffMember[]> {
  return apiFetch("/api/admin/staff");
}

export async function createStaff(body: StaffInput): Promise<StaffMember> {
  return apiFetch("/api/admin/staff", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateStaff(
  id: string,
  body: Partial<StaffInput>,
): Promise<StaffMember> {
  return apiFetch(`/api/admin/staff/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function getStats(): Promise<StatsResponse> {
  return apiFetch("/api/stats");
}

export interface MajorSubmissionStats {
  major: string;
  total: number;
  submitted: number;
  notSubmitted: number;
  rate: number;
  groups: string[];
}

export interface SubmissionStats {
  total: number;
  submitted: number;
  notSubmitted: number;
  rate: number;
  byMajor: MajorSubmissionStats[];
}

export async function getSubmissionStats(): Promise<SubmissionStats> {
  return apiFetch("/api/stats/submission");
}

export interface RosterStudent {
  studentId: string;
  firstName: string;
  lastName: string;
  major: string;
  groupName: string;
  level: string;
}

export interface NotSubmittedList {
  total: number;
  page: number;
  pageSize: number;
  items: RosterStudent[];
}

export async function getNotSubmitted(params: {
  major?: string;
  group?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<NotSubmittedList> {
  const q = new URLSearchParams();
  if (params.major) q.set("major", params.major);
  if (params.group) q.set("group", params.group);
  if (params.search) q.set("search", params.search);
  if (params.page) q.set("page", String(params.page));
  if (params.pageSize) q.set("pageSize", String(params.pageSize));
  const qs = q.toString();
  return apiFetch(`/api/roster/not-submitted${qs ? `?${qs}` : ""}`);
}

export interface StatsResponse {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  byActivity: {
    id: string;
    title: string;
    titleEn: string;
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  }[];
  byFaculty: {
    faculty: string;
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  }[];
}
