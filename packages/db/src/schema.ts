import {
  pgTable,
  text,
  timestamp,
  integer,
  smallint,
  pgEnum,
  index,
  uniqueIndex,
  boolean,
  jsonb,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const roleEnum = pgEnum("role", ["student", "staff", "admin"]);
export const requestStatusEnum = pgEnum("request_status", [
  "pending",
  "approved",
  "rejected",
  "revision_required",
]);
export const notificationTypeEnum = pgEnum("notification_type", [
  "request_status_change",
]);
export const attachmentRevisionStateEnum = pgEnum("attachment_revision_state", [
  "unchanged",
  "needs_revision",
  "resubmitted",
  "approved",
]);

// Custom auth sessions (Google for students + password for staff/admin).
// user_id is intentionally NOT a foreign key: it can reference either
// students.student_id or staff.id (polymorphic token store, short-lived).
// This is a deliberate decision — unlike notifications/audit_logs which are
// long-lived display tables and therefore use dual-column FKs + CHECK.
export const sessions = pgTable(
  "sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull(),
    authMethod: text("auth_method").notNull(), // 'google' | 'password'
    role: text("role").notNull(), // 'student' | 'staff' | 'admin'
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at")
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const staffKindEnum = pgEnum("staff_kind", ["main", "emergency"]);

export const staff = pgTable(
  "staff",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    staffCode: text("staff_code").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull(), // 'admin' | 'staff' (student not used)
    fullName: text("full_name").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    kind: staffKindEnum("kind").default("main").notNull(), // 'main' | 'emergency'
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at")
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    uniqueIndex("staff_code_unique").on(t.staffCode),
  ],
);

export const requests = pgTable(
  "requests",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    studentId: text("student_id")
      .notNull()
      .references(() => students.studentId, { onDelete: "cascade" }),
    status: requestStatusEnum("status").default("pending").notNull(),
    note: text("note"),
    rejectionReason: text("rejection_reason"),
    requestSequence: integer("request_sequence"),
    requestYear: integer("request_year"),
    certificateNumber: integer("certificate_number"),
    certificateYear: integer("certificate_year"),
    reviewedById: text("reviewed_by_id").references(() => staff.id),
    reviewedAt: timestamp("reviewed_at"),
    // Staff document check (round 2, D2): separate from the admin decision above.
    staffCheckedAt: timestamp("staff_checked_at", { withTimezone: true }),
    staffCheckedById: text("staff_checked_by_id").references(() => staff.id, {
      onDelete: "set null",
    }),
    submittedAt: timestamp("submitted_at")
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    index("requests_student_idx").on(t.studentId),
    index("requests_status_idx").on(t.status),
    uniqueIndex("requests_cert_number_uidx")
      .on(t.certificateYear, t.certificateNumber)
      .where(sql`${t.certificateNumber} is not null`),
    uniqueIndex("requests_request_number_uidx")
      .on(t.requestYear, t.requestSequence)
      .where(sql`${t.requestSequence} is not null`),
  ],
);

export const certificateCounters = pgTable(
  "certificate_counters",
  {
    year: integer("year").primaryKey(),
    lastNumber: integer("last_number").notNull().default(0),
  },
);

export const requestCounters = pgTable(
  "request_counters",
  {
    year: integer("year").primaryKey(),
    lastNumber: integer("last_number").notNull().default(0),
  },
);

export const requestAttachments = pgTable(
  "request_attachments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    slot: integer("slot"),
    currentRevisionId: text("current_revision_id"),
    fileName: text("file_name"),
    fileType: text("file_type"),
    fileSize: integer("file_size"),
    storagePath: text("storage_path"),
    uploadedAt: timestamp("uploaded_at").default(sql`now()`),
  },
  (t) => [index("attachments_request_idx").on(t.requestId)],
);

export const requestAttachmentRevisions = pgTable(
  "request_attachment_revisions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    attachmentId: text("attachment_id")
      .notNull()
      .references(() => requestAttachments.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    fileName: text("file_name").notNull(),
    fileType: text("file_type").notNull(),
    fileSize: integer("file_size").notNull(),
    storagePath: text("storage_path").notNull(),
    revisionState: attachmentRevisionStateEnum("revision_state")
      .default("unchanged")
      .notNull(),
    uploadedAt: timestamp("uploaded_at")
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    uniqueIndex("attrev_attachment_revision_unique").on(
      t.attachmentId,
      t.revisionNumber,
    ),
    index("attrev_attachment_idx").on(t.attachmentId),
  ],
);

