// Pure formatting helpers for the certificate PDF. Must not import app.ts or @ua/db
// so they can be unit-tested without any database.

const THAI_TZ = "Asia/Bangkok";

/** "วันที่ 12/10/2569 เวลา 23:00 น." — Asia/Bangkok, Buddhist year, 24h clock. */
export function formatSubmittedAtThai(d: Date): string {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new Error("formatSubmittedAtThai: invalid date");
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: THAI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = Number(get("year")) + 543;
  return `วันที่ ${get("day")}/${get("month")}/${year} เวลา ${get("hour")}:${get("minute")} น.`;
}

/** "12/10/2569" — Asia/Bangkok date, Buddhist year (the reviewer's signature date). */
export function formatReviewedDateThai(d: Date): string {
  return formatSubmittedAtThai(d).replace(/^วันที่ /, "").replace(/ เวลา .*$/, "");
}

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

/** Top "วันที่ … เดือน … พ.ศ. …" line, from requests.reviewed_at (Asia/Bangkok, Buddhist year). */
export function certificateReviewDates(reviewedAt: Date): {
  dateDay: number;
  dateMonth: string;
  dateYear: number;
} {
  const [dd, mm, yyyy] = formatReviewedDateThai(reviewedAt).split("/").map(Number); // validates the date too
  return { dateDay: dd, dateMonth: THAI_MONTHS[mm - 1], dateYear: yyyy };
}

/**
 * Every date printed on the certificate, from two independent instants:
 * - `top` (วันที่ at the top of the form) = requests.reviewed_at
 * - `reviewerLine` (the "วันที่…" line in the reviewer box, per the form owner,
 *   confirmed 2026-10-02) = requests.submitted_at, the first submission time
 */
export function certificateDateFields(d: { submittedAt: Date; reviewedAt: Date }): {
  top: { dateDay: number; dateMonth: string; dateYear: number };
  reviewerLine: string;
} {
  return { top: certificateReviewDates(d.reviewedAt), reviewerLine: formatSubmittedAtThai(d.submittedAt) };
}

// Longest first so "นางสาว" wins over "นาง". Only stripped when a real prefix:
// followed by whitespace, or written with a dot ("น.ส.", "Mr.").
const PREFIXES = ["นางสาว", "น.ส.", "นาง", "นาย", "ด.ช.", "ด.ญ.", "Miss", "Mrs.", "Mrs", "Mr.", "Mr", "Ms.", "Ms"];

/** Removes a leading title (นาย/นาง/นางสาว/...) without cutting names like "นางนวล". */
export function stripThaiNamePrefix(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  for (const p of PREFIXES) {
    if (!trimmed.toLowerCase().startsWith(p.toLowerCase())) continue;
    const rest = trimmed.slice(p.length);
    const dotted = p.endsWith(".");
    // Undotted prefixes need a following space; dotted ones may be glued ("น.ส.สมหญิง").
    if (rest.startsWith(" ") || (dotted && rest.length > 0)) {
      const out = rest.trim();
      return out || trimmed;
    }
  }
  return trimmed;
}

export interface CenteredFit {
  /** Left x to pass to drawText. */
  x: number;
  size: number;
}

/**
 * Centre `text` inside the dotted field [startX, endX]. Shrinks 1pt at a time until the text fits
 * with `margin` pt on each side, but not below `minSize`. If it is still wider than the whole field
 * at `minSize`, keeps shrinking (down to `hardMinSize`) purely so it can never run into the caption
 * next to the field. Pure: `measure` is injected so it is testable without a font.
 */
export function fitCenteredInRange(
  measure: (text: string, size: number) => number,
  text: string,
  startX: number,
  endX: number,
  size: number,
  { minSize = 12, margin = 4, hardMinSize = 9 }: { minSize?: number; margin?: number; hardMinSize?: number } = {},
): CenteredFit {
  const width = endX - startX;
  let s = size;
  while (s > minSize && measure(text, s) > width - 2 * margin) s -= 1;
  while (s > hardMinSize && measure(text, s) > width) s -= 1;
  return { x: startX + (width - measure(text, s)) / 2, size: s };
}
