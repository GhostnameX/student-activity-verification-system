import { describe, expect, test } from "bun:test";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";
import { CENTERED_FIELDS } from "../src/certificate";
import { certificateDateFields, fitCenteredInRange, certificateReviewDates, formatReviewedDateThai, formatSubmittedAtThai, stripThaiNamePrefix } from "../src/certificate-format";

describe("formatSubmittedAtThai", () => {
  test("formats Asia/Bangkok, Buddhist year, 24h", () => {
    expect(formatSubmittedAtThai(new Date("2026-10-12T16:00:00Z"))).toBe("วันที่ 12/10/2569 เวลา 23:00 น.");
  });
  test("UTC late evening rolls over to next Bangkok day", () => {
    expect(formatSubmittedAtThai(new Date("2026-10-12T16:30:00Z"))).toBe("วันที่ 12/10/2569 เวลา 23:30 น.");
    expect(formatSubmittedAtThai(new Date("2026-10-12T17:30:00Z"))).toBe("วันที่ 13/10/2569 เวลา 00:30 น.");
  });
  test("year boundary and zero padding", () => {
    expect(formatSubmittedAtThai(new Date("2025-12-31T17:05:00Z"))).toBe("วันที่ 01/01/2569 เวลา 00:05 น.");
  });
  test("midnight shows 00, not 24", () => {
    expect(formatSubmittedAtThai(new Date("2026-03-04T17:00:00Z"))).toBe("วันที่ 05/03/2569 เวลา 00:00 น.");
  });
  test("rejects invalid date", () => {
    expect(() => formatSubmittedAtThai(new Date("nope"))).toThrow();
  });
});

describe("formatReviewedDateThai", () => {
  test("date only, Bangkok day, Buddhist year", () => {
    expect(formatReviewedDateThai(new Date("2026-10-14T03:20:00Z"))).toBe("14/10/2569");
    expect(formatReviewedDateThai(new Date("2026-10-14T17:30:00Z"))).toBe("15/10/2569");
  });
});

describe("certificateReviewDates (top date, from reviewed_at)", () => {
  test("Bangkok day, Thai month, Buddhist year", () => {
    expect(certificateReviewDates(new Date("2026-10-14T03:20:00Z"))).toEqual({ dateDay: 14, dateMonth: "ตุลาคม", dateYear: 2569 });
  });
  test("UTC late evening rolls to the next Bangkok day", () => {
    expect(certificateReviewDates(new Date("2026-10-13T17:30:00Z"))).toEqual({ dateDay: 14, dateMonth: "ตุลาคม", dateYear: 2569 });
  });
  test("year boundary: 2026-12-31T17:00Z is 1 January 2570 (Bangkok)", () => {
    expect(certificateReviewDates(new Date("2026-12-31T17:00:00Z"))).toEqual({ dateDay: 1, dateMonth: "มกราคม", dateYear: 2570 });
  });
  test("just before midnight Bangkok stays on the same day", () => {
    expect(certificateReviewDates(new Date("2026-10-13T16:59:00Z")).dateDay).toBe(13);
  });
  test("rejects invalid date", () => {
    expect(() => certificateReviewDates(new Date("nope"))).toThrow();
  });
});

describe("certificateDateFields (reviewer line = submittedAt, top date = reviewedAt)", () => {
  test("the two instants are independent", () => {
    const r = certificateDateFields({
      submittedAt: new Date("2026-10-12T16:00:00Z"), // 12/10/2569 23:00 Bangkok
      reviewedAt: new Date("2026-10-14T03:20:00Z"), // 14 Oct
    });
    expect(r.reviewerLine).toBe("วันที่ 12/10/2569 เวลา 23:00 น.");
    expect(r.top).toEqual({ dateDay: 14, dateMonth: "ตุลาคม", dateYear: 2569 });
  });
  test("both cross the UTC day boundary into the next Bangkok day", () => {
    const r = certificateDateFields({
      submittedAt: new Date("2026-10-13T17:30:00Z"),
      reviewedAt: new Date("2026-10-14T17:30:00Z"),
    });
    expect(r.reviewerLine).toBe("วันที่ 14/10/2569 เวลา 00:30 น.");
    expect(r.top).toEqual({ dateDay: 15, dateMonth: "ตุลาคม", dateYear: 2569 });
  });
  test("reviewer line never follows reviewedAt", () => {
    const sub = new Date("2026-01-01T03:00:00Z");
    expect(certificateDateFields({ submittedAt: sub, reviewedAt: new Date("2027-05-05T05:05:00Z") }).reviewerLine)
      .toBe(certificateDateFields({ submittedAt: sub, reviewedAt: new Date("2026-02-02T02:02:00Z") }).reviewerLine);
  });
  test("rejects an invalid date on either side", () => {
    expect(() => certificateDateFields({ submittedAt: new Date("nope"), reviewedAt: new Date() })).toThrow();
    expect(() => certificateDateFields({ submittedAt: new Date(), reviewedAt: new Date("nope") })).toThrow();
  });
});

