import { Elysia } from "elysia";
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@ua/db/client";
import { auditLogs, sessions, studentStatusEnum, students } from "@ua/db/schema";
import { getSession } from "./auth/session";
import { normalizeThaiPhone } from "./auth/google-bind";

/**
 * Student roster administration (staff + admin).
 *
 * Design constraints that are not negotiable here:
 *
 * - A student row is never physically deleted. `requests`, `attachment_uploads`
 *   and `notifications` reference `students.student_id` ON DELETE CASCADE, so a
 *   hard delete would silently destroy the request/attachment history this
 *   feature is required to preserve. "Delete" means `deleted_at = now()`.
 * - `status` and `deleted_at` are independent. Soft delete never changes the
 *   academic status, and restore never changes it back.
 * - A bound Google email (`email_bound_at IS NOT NULL`) is owned by the OAuth
 *   bind flow and is read-only for staff.
 * - Every mutation writes an audit row inside the same transaction as the
 *   mutation itself, so a change can never land without its audit trail.
 * - Roster management is restricted to staff and admin, with equal rights.
 *   Students get 403 on every route below.
 */

type StudentStatus = (typeof studentStatusEnum.enumValues)[number];
type RosterRole = "staff" | "admin";

const ROSTER_ROLES: readonly RosterRole[] = ["admin", "staff"];

const DEFAULT_SORT: SortableStudentField = "studentId";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MIN_ADMISSION_YEAR = 1900;
const MAX_ADMISSION_YEAR = 2900;

const SORTABLE_STUDENT_COLUMNS = {
  studentId: students.studentId,
  firstName: students.firstName,
  lastName: students.lastName,
  major: students.major,
  status: students.status,
  admissionYear: students.admissionYear,
  createdAt: students.createdAt,
  updatedAt: students.updatedAt,
} as const;

type SortableStudentField = keyof typeof SORTABLE_STUDENT_COLUMNS;

function isSortableStudentField(value: string): value is SortableStudentField {
  return Object.prototype.hasOwnProperty.call(SORTABLE_STUDENT_COLUMNS, value);
}

function isStudentStatus(value: string): value is StudentStatus {
  return (studentStatusEnum.enumValues as readonly string[]).includes(value);
}

const ROSTER_ITEM_SELECTION = {
  studentId: students.studentId,
  firstName: students.firstName,
  lastName: students.lastName,
  major: students.major,
  groupName: students.groupName,
  level: students.level,
  admissionYear: students.admissionYear,
  status: students.status,
  email: students.email,
  phone: students.phone,
  avatarUrl: students.avatarUrl,
  emailBoundAt: students.emailBoundAt,
  deletedAt: students.deletedAt,
  createdAt: students.createdAt,
  updatedAt: students.updatedAt,
} as const;

const ROSTER_AUDIT_ACTIONS = [
  "student_create",
  "student_update",
  "student_soft_delete",
  "student_restore",
] as const;

type RosterAuditAction = (typeof ROSTER_AUDIT_ACTIONS)[number];

const AUDIT_TARGET_TYPE = "student";

/** Minimal surface of the Drizzle executor needed by roster audit writes. */
export type RosterAuditExecutor = Pick<typeof db, "insert">;

// --- auth -------------------------------------------------------------------

interface RosterManager {
  id: string;
  role: RosterRole;
}

type RosterGuard =
  | { ok: true; manager: RosterManager }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Staff and admin have equal roster rights. Any student session is rejected
 * with 403, an absent/expired session with 401.
 */
async function requireRosterManager(headers: Record<string, unknown>): Promise<RosterGuard> {
  const user = await getSession(headers);
  if (!user) return { ok: false, status: 401, error: "unauthorized" };
  if (user.role !== "staff" && user.role !== "admin") {
    return { ok: false, status: 403, error: "staff_admin_only" };
  }
  return { ok: true, manager: { id: user.id, role: user.role } };
}

// --- query parsing ----------------------------------------------------------

