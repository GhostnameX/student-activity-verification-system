import { randomUUID } from "crypto";
import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";
import { Elysia } from "elysia";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@ua/db/client";
import {
  auditLogs,
  importBatchItems,
  importBatches,
  studentStatusEnum,
  students,
} from "@ua/db/schema";
import { getSession } from "./auth/session";
import { normalizeThaiPhone } from "./auth/google-bind";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 500;
const MAX_WORKSHEETS = 10;
const MAX_COLUMNS = 32;
const MAX_CELL_LENGTH = 500;
const PREVIEW_RETENTION_HOURS = 24;

type StudentStatus = (typeof studentStatusEnum.enumValues)[number];
type ImportClassification = "new" | "unchanged" | "update" | "conflict" | "invalid";

const IMPORT_FIELDS = [
  "studentId",
  "firstName",
  "lastName",
  "major",
  "groupName",
  "level",
  "admissionYear",
  "status",
  "email",
  "phone",
] as const;
type ImportField = (typeof IMPORT_FIELDS)[number];

const REQUIRED_FIELDS: readonly ImportField[] = [
  "studentId",
  "firstName",
  "lastName",
  "major",
  "groupName",
  "level",
  "admissionYear",
];

const HEADER_ALIASES: Readonly<Record<string, ImportField>> = {
  studentId: "studentId",
  student_id: "studentId",
  firstName: "firstName",
  first_name: "firstName",
  lastName: "lastName",
  last_name: "lastName",
  major: "major",
  groupName: "groupName",
  group_name: "groupName",
  level: "level",
  admissionYear: "admissionYear",
  admission_year: "admissionYear",
  status: "status",
  email: "email",
  phone: "phone",
};

interface ParsedSheet {
  rows: unknown[][];
  worksheetCount: number;
}

interface HeaderMap {
  columns: Map<ImportField, number>;
  ignoredHeaders: string[];
}

interface NormalizedStudent {
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

interface RowDraft {
  rowNumber: number;
  partial: Partial<NormalizedStudent>;
  hasStatus: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  errors: string[];
}

interface StudentSnapshot extends NormalizedStudent {
  deletedAt: string | null;
  emailBoundAt: string | null;
  updatedAt: string;
}

interface PreviewRow {
  rowNumber: number;
  studentId: string | null;
  classification: ImportClassification;
  current: StudentSnapshot | null;
  proposed: Partial<NormalizedStudent> | null;
  changedFields: ImportField[];
  warnings: string[];
  errors: string[];
}

interface StoredImportItem {
  studentId: string;
  action: "inserted" | "updated";
  beforeData: StudentSnapshot | null;
  afterData: NormalizedStudent;
}

class ImportRequestError extends Error {
  constructor(
    readonly status: 400 | 413,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
  }
}

class CommitConflictError extends Error {
  constructor(readonly conflicts: Array<{ studentId: string; reason: string }>) {
    super("stale_preview");
  }
}

function isStudentStatus(value: string): value is StudentStatus {
  return (studentStatusEnum.enumValues as readonly string[]).includes(value);
}

async function requireRosterManager(headers: Record<string, unknown>) {
  const user = await getSession(headers);
  if (!user) return { ok: false as const, status: 401 as const, error: "unauthorized" };
  if (user.role !== "staff" && user.role !== "admin") {
    return { ok: false as const, status: 403 as const, error: "staff_admin_only" };
  }
  return { ok: true as const, manager: { id: user.id, role: user.role } };
}

function cleanFileName(value: string): string {
  return value.replace(/^.*[/\\]/, "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || "roster-import";
}

function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  throw new ImportRequestError(400, "unsupported_cell_value");
}

function hasFormula(value: unknown): boolean {
  return typeof value === "object" && value !== null && "formula" in value;
}

function excelCellValue(value: ExcelJS.CellValue): unknown {
  if (value === null) return null;
  if (hasFormula(value)) throw new ImportRequestError(400, "formula_cells_not_supported");
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("text" in value && typeof value.text === "string") return value.text;
    throw new ImportRequestError(400, "unsupported_cell_value");
  }
  return value;
}

