import {
  pgTable,
  text,
  timestamp,
  integer,
  pgEnum,
  index,
  uniqueIndex,
  boolean,
  jsonb,
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

export const users = pgTable(
  "users",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    createdAt: timestamp("created_at")
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`now()`)
      .notNull(),
    role: roleEnum("role").default("student").notNull(),
    faculty: text("faculty"),
    studentId: text("student_id"),
    phone: text("phone"),
  },
  (t) => [
    uniqueIndex("users_email_unique").on(t.email),
    index("users_role_idx").on(t.role),
  ],
);

// Better Auth session table (old auth system). Renamed so the new custom
// `sessions` table can take the name. Dropped by migration 0010 once the new
// auth is verified in production.
export const betterAuthSessions = pgTable("better_auth_sessions", {
  id: text("id").primaryKey(),
  token: text("token").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at")
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`now()`)
    .notNull(),
});

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
    email: text("email").notNull(),
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
    uniqueIndex("staff_email_unique").on(t.email),
    uniqueIndex("staff_code_unique").on(t.staffCode),
  ],
);

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at")
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`now()`)
    .notNull(),
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const activities = pgTable(
  "activities",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    title: text("title").notNull(),
    titleEn: text("title_en").notNull(),
    type: text("type").notNull(),
    organizer: text("organizer").notNull(),
    date: timestamp("date").notNull(),
    location: text("location").notNull(),
    description: text("description"),
    descriptionEn: text("description_en"),
    submissionDeadline: timestamp("submission_deadline"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at")
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [index("activities_date_idx").on(t.date)],
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
    activityId: text("activity_id").references(() => activities.id),
    status: requestStatusEnum("status").default("pending").notNull(),
    note: text("note"),
    rejectionReason: text("rejection_reason"),
    activityName: text("activity_name"),
    requestSequence: integer("request_sequence"),
    requestYear: integer("request_year"),
    certificateNumber: integer("certificate_number"),
    certificateYear: integer("certificate_year"),
    reviewedById: text("reviewed_by_id").references(() => staff.id),
    reviewedAt: timestamp("reviewed_at"),
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
    index("requests_activity_idx").on(t.activityId),
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
  importedBy: text("imported_by").references(() => staff.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at")
    .default(sql`now()`)
    .notNull(),
});

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
