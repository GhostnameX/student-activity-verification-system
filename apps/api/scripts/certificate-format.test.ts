import { describe, expect, test } from "bun:test";
import { certificateReviewDates, formatReviewedDateThai, formatSubmittedAtThai, stripThaiNamePrefix } from "../src/certificate-format";

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

describe("certificateReviewDates (top date and signature date share one instant)", () => {
  test("both dates agree", () => {
    const r = certificateReviewDates(new Date("2026-10-14T03:20:00Z"));
    expect(r).toEqual({ dateDay: 14, dateMonth: "ตุลาคม", dateYear: 2569, signatureDate: "14/10/2569" });
  });
  test("UTC late evening rolls both dates to the next Bangkok day", () => {
    const r = certificateReviewDates(new Date("2026-10-13T17:30:00Z"));
    expect(r).toEqual({ dateDay: 14, dateMonth: "ตุลาคม", dateYear: 2569, signatureDate: "14/10/2569" });
  });
  test("year boundary: 2026-12-31T17:00Z is 1 January 2570 (Bangkok)", () => {
    const r = certificateReviewDates(new Date("2026-12-31T17:00:00Z"));
    expect(r).toEqual({ dateDay: 1, dateMonth: "มกราคม", dateYear: 2570, signatureDate: "01/01/2570" });
  });
  test("just before midnight Bangkok stays on the same day", () => {
    const r = certificateReviewDates(new Date("2026-10-13T16:59:00Z"));
    expect(r.dateDay).toBe(13);
    expect(r.signatureDate).toBe("13/10/2569");
  });
  test("top and signature always match, for every month", () => {
    for (let m = 0; m < 12; m++) {
      const r = certificateReviewDates(new Date(Date.UTC(2026, m, 15, 20, 0)));
      const [dd, mm, yyyy] = r.signatureDate.split("/").map(Number);
      expect([r.dateDay, r.dateYear]).toEqual([dd, yyyy]);
      expect(r.dateMonth).toBe(
        ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"][mm - 1],
      );
    }
  });
  test("rejects invalid date", () => {
    expect(() => certificateReviewDates(new Date("nope"))).toThrow();
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