async function parseUpload(file: File): Promise<ParsedSheet> {
  if (file.size > MAX_FILE_BYTES) throw new ImportRequestError(413, "file_too_large", { maxBytes: MAX_FILE_BYTES });
  const name = file.name.toLowerCase();
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  if (name.endsWith(".csv")) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new ImportRequestError(400, "unsupported_csv_encoding");
    }
    try {
      const rows = parseCsv(text, {
        bom: true,
        columns: false,
        relax_column_count: false,
        skip_empty_lines: true,
        max_record_size: 100_000,
      }) as unknown[][];
      return { rows, worksheetCount: 1 };
    } catch {
      throw new ImportRequestError(400, "malformed_csv");
    }
  }

  if (name.endsWith(".xlsx")) {
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new ImportRequestError(400, "invalid_xlsx_signature");
    }
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(arrayBuffer);
    } catch {
      throw new ImportRequestError(400, "malformed_xlsx");
    }
    if (workbook.worksheets.length === 0) throw new ImportRequestError(400, "empty_workbook");
    if (workbook.worksheets.length > MAX_WORKSHEETS) {
      throw new ImportRequestError(400, "too_many_worksheets", { maxWorksheets: MAX_WORKSHEETS });
    }
    const worksheet = workbook.worksheets[0];
    const rows: unknown[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const values: unknown[] = [];
      const maxColumn = Math.min(row.cellCount, MAX_COLUMNS + 1);
      for (let index = 1; index <= maxColumn; index += 1) {
        values.push(excelCellValue(row.getCell(index).value));
      }
      if (values.some((value) => cellText(value) !== null && cellText(value) !== "")) rows.push(values);
    });
    return { rows, worksheetCount: workbook.worksheets.length };
  }

  throw new ImportRequestError(400, "unsupported_file_type");
}

function mapHeaders(row: unknown[]): HeaderMap {
  if (row.length > MAX_COLUMNS) throw new ImportRequestError(400, "too_many_columns", { maxColumns: MAX_COLUMNS });
  const columns = new Map<ImportField, number>();
  const duplicates = new Set<ImportField>();
  const ignoredHeaders: string[] = [];

  row.forEach((raw, index) => {
    const header = cellText(raw);
    if (!header) return;
    if (header.length > MAX_CELL_LENGTH) throw new ImportRequestError(400, "header_too_long");
    const field = HEADER_ALIASES[header];
    if (!field) {
      ignoredHeaders.push(header);
      return;
    }
    if (columns.has(field)) duplicates.add(field);
    else columns.set(field, index);
  });

  if (duplicates.size > 0) {
    throw new ImportRequestError(400, "ambiguous_headers", { fields: [...duplicates] });
  }
  const missing = REQUIRED_FIELDS.filter((field) => !columns.has(field));
  if (missing.length > 0) throw new ImportRequestError(400, "missing_required_headers", { fields: missing });
  return { columns, ignoredHeaders };
}

function rawField(row: unknown[], headers: HeaderMap, field: ImportField): unknown {
  const index = headers.columns.get(field);
  return index === undefined ? undefined : row[index];
}

function requiredText(value: unknown, field: ImportField, errors: string[]): string | undefined {
  if (typeof value !== "string") {
    errors.push(`invalid_${field}`);
    return undefined;
  }
  const text = value.trim();
  if (!text) {
    errors.push(`missing_${field}`);
    return undefined;
  }
  if (text.length > MAX_CELL_LENGTH) {
    errors.push(`too_long_${field}`);
    return undefined;
  }
  return text;
}