function readQueryValue(query: Record<string, unknown>, key: string): string | null {
  const raw = query[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function readQueryFlag(query: Record<string, unknown>, key: string): boolean {
  return readQueryValue(query, key)?.trim().toLowerCase() === "true";
}

function readPositiveInt(
  query: Record<string, unknown>,
  key: string,
  fallback: number,
  max?: number,
): number {
  const raw = readQueryValue(query, key);
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return max === undefined ? parsed : Math.min(parsed, max);
}

// --- field parsing ----------------------------------------------------------

function readRequiredText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value === "" ? null : value;
}

function readAdmissionYear(raw: unknown): number | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const value = Number(raw);
  if (!Number.isInteger(value)) return null;
  if (value < MIN_ADMISSION_YEAR || value > MAX_ADMISSION_YEAR) return null;
  return value;
}

/**
 * Roster emails are stored lower-cased because the Google OAuth callback
 * matches `students.email` against a lower-cased provider email. An un-normalised
 * roster email would silently never match its own Google account.
 */
function readEmail(raw: unknown): { value: string | null } | { error: "invalid_email" } {
  if (raw === null || raw === undefined) return { value: null };
  if (typeof raw !== "string") return { error: "invalid_email" };
  const value = raw.trim().toLowerCase();
  if (value === "") return { value: null };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { error: "invalid_email" };
  return { value };
}

function readPhone(raw: unknown): { value: string | null } | { error: "invalid_phone" } {
  if (raw === null || raw === undefined) return { value: null };
  if (typeof raw !== "string") return { error: "invalid_phone" };
  if (raw.trim() === "") return { value: null };
  const normalized = normalizeThaiPhone(raw);
  return normalized === null ? { error: "invalid_phone" } : { value: normalized };
}

function toErrorCode(field: string): string {
  return `invalid_${field.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}`;
}

type PatchFieldKind = "requiredText" | "optionalText" | "admissionYear" | "status" | "email" | "phone";

/**
 * Fields a staff member may edit. `studentId` is the primary key and therefore
 * immutable; `avatarUrl` belongs to the student's own profile route;
 * `importBatchId`, `deletedAt` and `emailBoundAt` are system-owned.
 */
const PATCHABLE_STUDENT_FIELDS: Record<string, PatchFieldKind> = {
  firstName: "requiredText",
  lastName: "requiredText",
  major: "requiredText",
  groupName: "optionalText",
  level: "optionalText",
  admissionYear: "admissionYear",
  status: "status",
  email: "email",
  phone: "phone",
};

type ParsedField =
  | { ok: true; value: string | number | null }
  | { ok: false; error: string };

function parsePatchValue(field: string, kind: PatchFieldKind, raw: unknown): ParsedField {
  const invalid = { ok: false, error: toErrorCode(field) } as const;

  if (kind === "requiredText") {
    const value = readRequiredText(raw);
    return value === null ? invalid : { ok: true, value };
  }
  if (kind === "optionalText") {
    if (raw === null || raw === undefined) return { ok: true, value: null };
    if (typeof raw !== "string") return invalid;
    return { ok: true, value: readRequiredText(raw) };
  }
  if (kind === "admissionYear") {
    const value = readAdmissionYear(raw);
    return value === null ? invalid : { ok: true, value };
  }
  if (kind === "status") {
    const value = readStatus(raw);
    return value === null ? invalid : { ok: true, value };
  }
  if (kind === "email") {
    const parsed = readEmail(raw);
    return "error" in parsed ? invalid : { ok: true, value: parsed.value };
  }
  const parsed = readPhone(raw);
  return "error" in parsed ? invalid : { ok: true, value: parsed.value };
}

function readStatus(raw: unknown): StudentStatus | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  return isStudentStatus(value) ? value : null;
}

// --- errors -----------------------------------------------------------------

const DUPLICATE_STUDENT_CONSTRAINT = "students_pkey";
const DUPLICATE_EMAIL_CONSTRAINT = "students_email_uidx";

/**
 * Drizzle wraps driver errors, so walk the `cause` chain looking for the
 * PostgreSQL unique violation and return the constraint that fired.
 */
function findUniqueViolation(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== "object") return null;
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === "23505" && typeof candidate.constraint === "string") {
      return candidate.constraint;
    }
    current = candidate.cause;
  }
  return null;
}

// --- audit ------------------------------------------------------------------

interface RosterAuditEntry {
  actorStaffId: string;
  action: RosterAuditAction;
  targetId: string;
  metadata: Record<string, unknown> | null;
}

