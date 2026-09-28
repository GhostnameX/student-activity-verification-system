# Production Reconstruction Rollout

Status: plan only. No statement in this document is authorization to write production.

## Fixed target and evidence

- Supabase project: `eioaetihyoxzgpqfjkck`
- Database: `postgres`
- Pre-recovery schema fingerprint: `1f2503fe3fed547836d88d4670296631`
- Roster Git blob: `a804487dac1d81fb48b6aca49a87fe43e40986ac`
- Roster SHA-256: `1d8c980fd96dea7cabccaff3d81d95fa0de43a917330c618bfb8e613e3db5ffe`
- Roster rows: `569`
- Storage: `19` objects, `3,103,623` bytes
- Counters: certificate `2569 = 4`, request `2569 = 3`

Every write stage needs its own explicit approval. Approval for one stage does not
authorize any later stage.

## Stage 0: read-only preflight

Run in a read-only transaction immediately before each write stage:

```sql
BEGIN TRANSACTION READ ONLY;

SELECT current_database(), inet_server_addr(), inet_server_port(), version();

SELECT
  (SELECT count(*) FROM public.students) AS students,
  (SELECT count(*) FROM public.staff) AS staff,
  (SELECT count(*) FROM public.activities) AS activities,
  (SELECT count(*) FROM public.requests) AS requests,
  (SELECT count(*) FROM public.sessions) AS sessions,
  (SELECT count(*) FROM public.audit_logs) AS audit_logs,
  (SELECT count(*) FROM public.notifications) AS notifications,
  (SELECT count(*) FROM public.request_attachments) AS request_attachments,
  (SELECT count(*) FROM public.request_attachment_revisions) AS request_attachment_revisions,
  (SELECT count(*) FROM public.attachment_uploads) AS attachment_uploads;

SELECT id FROM public.staff ORDER BY id;
SELECT id FROM public.activities ORDER BY id;
SELECT year, last_number FROM public.certificate_counters WHERE year = 2569;
SELECT year, last_number FROM public.request_counters WHERE year = 2569;

SELECT
  count(DISTINCT table_name) AS public_table_count,
  count(*) AS public_column_count,
  bool_or(table_name = 'students' AND column_name = 'deleted_at') AS students_deleted_at,
  bool_or(table_name = 'students' AND column_name = 'email_bound_at') AS students_email_bound_at,
  bool_or(table_name = 'import_batches' AND column_name = 'status') AS import_batches_status,
  bool_or(table_name = 'staff' AND column_name = 'email') AS staff_email
FROM information_schema.columns
WHERE table_schema = 'public';

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('import_batch_items', 'oauth_bind_sessions')
ORDER BY table_name;

SELECT count(*) AS object_count, coalesce(sum((metadata->>'size')::bigint), 0) AS total_bytes
FROM storage.objects
WHERE bucket_id = 'request-attachments';

SELECT 'view' AS object_type, schemaname || '.' || viewname AS object_name
FROM pg_views
WHERE definition ILIKE '%staff%' AND definition ILIKE '%email%'
UNION ALL
SELECT 'function', n.nspname || '.' || p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prokind IN ('f', 'p')
  AND pg_get_functiondef(p.oid) ILIKE '%staff%'
  AND pg_get_functiondef(p.oid) ILIKE '%email%'
UNION ALL
SELECT 'trigger', event_object_schema || '.' || event_object_table || '.' || trigger_name
FROM information_schema.triggers
WHERE event_object_table = 'staff' AND action_statement ILIKE '%email%'
UNION ALL
SELECT 'policy', schemaname || '.' || tablename || '.' || policyname
FROM pg_policies
WHERE tablename = 'staff'
  AND (coalesce(qual, '') ILIKE '%email%' OR coalesce(with_check, '') ILIKE '%email%');

COMMIT;
```

Initial preflight must assert:

- students `0`
- staff IDs exactly `{p3-admin, p3-staff}`
- activity IDs exactly `{p3-activity}`
- all unrecoverable historical tables listed above remain `0`
- public tables `13`, public columns `112`
- schema remains pre-0016 and contains `staff.email`
- dependency query returns no rows
- counters and Storage match the fixed evidence
- a fresh client-side `git cat-file`/SHA-256 validation matches the fixed roster evidence

Any mismatch aborts. Do not use a broad delete, `TRUNCATE`, or migration runner.

## Stage 1: restore 569 base roster rows

Approval phrase required immediately before execution:

`APPROVE PROD STAGE 1 RESTORE 569 STUDENTS`

