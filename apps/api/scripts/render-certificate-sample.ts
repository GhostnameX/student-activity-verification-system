// Renders sample certificates (no DB) into tmp/ for visual inspection.
// Usage: bun apps/api/scripts/render-certificate-sample.ts
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { generateCertificatePDF, type CertificateData } from "../src/certificate";

const outDir = path.join(import.meta.dir, "..", "..", "..", "tmp");
mkdirSync(outDir, { recursive: true });

const base: CertificateData = {
  requestNumber: 12,
  requestYear: 2569,
  certificateNumber: 34,
  certificateYear: 2569,
  location: "พิษณุโลก",
  studentName: "นาย สมชาย ใจดี",
  studentId: "6512345678",
  phone: "0812345678",
  faculty: "สาขาวิชาการจัดการ",
  approved: true,
  reason: null,
  submittedAt: new Date("2026-10-12T16:00:00Z"),
  reviewedAt: new Date("2026-10-14T03:20:00Z"),
};

const cases: Record<string, Partial<CertificateData>> = {
  short: {},
  "long-name": {
    studentName: "นางสาว ปรีชญาพัชร์ สุวรรณภูมิพัฒนกุลวงศ์ศิริเกียรติ ศรีสวัสดิ์นฤมิตรชัยพิพัฒน์",
    faculty: "สาขาวิชาการจัดการเทคโนโลยีสารสนเทศทางธุรกิจ",
  },
  // 17:30Z on the 13th is already 00:30 on the 14th in Bangkok: both dates must read 14.
  "utc-rollover": {
    submittedAt: new Date("2026-10-13T16:30:00Z"),
    reviewedAt: new Date("2026-10-13T17:30:00Z"),
    studentName: "นางนวล ใจดี",
  },
};

for (const [name, patch] of Object.entries(cases)) {
  const buf = await generateCertificatePDF({ ...base, ...patch });
  const file = path.join(outDir, `cert-sample-${name}.pdf`);
  writeFileSync(file, buf);
  console.log(`wrote ${file}`);
}