// Reason history for "send back for revision": one row per admin request-revision call.
export const requestRevisionNotes = pgTable(
  "request_revision_notes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    authorStaffId: text("author_staff_id").references(() => staff.id, {
      onDelete: "set null",
    }),
    note: text("note").notNull(),
    slots: smallint("slots").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [index("request_revision_notes_request_created_idx").on(t.requestId, t.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    studentId: text("student_id").references(() => students.studentId, {
      onDelete: "cascade",
    }),
    staffId: text("staff_id").references(() => staff.id, {
      onDelete: "cascade",
    }),
    type: notificationTypeEnum("type").default("request_status_change").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    requestId: text("request_id").references(() => requests.id, {
      onDelete: "set null",
    }),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at")
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    index("notifications_student_idx").on(t.studentId),
    index("notifications_staff_idx").on(t.staffId),
    index("notifications_recipient_read_idx").on(t.studentId, t.readAt),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    actorStudentId: text("actor_student_id").references(
      () => students.studentId,
      { onDelete: "set null" },
    ),
    actorStaffId: text("actor_staff_id").references(() => staff.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at")
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    index("audit_logs_actor_student_idx").on(t.actorStudentId),
    index("audit_logs_actor_staff_idx").on(t.actorStaffId),
    index("audit_logs_target_idx").on(t.targetType, t.targetId),
    index("audit_logs_created_idx").on(t.createdAt),
  ],
);

export const studentStatusEnum = pgEnum("student_status", [
  "active",
  "graduated",
  "withdrawn",
]);

export const importBatches = pgTable("import_batches", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  fileName: text("file_name").notNull(),
  totalRows: integer("total_rows").notNull().default(0),
  importedRows: integer("imported_rows").notNull().default(0),
  status: text("status").notNull().default("completed"),
  importedBy: text("imported_by").references(() => staff.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at")
    .default(sql`now()`)
    .notNull(),
});

// Per-row snapshot of one import batch so a batch can be rolled back to its exact
// prior state: 'inserted' rows have before_data = NULL, 'updated' rows keep the
// pre-import row. student_id is deliberately NOT a foreign key — rolling back an
// 'inserted' row must keep the snapshot for audit after the student row is gone.
export const importBatchItems = pgTable(
  "import_batch_items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    batchId: text("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    studentId: text("student_id").notNull(),
    action: text("action").notNull(), // 'inserted' | 'updated'
    beforeData: jsonb("before_data"),
    afterData: jsonb("after_data").notNull(),
    createdAt: timestamp("created_at")
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    uniqueIndex("import_batch_items_batch_student_uidx").on(t.batchId, t.studentId),
    check("import_batch_items_action_check", sql`${t.action} in ('inserted','updated')`),
  ],
);

// Short-lived, one-time record of a completed Google OAuth exchange whose email
// is not bound to any student yet. Holds the OAuth identity server-side during
// first-login binding: the client only ever holds the raw cookie token, and the
// email is never treated as client-supplied input. token_hash is a hash of the
// bearer token, not the token itself.
export const oauthBindSessions = pgTable(
  "oauth_bind_sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tokenHash: text("token_hash").notNull(),
    email: text("email").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    // Failed bind attempts made with this session's token. A wrong studentId is
    // retryable, so the counter is what stops enumeration: once it reaches
    // BIND_MAX_ATTEMPTS the session is invalidated via used_at. Kept in Postgres
    // (not process memory) so the cap holds across instances and restarts.
    attempts: integer("attempts")
      .default(0)
      .notNull(),
    createdAt: timestamp("created_at")
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    uniqueIndex("oauth_bind_sessions_token_hash_uidx").on(t.tokenHash),
    index("oauth_bind_sessions_expires_at_idx").on(t.expiresAt),
  ],
);

// Short-lived Google OAuth CSRF state. Only a SHA-256 hash is persisted; the
// raw state stays in the browser's HttpOnly cookie and Google's callback URL.
export const oauthLoginStates = pgTable(
  "oauth_login_states",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    stateHash: text("state_hash").notNull(),
    redirectPath: text("redirect_path"),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at")
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    uniqueIndex("oauth_login_states_state_hash_uidx").on(t.stateHash),
    index("oauth_login_states_expires_at_idx").on(t.expiresAt),
  ],
);

export const students = pgTable(
  "students",
  {
    studentId: text("student_id").primaryKey(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    major: text("major").notNull(),
    groupName: text("group_name"),
    level: text("level"),
    admissionYear: integer("admission_year").notNull(),
    status: studentStatusEnum("status").default("active").notNull(),
    email: text("email"),
    phone: text("phone"),
    avatarUrl: text("avatar_url"),
    importBatchId: text("import_batch_id").references(() => importBatches.id, {
      onDelete: "set null",
    }),
    // Soft delete only. Separate from `status`: a deleted student keeps its
    // academic status, and restore must not change either field implicitly.
    deletedAt: timestamp("deleted_at"),
    // When a Google OAuth email was bound to this student. Not a verification
    // timestamp — the OAuth provider is the verifier, and there is no phone/OTP
    // verification in V1, so no *_verified_at columns exist.
    emailBoundAt: timestamp("email_bound_at"),
    createdAt: timestamp("created_at")
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    index("students_major_idx").on(t.major),
    index("students_status_idx").on(t.status),
    // Lookup key for Google callback (not the FK target). Partial so it can
    // stay nullable while the email sync job backfills all 569 students.
    uniqueIndex("students_email_uidx")
      .on(t.email)
      .where(sql`${t.email} is not null`),
  ],
);

export const attachmentUploads = pgTable(
  "attachment_uploads",
  {
    storagePath: text("storage_path").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.studentId, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    fileType: text("file_type").notNull(),
    fileSize: integer("file_size").notNull(),
    requestId: text("request_id").references(() => requests.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at")
      .default(sql`now()`)
      .notNull(),
    consumedAt: timestamp("consumed_at"),
  },
  (t) => [
    index("attachment_uploads_student_unconsumed_idx")
      .on(t.studentId)
      .where(sql`${t.consumedAt} is null`),
    index("attachment_uploads_request_idx").on(t.requestId),
  ],
);