describe("stripThaiNamePrefix", () => {
  test("strips real prefixes", () => {
    expect(stripThaiNamePrefix("นาย สมชาย ใจดี")).toBe("สมชาย ใจดี");
    expect(stripThaiNamePrefix("นางสาว สมหญิง ใจดี")).toBe("สมหญิง ใจดี");
    expect(stripThaiNamePrefix("นาง สมศรี ใจดี")).toBe("สมศรี ใจดี");
    expect(stripThaiNamePrefix("น.ส. สมหญิง ใจดี")).toBe("สมหญิง ใจดี");
    expect(stripThaiNamePrefix("น.ส.สมหญิง ใจดี")).toBe("สมหญิง ใจดี");
    expect(stripThaiNamePrefix("Mr. John Smith")).toBe("John Smith");
    expect(stripThaiNamePrefix("Miss Jane Doe")).toBe("Jane Doe");
    expect(stripThaiNamePrefix("ms. Jane Doe")).toBe("Jane Doe");
  });
  test("does not cut names that merely start with a prefix", () => {
    expect(stripThaiNamePrefix("นางนวล ใจดี")).toBe("นางนวล ใจดี");
    expect(stripThaiNamePrefix("นายกร ใจดี")).toBe("นายกร ใจดี");
    expect(stripThaiNamePrefix("Missy Jones")).toBe("Missy Jones");
    expect(stripThaiNamePrefix("Mrsmith X")).toBe("Mrsmith X");
  });
  test("keeps names without prefix and collapses whitespace", () => {
    expect(stripThaiNamePrefix("  สมชาย   ใจดี ")).toBe("สมชาย ใจดี");
  });
  test("never returns empty", () => {
    expect(stripThaiNamePrefix("นาย ")).toBe("นาย");
  });
});

describe("fitCenteredInRange (dotted-field centring)", () => {
  // 5pt per character at 10pt => width = chars * size / 2
  const measure = (t: string, s: number) => (t.length * s) / 2;

  test("short text keeps its size and is centred exactly", () => {
    const r = fitCenteredInRange(measure, "abcd", 100, 200, 16); // width 32
    expect(r.size).toBe(16);
    expect(r.x).toBe(100 + (100 - 32) / 2);
    expect(r.x + measure("abcd", r.size) / 2).toBe(150);
  });
  test("shrinks 1pt at a time until it fits with 4pt margins", () => {
    const text = "x".repeat(20); // 16pt=160, 14pt=140, 12pt=120
    const r = fitCenteredInRange(measure, text, 0, 130, 16); // usable 122
    expect(r.size).toBe(12);
    expect(measure(text, r.size)).toBeLessThanOrEqual(130 - 8);
  });
  test("margin is respected when shrinking stops early", () => {
    const text = "x".repeat(20);
    const r = fitCenteredInRange(measure, text, 0, 160, 16); // 16pt=160 > 152, 15pt=150 ok
    expect(r.size).toBe(15);
    expect(r.x).toBe((160 - 150) / 2);
  });
  test("never goes below minSize for margin reasons alone", () => {
    const text = "x".repeat(20); // 12pt = 120, field 124 => margin cannot be met at 12
    const r = fitCenteredInRange(measure, text, 0, 124, 16);
    expect(r.size).toBe(12);
    expect(r.x).toBe(2);
  });
  test("wider than the whole field at minSize: shrinks further, never overflows", () => {
    const text = "x".repeat(20);
    const r = fitCenteredInRange(measure, text, 0, 100, 16); // 10pt = 100
    expect(r.size).toBe(10);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + measure(text, r.size)).toBeLessThanOrEqual(100);
  });
});

describe("real font in the template's dotted fields", () => {
  const fontPath = path.join(import.meta.dir, "..", "assets", "fonts", "THSarabunNew.ttf");
  const longest = stripThaiNamePrefix("นางสาว ปรีชญาพัชร์ สุวรรณภูมิพัฒนกุลวงศ์ศิริเกียรติ ศรีสวัสดิ์นฤมิตรชัยพิพัฒน์");
  async function measurer() {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(readFileSync(fontPath));
    return (t: string, s: number) => font.widthOfTextAtSize(t, s);
  }
  test("normal name, id and phone are centred at 16pt inside their fields", async () => {
    const m = await measurer();
    for (const [text, f] of [
      ["สมชาย ใจดี", CENTERED_FIELDS.studentName],
      ["6512345678", CENTERED_FIELDS.studentId],
      ["0812345678", CENTERED_FIELDS.phone],
    ] as const) {
      const r = fitCenteredInRange(m, text, f.startX, f.endX, 16);
      expect(r.size).toBe(16);
      expect(r.x + m(text, r.size) / 2).toBeCloseTo((f.startX + f.endX) / 2, 6);
    }
  });
  test("longest tested name shrinks to 12pt and stays inside the name field", async () => {
    const m = await measurer();
    const f = CENTERED_FIELDS.studentName;
    const r = fitCenteredInRange(m, longest, f.startX, f.endX, 16);
    expect(r.size).toBeLessThan(16);
    expect(r.size).toBeGreaterThanOrEqual(12);
    expect(r.x).toBeGreaterThanOrEqual(f.startX);
    expect(r.x + m(longest, r.size)).toBeLessThanOrEqual(f.endX);
  });
});
