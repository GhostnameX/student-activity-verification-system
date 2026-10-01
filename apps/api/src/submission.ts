/**
 * Single definition of "submitted / not submitted" (round-2 decision D6).
 *
 * Scope: students with status 'active' and deleted_at IS NULL.
 * Submitted: that student has at least one request, in any status and any year.
 * It counts people, never requests. Not submitted: the remaining scoped students.
 *
 * The stats endpoint and both roster list endpoints are built from the same
 * scope + the same "latest request" join below, so the card numbers, the chart
 * and the list lengths cannot drift apart. To move to a per-year definition
 * later, change `latestRequestSub` (add a request_year filter) and nothing else.
 */

import { and, desc, eq, isNotNull, isNull, count, sql, type SQL } from "drizzle-orm";
import { requests, students } from "@ua/db/schema";
import { db } from "@ua/db/client";

/** Query value that selects students whose group_name is null ("ไม่ระบุกลุ่ม"). */
export const NO_GROUP = "__none__";

export type SubmissionState = "submitted" | "not_submitted";

function latestRequestSub() {
  return db
    .selectDistinctOn([requests.studentId], {
      studentId: requests.studentId,
      status: requests.status,
      submittedAt: requests.submittedAt,
    })
    .from(requests)
    .orderBy(requests.studentId, desc(requests.submittedAt), desc(requests.id))
    .as("latest_request");
}

const inScope = () => and(eq(students.status, "active"), isNull(students.deletedAt));

function groupCondition(group: string): SQL {
  return group === NO_GROUP ? isNull(students.groupName) : eq(students.groupName, group);
}

/** Escape LIKE wildcards so a search for "50%" or "a_b" matches literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const collator = new Intl.Collator("th", { numeric: true });

export interface GroupSubmissionStats {
  /** null = students without a group ("ไม่ระบุกลุ่ม"). */
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
  /** Named groups only, natural-sorted (kept for existing clients). */
  groups: string[];
  /** Every group including the null group, natural-sorted, null last. */
  groupStats: GroupSubmissionStats[];
}

export interface SubmissionStats {
  total: number;
  submitted: number;
  notSubmitted: number;
  rate: number;
  byMajor: MajorSubmissionStats[];
}

const rateOf = (submitted: number, total: number) => (total > 0 ? submitted / total : 0);

export async function getSubmissionStats(): Promise<SubmissionStats> {
  const latest = latestRequestSub();
  const rows = await db
    .select({
      major: students.major,
      groupName: students.groupName,
      total: count(students.studentId).mapWith(Number),
      submitted: count(latest.studentId).mapWith(Number),
    })
    .from(students)
    .leftJoin(latest, eq(latest.studentId, students.studentId))
    .where(inScope())
    .groupBy(students.major, students.groupName);

  // Everything (group, major, overall) is summed from the same grouped rows.
  const byMajorMap = new Map<string, GroupSubmissionStats[]>();
  for (const r of rows) {
    const list = byMajorMap.get(r.major) ?? [];
    list.push({
      groupName: r.groupName,
      total: r.total,
      submitted: r.submitted,
      notSubmitted: r.total - r.submitted,
      rate: rateOf(r.submitted, r.total),
    });
    byMajorMap.set(r.major, list);
  }

  const byMajor: MajorSubmissionStats[] = [...byMajorMap.entries()]
    .map(([major, groupStats]) => {
      groupStats.sort((a, b) => {
        if (a.groupName === null) return b.groupName === null ? 0 : 1;
        if (b.groupName === null) return -1;
        return collator.compare(a.groupName, b.groupName);
      });
      const total = groupStats.reduce((n, g) => n + g.total, 0);
      const submitted = groupStats.reduce((n, g) => n + g.submitted, 0);
      return {
        major,
        total,
        submitted,
        notSubmitted: total - submitted,
        rate: rateOf(submitted, total),
        groups: groupStats.flatMap((g) => (g.groupName === null ? [] : [g.groupName])),
        groupStats,
      };
    })
    .sort((a, b) => collator.compare(a.major, b.major));

  const total = byMajor.reduce((n, m) => n + m.total, 0);
  const submitted = byMajor.reduce((n, m) => n + m.submitted, 0);
  return { total, submitted, notSubmitted: total - submitted, rate: rateOf(submitted, total), byMajor };
}

export interface SubmissionListQuery {
  state: SubmissionState;
  major?: string;
  group?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export async function listSubmissionStudents(q: SubmissionListQuery) {
  const latest = latestRequestSub();
  const conds: SQL[] = [
    inScope()!,
    q.state === "submitted" ? isNotNull(latest.studentId) : isNull(latest.studentId),
  ];
  if (q.major) conds.push(eq(students.major, q.major));
  if (q.group) conds.push(groupCondition(q.group));
  if (q.search) {
    const like = `%${escapeLike(q.search)}%`;
    conds.push(
      sql`(${students.firstName} || ' ' || ${students.lastName} ILIKE ${like} OR ${students.studentId} ILIKE ${like})`,
    );
  }
  const where = and(...conds);

  const [countRes, items] = await Promise.all([
    db
      .select({ n: count(students.studentId).mapWith(Number) })
      .from(students)
      .leftJoin(latest, eq(latest.studentId, students.studentId))
      .where(where),
    db
      .select({
        studentId: students.studentId,
        firstName: students.firstName,
        lastName: students.lastName,
        major: students.major,
        groupName: students.groupName,
        level: students.level,
        latestStatus: latest.status,
        latestSubmittedAt: latest.submittedAt,
      })
      .from(students)
      .leftJoin(latest, eq(latest.studentId, students.studentId))
      .where(where)
      // natural group order (…2 before …10), no-group last
      .orderBy(
        students.major,
        sql`${students.groupName} is null`,
        sql`nullif(substring(${students.groupName} from ${String.raw`(\d+)\s*$`}), '')::int`,
        students.groupName,
        students.studentId,
      )
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
  ]);

  return { total: countRes[0]?.n ?? 0, page: q.page, pageSize: q.pageSize, items };
}
