import { describe, expect, test } from "bun:test";
import { certificateDateFields, certificateReviewDates, formatReviewedDateThai, formatSubmittedAtThai, stripThaiNamePrefix } from "../src/certificate-format";

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
