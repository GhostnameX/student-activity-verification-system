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