function normalizeRow(row: unknown[], headers: HeaderMap, rowNumber: number): RowDraft {
  const errors: string[] = [];
  const partial: Partial<NormalizedStudent> = {};
  const studentRaw = rawField(row, headers, "studentId");
  if (typeof studentRaw !== "string") errors.push("student_id_must_be_text");
  else {
    const value = studentRaw.trim();
    if (!value) errors.push("missing_studentId");
    else if (value.length > MAX_CELL_LENGTH) errors.push("too_long_studentId");
    else partial.studentId = value;
  }

  for (const field of ["firstName", "lastName", "major", "groupName", "level"] as const) {
    const value = requiredText(rawField(row, headers, field), field, errors);
    if (value !== undefined) partial[field] = value;
  }

  const admissionRaw = rawField(row, headers, "admissionYear");
  const admissionText = typeof admissionRaw === "number" || typeof admissionRaw === "string"
    ? String(admissionRaw).trim()
    : "";
  const admissionYear = Number(admissionText);
  if (!/^\d+$/.test(admissionText) || !Number.isInteger(admissionYear) || admissionYear < 1900 || admissionYear > 2900) {
    errors.push("invalid_admissionYear");
  } else partial.admissionYear = admissionYear;

  const hasStatus = headers.columns.has("status");
  const statusText = cellText(rawField(row, headers, "status"))?.toLowerCase() ?? "";
  if (statusText) {
    if (isStudentStatus(statusText)) partial.status = statusText;
    else errors.push("invalid_status");
  }

  const hasEmail = headers.columns.has("email");
  if (hasEmail) {
    const email = cellText(rawField(row, headers, "email"))?.toLowerCase() ?? "";
    if (!email) partial.email = null;
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("invalid_email");
    else partial.email = email;
  }

  const hasPhone = headers.columns.has("phone");
  if (hasPhone) {
    const phone = cellText(rawField(row, headers, "phone")) ?? "";
    if (!phone) partial.phone = null;
    else {
      const normalized = normalizeThaiPhone(phone);
      if (normalized === null) errors.push("invalid_phone");
      else partial.phone = normalized;
    }
  }
  return { rowNumber, partial, hasStatus, hasEmail, hasPhone, errors };
}