/**
 * Write a roster audit row through the caller's transaction.
 *
 * This deliberately does not swallow failures: an audit write that is allowed
 * to fail turns the audit log into a best-effort log, which is not acceptable
 * for a roster change record.
 */
async function writeRosterAudit(
  executor: RosterAuditExecutor,
  entry: RosterAuditEntry,
): Promise<void> {
  await executor.insert(auditLogs).values({
    id: randomUUID(),
    actorStaffId: entry.actorStaffId,
    action: entry.action,
    targetType: AUDIT_TARGET_TYPE,
    targetId: entry.targetId,
    metadata: entry.metadata,
  });
}

// --- routes -----------------------------------------------------------------

export const roster = new Elysia()
  /**
   * GET /api/roster/students
   *
   * Supports pagination, search, status filter, an `includeDeleted` opt-in and
   * an allow-listed sort. Soft-deleted students are hidden by default.
   */
  .get("/api/roster/students", async ({ headers, query, set }) => {
    const guard = await requireRosterManager(headers);
    if (!guard.ok) {
      set.status = guard.status;
      return { error: guard.error };
    }

    const params = (query ?? {}) as Record<string, unknown>;
    const page = readPositiveInt(params, "page", 1);
    const pageSize = readPositiveInt(params, "pageSize", DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const includeDeleted = readQueryFlag(params, "includeDeleted");
    const search = readQueryValue(params, "search")?.trim() ?? "";
    const statusFilter = readQueryValue(params, "status")?.trim().toLowerCase() ?? "";
    const sortField = readQueryValue(params, "sort")?.trim() ?? "";
    const sortDesc = readQueryValue(params, "order")?.trim().toLowerCase() === "desc";

    if (statusFilter !== "" && !isStudentStatus(statusFilter)) {
      set.status = 400;
      return { error: "invalid_status" };
    }

    const conditions: SQL[] = [];
    if (!includeDeleted) conditions.push(isNull(students.deletedAt));
    if (statusFilter !== "") conditions.push(eq(students.status, statusFilter));

    if (search !== "") {
      const like = `%${search}%`;
      // Phones are stored in the canonical 10-digit form, so also match against
      // a dash-free comparison to keep "081-234" findable.
      const phoneDigits = search.replace(/[\s-]+/g, "");
      conditions.push(sql`(
        ${students.studentId} ILIKE ${like}
        OR ${students.firstName} ILIKE ${like}
        OR ${students.lastName} ILIKE ${like}
        OR ${students.email} ILIKE ${like}
        OR ${students.phone} ILIKE ${like}
        OR replace(${students.phone}, '-', '') ILIKE ${`%${phoneDigits}%`}
      )`);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const sortKey: SortableStudentField = isSortableStudentField(sortField) ? sortField : DEFAULT_SORT;
    const sortColumn = SORTABLE_STUDENT_COLUMNS[sortKey];
    const orderBy = sortDesc ? [desc(sortColumn)] : [asc(sortColumn)];
    // Stable pagination: every non-studentId sort needs a tiebreaker.
    if (sortKey !== "studentId") orderBy.push(asc(students.studentId));

    const countRows = await db
      .select({ n: sql<number>`count(*)` })
      .from(students)
      .where(where);
    const total = Number(countRows[0]?.n ?? 0);

    const items = await db
      .select(ROSTER_ITEM_SELECTION)
      .from(students)
      .where(where)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return { total, page, pageSize, items };
  })

  /**
   * POST /api/roster/students
   *
   * Creates a roster row. `email` here is a roster attribute, not a Google
   * binding, so `email_bound_at` is always left NULL; only the OAuth bind flow
   * may set it.
   */
  .post("/api/roster/students", async ({ headers, body, set }) => {
    const guard = await requireRosterManager(headers);
    if (!guard.ok) {
      set.status = guard.status;
      return { error: guard.error };
    }

    const input = (body ?? {}) as Record<string, unknown>;

    const studentId = readRequiredText(input.studentId);
    if (studentId === null) {
      set.status = 400;
      return { error: "invalid_student_id" };
    }
    const firstName = readRequiredText(input.firstName);
    if (firstName === null) {
      set.status = 400;
      return { error: "invalid_first_name" };
    }
    const lastName = readRequiredText(input.lastName);
    if (lastName === null) {
      set.status = 400;
      return { error: "invalid_last_name" };
    }
    const major = readRequiredText(input.major);
    if (major === null) {
      set.status = 400;
      return { error: "invalid_major" };
    }
    const admissionYear = readAdmissionYear(input.admissionYear);
    if (admissionYear === null) {
      set.status = 400;
      return { error: "invalid_admission_year" };
    }

    const statusValue = input.status === undefined ? "active" : readStatus(input.status);
    if (statusValue === null) {
      set.status = 400;
      return { error: "invalid_status" };
    }

    const parsedEmail = readEmail(input.email);
    if ("error" in parsedEmail) {
      set.status = 400;
      return { error: "invalid_email" };
    }
    const parsedPhone = readPhone(input.phone);
    if ("error" in parsedPhone) {
      set.status = 400;
      return { error: "invalid_phone" };
    }

    const [idTaken] = await db
      .select({ studentId: students.studentId })
      .from(students)
      .where(eq(students.studentId, studentId))
      .limit(1);
    if (idTaken) {
      set.status = 409;
      return { error: "duplicate_student_id" };
    }

    if (parsedEmail.value !== null) {
      const [emailTaken] = await db
        .select({ studentId: students.studentId })
        .from(students)
        .where(eq(students.email, parsedEmail.value))
        .limit(1);
      if (emailTaken) {
        set.status = 409;
        return { error: "duplicate_email" };
      }
    }

    try {
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(students)
          .values({
            studentId,
            firstName,
            lastName,
            major,
            groupName: readRequiredText(input.groupName),
            level: readRequiredText(input.level),
            admissionYear,
            status: statusValue,
            email: parsedEmail.value,
            phone: parsedPhone.value,
          })
          .returning(ROSTER_ITEM_SELECTION);

        await writeRosterAudit(tx, {
          actorStaffId: guard.manager.id,
          action: "student_create",
          targetId: studentId,
          metadata: null,
        });
        return row;
      });

      set.status = 201;
      return created;
    } catch (error) {
      const violation = findUniqueViolation(error);
      if (violation === DUPLICATE_STUDENT_CONSTRAINT) {
        set.status = 409;
        return { error: "duplicate_student_id" };
      }
      if (violation === DUPLICATE_EMAIL_CONSTRAINT) {
        set.status = 409;
        return { error: "duplicate_email" };
      }
      throw error;
    }
  })

  /**
   * PATCH /api/roster/students/:id
   *
   * Updates only the fields present in the body, records only the fields that
   * actually changed in the audit metadata, and refuses to touch a bound email.
   */
  .patch("/api/roster/students/:id", async ({ headers, params, body, set }) => {
    const guard = await requireRosterManager(headers);
    if (!guard.ok) {
      set.status = guard.status;
      return { error: guard.error };
    }

    const studentId = readRequiredText(params.id);
    if (studentId === null) {
      set.status = 400;
      return { error: "invalid_student_id" };
    }

    const input = (body ?? {}) as Record<string, unknown>;

    if (Object.prototype.hasOwnProperty.call(input, "studentId")) {
      set.status = 400;
      return { error: "student_id_immutable" };
    }

    const [current] = await db.select().from(students).where(eq(students.studentId, studentId)).limit(1);
    if (!current) {
      set.status = 404;
      return { error: "student_not_found" };
    }

    if (Object.prototype.hasOwnProperty.call(input, "email") && current.emailBoundAt !== null) {
      set.status = 409;
      return { error: "email_readonly_bound" };
    }

    const patch: Record<string, string | number | null> = {};
    for (const [field, kind] of Object.entries(PATCHABLE_STUDENT_FIELDS)) {
      if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
      const parsed = parsePatchValue(field, kind, input[field]);
      if (!parsed.ok) {
        set.status = 400;
        return { error: parsed.error };
      }
      patch[field] = parsed.value;
    }

    const currentRecord = current as unknown as Record<string, unknown>;
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    for (const [field, value] of Object.entries(patch)) {
      const before = currentRecord[field] ?? null;
      if (before !== value) changes[field] = { old: before, new: value };
    }

    // No field actually differs: nothing to write and nothing to audit.
    if (Object.keys(changes).length === 0) {
      const [unchanged] = await db
        .select(ROSTER_ITEM_SELECTION)
        .from(students)
        .where(eq(students.studentId, studentId))
        .limit(1);
      return unchanged;
    }

    try {
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(students)
          .set({ ...patch, updatedAt: sql`now()` })
          .where(eq(students.studentId, studentId))
          .returning(ROSTER_ITEM_SELECTION);

        await writeRosterAudit(tx, {
          actorStaffId: guard.manager.id,
          action: "student_update",
          targetId: studentId,
          metadata: changes,
        });
        return row;
      });
      return updated;
    } catch (error) {
      if (findUniqueViolation(error) === DUPLICATE_EMAIL_CONSTRAINT) {
        set.status = 409;
        return { error: "duplicate_email" };
      }
      throw error;
    }
  })

  /**
   * DELETE /api/roster/students/:id
   *
   * Soft delete only. The same transaction also revokes every live student
   * session so a soft-deleted student is locked out immediately rather than at
   * their next OAuth login. Requests, attachments and history are untouched:
   * a physical delete would cascade them away via ON DELETE CASCADE.
   */
  .delete("/api/roster/students/:id", async ({ headers, params, set }) => {
    const guard = await requireRosterManager(headers);
    if (!guard.ok) {
      set.status = guard.status;
      return { error: guard.error };
    }

    const studentId = readRequiredText(params.id);
    if (studentId === null) {
      set.status = 400;
      return { error: "invalid_student_id" };
    }

    const [existing] = await db
      .select({ studentId: students.studentId, deletedAt: students.deletedAt })
      .from(students)
      .where(eq(students.studentId, studentId))
      .limit(1);
    if (!existing) {
      set.status = 404;
      return { error: "student_not_found" };
    }
    if (existing.deletedAt !== null) {
      set.status = 409;
      return { error: "student_already_deleted" };
    }

    const softDeleted = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(students)
        .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(eq(students.studentId, studentId), isNull(students.deletedAt)))
        .returning(ROSTER_ITEM_SELECTION);
      if (!row) return null;

      const revoked = await tx
        .delete(sessions)
        .where(and(eq(sessions.userId, studentId), eq(sessions.role, "student")))
        .returning({ id: sessions.id });

      await writeRosterAudit(tx, {
        actorStaffId: guard.manager.id,
        action: "student_soft_delete",
        targetId: studentId,
        metadata: { deletedAt: row.deletedAt, revokedSessions: revoked.length },
      });
      return row;
    });

    if (!softDeleted) {
      set.status = 409;
      return { error: "student_already_deleted" };
    }
    return softDeleted;
  })

  /**
   * POST /api/roster/students/:id/restore
   *
   * Clears `deleted_at` and nothing else. The academic status is preserved
   * exactly as it was, so restoring a withdrawn student still cannot log in.
   * No session is created: the student signs in again through OAuth as usual.
   */
  .post("/api/roster/students/:id/restore", async ({ headers, params, set }) => {
    const guard = await requireRosterManager(headers);
    if (!guard.ok) {
      set.status = guard.status;
      return { error: guard.error };
    }

    const studentId = readRequiredText(params.id);
    if (studentId === null) {
      set.status = 400;
      return { error: "invalid_student_id" };
    }

    const [existing] = await db
      .select({
        studentId: students.studentId,
        deletedAt: students.deletedAt,
        status: students.status,
      })
      .from(students)
      .where(eq(students.studentId, studentId))
      .limit(1);
    if (!existing) {
      set.status = 404;
      return { error: "student_not_found" };
    }
    if (existing.deletedAt === null) {
      set.status = 409;
      return { error: "not_deleted" };
    }

    const restored = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(students)
        .set({ deletedAt: null, updatedAt: sql`now()` })
        .where(and(eq(students.studentId, studentId), isNotNull(students.deletedAt)))
        .returning(ROSTER_ITEM_SELECTION);
      if (!row) return null;

      await writeRosterAudit(tx, {
        actorStaffId: guard.manager.id,
        action: "student_restore",
        targetId: studentId,
        metadata: { previousDeletedAt: existing.deletedAt, status: row.status },
      });
      return row;
    });

    if (!restored) {
      set.status = 409;
      return { error: "not_deleted" };
    }
    return restored;
  });
