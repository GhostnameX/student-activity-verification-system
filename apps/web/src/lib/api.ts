export const API_BASE = import.meta.env.DEV
	? import.meta.env.PUBLIC_API_URL || "http://localhost:3000"
	: "";

const SUPABASE_URL =
	import.meta.env.PUBLIC_SUPABASE_URL || "https://eioaetihyoxzgpqfjkck.supabase.co";

export function avatarUrl(storagePath: string): string {
	return `${SUPABASE_URL}/storage/v1/object/public/avatars/${storagePath}`;
}

interface SessionUserBase {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

export type SessionUser = SessionUserBase & (
  | {
      role: "student";
      studentId: string;
      email: string;
      phone: string | null;
      faculty: string | null;
      admissionYear: number | null;
    }
  | {
      role: "staff" | "admin";
      staffCode: string;
      kind: "main" | "emergency";
    }
);

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
  requestSequence?: number | null;
  requestYear?: number | null;
  requestNumber?: string | null;
  submittedAt: string;
  reviewedAt?: string | null;
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

export async function getRequests(): Promise<RequestItem[]> {
  return apiFetch("/api/requests");
}

export async function getRequest(id: string): Promise<RequestItem> {
  return apiFetch(`/api/requests/${id}`);
}

export async function attachmentUrl(
  attachmentId: string,
  revisionId?: string,
): Promise<string> {
  const query = revisionId ? `?revisionId=${encodeURIComponent(revisionId)}` : "";
  const result = await apiFetch<{ url: string; expiresIn: number }>(
    `/api/attachments/${encodeURIComponent(attachmentId)}/signed-url${query}`,
  );
  return result.url;
}

export interface AttachmentInput {
  slot: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  storagePath: string;
}

export async function createRequest(body: {
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
  staffCode: string;
  fullName: string;
  role: "staff" | "admin";
  isActive: boolean;
  kind: "main" | "emergency";
  createdAt: string;
  updatedAt: string;
}

export interface StaffInput {
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

export type StudentStatus = "active" | "graduated" | "withdrawn";

export type RosterSortField =
  | "studentId"
  | "firstName"
  | "lastName"
  | "major"
  | "status"
  | "admissionYear"
  | "createdAt"
  | "updatedAt";

export interface RosterRecord {
  studentId: string;
  firstName: string;
  lastName: string;
  major: string;
  groupName: string | null;
  level: string | null;
  admissionYear: number;
  status: StudentStatus;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  emailBoundAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RosterListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: RosterRecord[];
}

export interface RosterStudentInput {
  studentId: string;
  firstName: string;
  lastName: string;
  major: string;
  groupName?: string | null;
  level?: string | null;
  admissionYear: number;
  status?: StudentStatus;
  email?: string | null;
  phone?: string | null;
}

export async function getRosterStudents(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: StudentStatus;
  includeDeleted?: boolean;
  sort?: RosterSortField;
  order?: "asc" | "desc";
} = {}): Promise<RosterListResponse> {
  const q = new URLSearchParams();
  if (params.page) q.set("page", String(params.page));
  if (params.pageSize) q.set("pageSize", String(params.pageSize));
  if (params.search) q.set("search", params.search);
  if (params.status) q.set("status", params.status);
  if (params.includeDeleted) q.set("includeDeleted", "true");
  if (params.sort) q.set("sort", params.sort);
  if (params.order) q.set("order", params.order);
  const qs = q.toString();
  return apiFetch(`/api/roster/students${qs ? `?${qs}` : ""}`);
}

export async function createRosterStudent(body: RosterStudentInput): Promise<RosterRecord> {
  return apiFetch("/api/roster/students", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateRosterStudent(
  studentId: string,
  body: Partial<Omit<RosterStudentInput, "studentId">>,
): Promise<RosterRecord> {
  return apiFetch(`/api/roster/students/${encodeURIComponent(studentId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function softDeleteRosterStudent(studentId: string): Promise<RosterRecord> {
  return apiFetch(`/api/roster/students/${encodeURIComponent(studentId)}`, {
    method: "DELETE",
  });
}

export async function restoreRosterStudent(studentId: string): Promise<RosterRecord> {
  return apiFetch(`/api/roster/students/${encodeURIComponent(studentId)}/restore`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export interface StatsResponse {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  byFaculty: {
    faculty: string;
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  }[];
}
