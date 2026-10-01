import { describe, expect, test } from "bun:test";
import { formatSubmittedAtThai, stripThaiNamePrefix } from "../src/certificate-format";

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
