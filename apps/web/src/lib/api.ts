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

export interface RevisionNote {
  id: string;
  note: string;
  slots: number[];
  createdAt: string;
  /** Staff/admin only; null for the student (the UI shows a generic "staff" label). */
  authorName: string | null;
}

/** Same limit as the API (REVISION_NOTE_MAX_LENGTH). */
export const REVISION_NOTE_MAX_LENGTH = 1000;

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
  /** Staff document check (round 2). Only the time reaches students; the name is for staff/admin. */
  staffCheckedAt?: string | null;
  staffCheckedByName?: string | null;
  student?: {
    id: string;
    name: string;
    email: string | null;
    faculty?: string | null;
    studentId?: string | null;
  };
  attachments?: Attachment[];
  /** Reasons given when the request was sent back for revision, newest first (detail only). */
  revisionNotes?: RevisionNote[];
  /** Student list only: the latest reason for a request that was sent back (no author). */
  latestRevisionNote?: { note: string; slots: number[]; createdAt: string } | null;
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
  actorStaffId?: string | null;
  actorName?: string | null;
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

export async function getRequests(status?: RequestStatus): Promise<RequestItem[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch(`/api/requests${query}`);
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

export async function staffCheckRequest(
  id: string,
): Promise<{ id: string; staffCheckedAt: string }> {
  return apiFetch(`/api/requests/${encodeURIComponent(id)}/staff-check`, {
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

export async function requestRevisionRequest(id: string, slots: number[], note: string): Promise<void> {
  await apiFetch(`/api/requests/${id}/request-revision`, {
    method: "POST",
    body: JSON.stringify({ slots, note }),
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

/** Query value for the group filter that means "students without a group". */
export const NO_GROUP = "__none__";

export interface GroupSubmissionStats {
  /** null = students without a group. */
  groupName: string | null;
  total: number;
  submitted: number;
  notSubmitted: number;
  rate: number;
}

export interface MajorSubmissionStats {
  major: string;
  total: number;
  submitted: number;
  notSubmitted: number;
  rate: number;
  /** Named groups only, natural-sorted. */
  groups: string[];
  /** Every group (null group last), natural-sorted. */
  groupStats: GroupSubmissionStats[];
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
  groupName: string | null;
  level: string | null;
  /** Only set for students who have submitted. */
  latestStatus?: RequestStatus | null;
  latestSubmittedAt?: string | null;
}

export type SubmissionState = "submitted" | "not_submitted";

export interface SubmissionList {
  total: number;
  page: number;
  pageSize: number;
  items: RosterStudent[];
}

export async function getSubmissionList(
  state: SubmissionState,
  params: {
    major?: string;
    group?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  },
): Promise<SubmissionList> {
  const q = new URLSearchParams();
  if (params.major) q.set("major", params.major);
  if (params.group) q.set("group", params.group);
  if (params.search) q.set("search", params.search);
  if (params.page) q.set("page", String(params.page));
  if (params.pageSize) q.set("pageSize", String(params.pageSize));
  const qs = q.toString();
  const path = state === "submitted" ? "submitted" : "not-submitted";
  return apiFetch(`/api/roster/${path}${qs ? `?${qs}` : ""}`);
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

export interface RosterQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: StudentStatus;
  includeDeleted?: boolean;
  sort?: RosterSortField;
  order?: "asc" | "desc";
}

function rosterQuery(params: RosterQueryParams, includePagination: boolean): string {
  const q = new URLSearchParams();
  if (includePagination && params.page) q.set("page", String(params.page));
  if (includePagination && params.pageSize) q.set("pageSize", String(params.pageSize));
  if (params.search) q.set("search", params.search);
  if (params.status) q.set("status", params.status);
  if (params.includeDeleted) q.set("includeDeleted", "true");
  if (params.sort) q.set("sort", params.sort);
  if (params.order) q.set("order", params.order);
  return q.toString();
}

export async function getRosterStudents(params: RosterQueryParams = {}): Promise<RosterListResponse> {
  const qs = rosterQuery(params, true);
  return apiFetch(`/api/roster/students${qs ? `?${qs}` : ""}`);
}

export async function exportRosterCsv(
  params: Omit<RosterQueryParams, "page" | "pageSize"> = {},
): Promise<{ blob: Blob; filename: string }> {
  const qs = rosterQuery(params, false);
  const response = await fetch(`${API_BASE}/api/roster/export.csv${qs ? `?${qs}` : ""}`, {
    credentials: "include",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(data?.error ?? `request_failed_${response.status}`);
  }

  const disposition = response.headers.get("content-disposition") ?? "";
  const serverName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const filename = serverName?.replace(/[\\/:*?"<>|]/g, "") || "student-roster.csv";
  return { blob: await response.blob(), filename };
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

export type BulkRosterConflictReason = "duplicate_id" | "already_deleted" | "already_active";
export type BulkRosterFailureReason = "student_not_found" | "transaction_failed";

export interface BulkRosterResult {
  requested: string[];
  succeeded: string[];
  conflicted: Array<{ studentId: string; reason: BulkRosterConflictReason }>;
  failed: Array<{ studentId: string; reason: BulkRosterFailureReason }>;
}

export async function bulkDeleteRosterStudents(studentIds: string[]): Promise<BulkRosterResult> {
  return apiFetch("/api/roster/students/bulk-delete", {
    method: "POST",
    body: JSON.stringify({ studentIds }),
  });
}

export async function bulkRestoreRosterStudents(studentIds: string[]): Promise<BulkRosterResult> {
  return apiFetch("/api/roster/students/bulk-restore", {
    method: "POST",
    body: JSON.stringify({ studentIds }),
  });
}

export type RosterImportClassification = "new" | "unchanged" | "update" | "conflict" | "invalid";

export interface RosterImportStudent {
  studentId: string;
  firstName: string;
  lastName: string;
  major: string;
  groupName: string;
  level: string;
  admissionYear: number;
  status: StudentStatus;
  email: string | null;
  phone: string | null;
}

export interface RosterImportSnapshot extends RosterImportStudent {
  deletedAt: string | null;
  emailBoundAt: string | null;
  updatedAt: string;
}

export interface RosterImportRow {
  rowNumber: number;
  studentId: string | null;
  classification: RosterImportClassification;
  current: RosterImportSnapshot | null;
  proposed: Partial<RosterImportStudent> | null;
  changedFields: Array<keyof RosterImportStudent>;
  warnings: string[];
  errors: string[];
}

export interface RosterImportSummary {
  total: number;
  valid: number;
  new: number;
  updates: number;
  unchanged: number;
  conflicts: number;
  invalid: number;
}

export interface RosterImportPreview {
  batchId: string;
  fileName: string;
  status: "validated" | "invalid";
  limits: { maxFileBytes: number; maxRows: number; maxWorksheets: number };
  ignoredHeaders: string[];
  summary: RosterImportSummary;
  rows: RosterImportRow[];
}

export interface RosterImportCommitResult {
  kind: "ok";
  batchId: string;
  created: number;
  updated: number;
  unchanged: number;
}

export class RosterImportApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown>,
  ) {
    super(code);
  }
}

async function rosterImportResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const code = typeof data?.error === "string" ? data.error : `request_failed_${response.status}`;
    throw new RosterImportApiError(response.status, code, data ?? {});
  }
  return data as T;
}

export async function previewRosterImport(file: File): Promise<RosterImportPreview> {
  const formData = new FormData();
  formData.set("file", file);
  const response = await fetch(`${API_BASE}/api/roster/import/preview`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  return rosterImportResponse<RosterImportPreview>(response);
}

export async function commitRosterImport(batchId: string): Promise<RosterImportCommitResult> {
  const response = await fetch(`${API_BASE}/api/roster/import/${encodeURIComponent(batchId)}/commit`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return rosterImportResponse<RosterImportCommitResult>(response);
}

export interface StatsResponse {
  total: number;
  pending: number;
  revisionRequired: number;
  approved: number;
  rejected: number;
  byFaculty: {
    faculty: string;
    total: number;
    pending: number;
    revisionRequired: number;
    approved: number;
    rejected: number;
  }[];
}