function snapshot(row: typeof students.$inferSelect): StudentSnapshot {
  return {
    studentId: row.studentId,
    firstName: row.firstName,
    lastName: row.lastName,
    major: row.major,
    groupName: row.groupName ?? "",
    level: row.level ?? "",
    admissionYear: row.admissionYear,
    status: row.status,
    email: row.email,
    phone: row.phone,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    emailBoundAt: row.emailBoundAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function proposedStudent(draft: RowDraft, current?: typeof students.$inferSelect): NormalizedStudent | null {
  const p = draft.partial;
  if (
    !p.studentId || !p.firstName || !p.lastName || !p.major ||
    !p.groupName || !p.level || p.admissionYear === undefined
  ) return null;
  return {
    studentId: p.studentId,
    firstName: p.firstName,
    lastName: p.lastName,
    major: p.major,
    groupName: p.groupName,
    level: p.level,
    admissionYear: p.admissionYear,
    status: draft.hasStatus && p.status ? p.status : current?.status ?? "active",
    email: draft.hasEmail ? p.email ?? null : current?.email ?? null,
    phone: draft.hasPhone ? p.phone ?? null : current?.phone ?? null,
  };
}

function changedFields(current: StudentSnapshot, proposed: NormalizedStudent): ImportField[] {
  return IMPORT_FIELDS.filter((field) => current[field] !== proposed[field]);
}

function sameSnapshot(current: StudentSnapshot, stored: StudentSnapshot): boolean {
  return current.studentId === stored.studentId &&
    current.firstName === stored.firstName &&
    current.lastName === stored.lastName &&
    current.major === stored.major &&
    current.groupName === stored.groupName &&
    current.level === stored.level &&
    current.admissionYear === stored.admissionYear &&
    current.status === stored.status &&
    current.email === stored.email &&
    current.phone === stored.phone &&
    current.deletedAt === stored.deletedAt &&
    current.emailBoundAt === stored.emailBoundAt &&
    current.updatedAt === stored.updatedAt;
}

async function writeAudit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  values: { actorStaffId: string; action: string; targetType: string; targetId: string; metadata: Record<string, unknown> },
) {
  await tx.insert(auditLogs).values({
    id: randomUUID(),
    actorStaffId: values.actorStaffId,
    action: values.action,
    targetType: values.targetType,
    targetId: values.targetId,
    metadata: values.metadata,
  });
}

async function classifyRows(drafts: RowDraft[]): Promise<{ rows: PreviewRow[]; items: StoredImportItem[] }> {
  const idCounts = new Map<string, number>();
  const emailCounts = new Map<string, number>();
  for (const draft of drafts) {
    const id = draft.partial.studentId;
    const email = draft.partial.email;
    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    if (email) emailCounts.set(email, (emailCounts.get(email) ?? 0) + 1);
  }

  for (const draft of drafts) {
    const id = draft.partial.studentId;
    const email = draft.partial.email;
    if (id && (idCounts.get(id) ?? 0) > 1) draft.errors.push("duplicate_student_id_in_file");
    if (email && (emailCounts.get(email) ?? 0) > 1) draft.errors.push("duplicate_email_in_file");
  }

  const ids = [...idCounts.keys()];
  const emails = [...emailCounts.keys()];
  const existing = ids.length === 0 && emails.length === 0
    ? []
    : await db.select().from(students).where(or(
        ids.length > 0 ? inArray(students.studentId, ids) : undefined,
        emails.length > 0 ? inArray(students.email, emails) : undefined,
      ));
  const byId = new Map(existing.map((row) => [row.studentId, row]));
  const byEmail = new Map(existing.filter((row) => row.email !== null).map((row) => [row.email!, row]));
  const rows: PreviewRow[] = [];
  const items: StoredImportItem[] = [];

  for (const draft of drafts) {
    const id = draft.partial.studentId ?? null;
    const current = id ? byId.get(id) : undefined;
    const proposed = proposedStudent(draft, current);
    const errors = [...new Set(draft.errors)];
    if (errors.length > 0 || proposed === null) {
      rows.push({ rowNumber: draft.rowNumber, studentId: id, classification: "invalid", current: current ? snapshot(current) : null, proposed: draft.partial, changedFields: [], warnings: [], errors });
      continue;
    }

    const conflicts: string[] = [];
    if (current?.deletedAt) conflicts.push("existing_student_soft_deleted");
    if (current?.emailBoundAt && proposed.email !== current.email) conflicts.push("bound_email_readonly");
    if (proposed.email) {
      const owner = byEmail.get(proposed.email);
      if (owner && owner.studentId !== proposed.studentId) conflicts.push("email_conflicts_with_existing_student");
    }
    const currentSnapshot = current ? snapshot(current) : null;
    const changes = currentSnapshot ? changedFields(currentSnapshot, proposed) : [];
    const classification: ImportClassification = conflicts.length > 0
      ? "conflict"
      : !current
        ? "new"
        : changes.length === 0
          ? "unchanged"
          : "update";
    rows.push({ rowNumber: draft.rowNumber, studentId: proposed.studentId, classification, current: currentSnapshot, proposed, changedFields: changes, warnings: [], errors: conflicts });
    if (classification === "new" || classification === "update") {
      items.push({
        studentId: proposed.studentId,
        action: classification === "new" ? "inserted" : "updated",
        beforeData: currentSnapshot,
        afterData: proposed,
      });
    }
  }
  return { rows, items };
}

function summarize(rows: PreviewRow[]) {
  const count = (classification: ImportClassification) => rows.filter((row) => row.classification === classification).length;
  const summary = {
    total: rows.length,
    new: count("new"),
    updates: count("update"),
    unchanged: count("unchanged"),
    conflicts: count("conflict"),
    invalid: count("invalid"),
    valid: 0,
  };
  summary.valid = summary.new + summary.updates + summary.unchanged;
  return summary;
}

function importValues(data: NormalizedStudent, batchId: string) {
  return {
    studentId: data.studentId,
    firstName: data.firstName,
    lastName: data.lastName,
    major: data.major,
    groupName: data.groupName,
    level: data.level,
    admissionYear: data.admissionYear,
    status: data.status,
    email: data.email,
    phone: data.phone,
    importBatchId: batchId,
  };
}

export const rosterImport = new Elysia()
  .post("/api/roster/import/preview", async ({ headers, body, set }) => {
    const guard = await requireRosterManager(headers);
    if (!guard.ok) {
      set.status = guard.status;
      return { error: guard.error };
    }
    try {
      const file = (body as { file?: unknown } | null)?.file;
      if (!(file instanceof File)) {
        set.status = 400;
        return { error: "file_required" };
      }
      const parsed = await parseUpload(file);
      if (parsed.rows.length < 2) throw new ImportRequestError(400, "no_data_rows");
      if (parsed.rows.length - 1 > MAX_ROWS) {
        throw new ImportRequestError(400, "too_many_rows", { maxRows: MAX_ROWS });
      }
      const headerMap = mapHeaders(parsed.rows[0]);
      const drafts = parsed.rows.slice(1).map((row, index) => normalizeRow(row, headerMap, index + 2));
      const classified = await classifyRows(drafts);
      const summary = summarize(classified.rows);
      const batchId = randomUUID();
      const status = summary.conflicts > 0 || summary.invalid > 0 ? "invalid" : "validated";
      const fileName = cleanFileName(file.name);

      await db.transaction(async (tx) => {
        await tx.insert(importBatches).values({
          id: batchId,
          fileName,
          totalRows: summary.total,
          importedRows: 0,
          status,
          importedBy: guard.manager.id,
        });
        if (classified.items.length > 0) {
          await tx.insert(importBatchItems).values(classified.items.map((item) => ({
            id: randomUUID(),
            batchId,
            studentId: item.studentId,
            action: item.action,
            beforeData: item.beforeData,
            afterData: item.afterData,
          })));
        }
        await writeAudit(tx, {
          actorStaffId: guard.manager.id,
          action: "roster_import_preview",
          targetType: "import_batch",
          targetId: batchId,
          metadata: { fileName, worksheetCount: parsed.worksheetCount, summary, outcome: status },
        });
        await tx.delete(importBatches).where(and(
          inArray(importBatches.status, ["validated", "invalid"]),
          sql`${importBatches.createdAt} < now() - (${PREVIEW_RETENTION_HOURS} * interval '1 hour')`,
        ));
      });

      return {
        batchId,
        fileName,
        status,
        limits: { maxFileBytes: MAX_FILE_BYTES, maxRows: MAX_ROWS, maxWorksheets: MAX_WORKSHEETS },
        ignoredHeaders: headerMap.ignoredHeaders,
        summary,
        rows: classified.rows,
      };
    } catch (error) {
      if (error instanceof ImportRequestError) {
        set.status = error.status;
        return { error: error.code, ...(error.details ?? {}) };
      }
      throw error;
    }
  })
  .post("/api/roster/import/:batchId/commit", async ({ headers, params, set }) => {
    const guard = await requireRosterManager(headers);
    if (!guard.ok) {
      set.status = guard.status;
      return { error: guard.error };
    }
    const batchId = params.batchId?.trim();
    if (!batchId) {
      set.status = 400;
      return { error: "invalid_batch_id" };
    }

    try {
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM import_batches WHERE id = ${batchId} FOR UPDATE`);
        const [batch] = await tx.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1);
        if (!batch) return { kind: "missing" as const };
        if (batch.status === "committed" || batch.status === "completed") return { kind: "committed" as const };
        if (batch.status !== "validated") return { kind: "invalid" as const };

        const items = await tx.select().from(importBatchItems).where(eq(importBatchItems.batchId, batchId));
        const stored = items.map((item) => ({
          ...item,
          beforeData: item.beforeData as StudentSnapshot | null,
          afterData: item.afterData as NormalizedStudent,
        }));
        const ids = stored.map((item) => item.studentId);
        const emails = stored.map((item) => item.afterData.email).filter((email): email is string => email !== null);
        const currentRows = ids.length === 0 && emails.length === 0
          ? []
          : await tx
              .select()
              .from(students)
              .where(or(
                ids.length > 0 ? inArray(students.studentId, ids) : undefined,
                emails.length > 0 ? inArray(students.email, emails) : undefined,
              ))
              .for("update");
        const byId = new Map(currentRows.map((row) => [row.studentId, row]));
        const byEmail = new Map(currentRows.filter((row) => row.email !== null).map((row) => [row.email!, row]));
        const conflicts: Array<{ studentId: string; reason: string }> = [];

        for (const item of stored) {
          const current = byId.get(item.studentId);
          const emailOwner = item.afterData.email ? byEmail.get(item.afterData.email) : undefined;
          if (item.action === "inserted") {
            if (current) conflicts.push({ studentId: item.studentId, reason: "student_created_after_preview" });
          } else if (!current) conflicts.push({ studentId: item.studentId, reason: "student_missing_after_preview" });
          else if (item.beforeData === null || !sameSnapshot(snapshot(current), item.beforeData)) {
            conflicts.push({ studentId: item.studentId, reason: "student_changed_after_preview" });
          }
          if (current?.deletedAt) conflicts.push({ studentId: item.studentId, reason: "student_deleted_after_preview" });
          if (current?.emailBoundAt && current.email !== item.afterData.email) {
            conflicts.push({ studentId: item.studentId, reason: "email_bound_after_preview" });
          }
          if (emailOwner && emailOwner.studentId !== item.studentId) {
            conflicts.push({ studentId: item.studentId, reason: "email_taken_after_preview" });
          }
        }
        if (conflicts.length > 0) throw new CommitConflictError(conflicts);

        let created = 0;
        let updated = 0;
        for (const item of stored) {
          if (item.action === "inserted") {
            await tx.insert(students).values(importValues(item.afterData, batchId));
            created += 1;
            await writeAudit(tx, {
              actorStaffId: guard.manager.id,
              action: "student_import_create",
              targetType: "student",
              targetId: item.studentId,
              metadata: { batchId, after: item.afterData },
            });
          } else {
            await tx.update(students)
              .set({
                firstName: item.afterData.firstName,
                lastName: item.afterData.lastName,
                major: item.afterData.major,
                groupName: item.afterData.groupName,
                level: item.afterData.level,
                admissionYear: item.afterData.admissionYear,
                status: item.afterData.status,
                email: item.afterData.email,
                phone: item.afterData.phone,
                importBatchId: batchId,
                updatedAt: sql`now()`,
              })
              .where(eq(students.studentId, item.studentId));
            updated += 1;
            await writeAudit(tx, {
              actorStaffId: guard.manager.id,
              action: "student_import_update",
              targetType: "student",
              targetId: item.studentId,
              metadata: { batchId, before: item.beforeData, after: item.afterData },
            });
          }
        }

        await tx.update(importBatches)
          .set({ status: "committed", importedRows: created + updated })
          .where(and(eq(importBatches.id, batchId), eq(importBatches.status, "validated")));
        await writeAudit(tx, {
          actorStaffId: guard.manager.id,
          action: "roster_import_commit",
          targetType: "import_batch",
          targetId: batchId,
          metadata: {
            fileName: batch.fileName,
            totalRows: batch.totalRows,
            created,
            updated,
            unchanged: batch.totalRows - created - updated,
            committedAt: new Date().toISOString(),
            outcome: "committed",
          },
        });
        return { kind: "ok" as const, batchId, created, updated, unchanged: batch.totalRows - created - updated };
      });

      if (result.kind === "missing") {
        set.status = 404;
        return { error: "import_batch_not_found" };
      }
      if (result.kind === "committed") {
        set.status = 409;
        return { error: "import_batch_already_committed" };
      }
      if (result.kind === "invalid") {
        set.status = 409;
        return { error: "import_batch_not_committable" };
      }
      return result;
    } catch (error) {
      if (error instanceof CommitConflictError) {
        set.status = 409;
        return { error: "stale_preview", conflicts: error.conflicts };
      }
      const code = (error as { code?: string; cause?: { code?: string } })?.code ??
        (error as { cause?: { code?: string } })?.cause?.code;
      if (code === "23505") {
        set.status = 409;
        return { error: "stale_preview", conflicts: [{ studentId: "unknown", reason: "unique_conflict_at_commit" }] };
      }
      throw error;
    }
  });