The client loads the exact verified Git blob into a temporary table using
parameterized values. It must validate 569 rows, unique/non-empty student IDs,
required names/major, admission year 2567, and absence of email/phone/status
source fields before opening the write transaction.

```sql
BEGIN ISOLATION LEVEL SERIALIZABLE;
LOCK TABLE public.students IN ACCESS EXCLUSIVE MODE;

-- Repeat Stage 0 database/schema/counter/p3 assertions in this transaction.

CREATE TEMP TABLE recovery_students (
  student_id text PRIMARY KEY,
  first_name text NOT NULL,
  last_name text NOT NULL,
  major text NOT NULL,
  group_name text NOT NULL,
  level text NOT NULL,
  admission_year integer NOT NULL CHECK (admission_year = 2567)
) ON COMMIT DROP;

-- Client performs parameterized INSERT batches into recovery_students.

DO $$
BEGIN
  IF (SELECT count(*) FROM recovery_students) <> 569 THEN
    RAISE EXCEPTION 'recovery staging count drift';
  END IF;
END $$;

INSERT INTO public.students (
  student_id, first_name, last_name, major, group_name, level, admission_year
)
SELECT student_id, first_name, last_name, major, group_name, level, admission_year
FROM recovery_students
ORDER BY student_id;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.students) <> 569 THEN
    RAISE EXCEPTION 'student restore count mismatch';
  END IF;
END $$;

COMMIT;
```

This deliberately omits email, phone, import batch and status. The existing base
schema default supplies `active`; this is base-roster behavior, not a claim that
historical statuses were recovered.

Rollback before commit is automatic. A separately approved post-commit reversal
may delete only the exact 569 IDs from the verified blob.

## Stage 2: deploy compatibility application

Deploy the code that no longer reads or writes `staff.email`. While the old
column still exists, verify staffCode login, `/api/me`, staff list and student
Google OAuth. Staff creation stays administratively frozen until Stage 3 is
complete because the old column is still `NOT NULL`.

This is an application deploy, not authorization for a database write.

## Stage 3: apply migration 0018 only

Approval phrase required immediately before execution:

`APPROVE PROD STAGE 3 DROP STAFF EMAIL`

Re-run Stage 0 with expected students `569`. Then execute the contents of
`packages/db/drizzle/0018_remove_staff_email.sql` directly in one transaction:

```sql
BEGIN;
DROP INDEX IF EXISTS "public"."staff_email_unique";
ALTER TABLE "public"."staff" DROP COLUMN IF EXISTS "email";
COMMIT;
```

Do not run `drizzle-kit migrate`; do not apply 0016 or 0017 in this stage. Verify
the application again after commit. This migration is forward-only after a new
email-free staff account exists.

## Stage 4: create Admin-main and remove exact p3 fixtures

Approval phrase required immediately before execution:

`APPROVE PROD STAGE 4 CREATE ADMIN AND REMOVE P3 FIXTURES`

Generate a UUID and Argon2 hash client-side. Read the temporary password only
from an environment variable; never print it, pass it in command-line arguments,
or persist plaintext.

```sql
BEGIN ISOLATION LEVEL SERIALIZABLE;
LOCK TABLE public.staff, public.activities IN ACCESS EXCLUSIVE MODE;

-- Assert students=569, exact p3 IDs, counters unchanged, staff.email absent,
-- no staff_code='admin-main', and no later migration columns/tables.

INSERT INTO public.staff (
  id, staff_code, password_hash, role, full_name, is_active, kind
) VALUES (
  $1, 'admin-main', $2, 'admin', 'Admin-main', true, 'main'
) RETURNING id, staff_code, role, full_name, is_active, kind;

DELETE FROM public.staff
WHERE id IN ('p3-admin', 'p3-staff')
RETURNING id;
-- Client must compare the returned set exactly with both expected IDs.

DELETE FROM public.activities
WHERE id = 'p3-activity'
RETURNING id;
-- Client must assert exactly p3-activity was returned.

-- Assert exactly one staff row remains and it is the generated admin ID;
-- students=569; activities=0; lost-history tables=0; counters unchanged.

COMMIT;
```

After commit, perform read-only verification of database identity, counts,
counters and Storage. Confirm login with staffCode `admin-main`, then change the
temporary password immediately.

## Stage 5: later, separate 0016/0017 rollout

Not part of reconstruction approval. It requires a new snapshot, approval and
rollout window. Never append it to Stages 1, 3 or 4.