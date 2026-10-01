import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { certificateReviewDates, formatSubmittedAtThai, stripThaiNamePrefix } from "./certificate-format";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEMPLATE_PATH = path.join(__dirname, "..", "assets", "forms", "activity-request-form.pdf");
const FONT_REGULAR_PATH = path.join(__dirname, "..", "assets", "fonts", "THSarabunNew.ttf");

export interface CertificateData {
  requestNumber: number;
  requestYear: number;
  certificateNumber?: number | null;
  certificateYear: number;
  location: string;
  studentName: string;
  studentId?: string | null;
  phone?: string | null;
  faculty?: string | null;
  approved: boolean;
  reason?: string | null;
  /** requests.submitted_at from the DB (first submission; resubmit does not change it). Required — no "now" default. */
  submittedAt: Date;
  /**
   * requests.reviewed_at from the DB (the admin decision time). Required — no "now" default.
   * Both the top date and the reviewer's signature date are derived from it (Asia/Bangkok).
   */
  reviewedAt: Date;
}

// Center / width of the template's "ชื่อ - สกุล......" signature line.
const SIGNATURE_CENTER_X = 306;
const SIGNATURE_MAX_WIDTH = 180;
// y of the redrawn dashed divider above "ผลการพิจารณา" (template original ≈ 202).
const DIVIDER_Y = 190;
// "คำร้องที่" caption ends at x≈511.7; the number starts ~6pt after it.
const REQUEST_NUMBER_X = 517.7;

const FACULTY_ROWS: Array<{ label: string; baselineY: number }> = [
  { label: "สาขาวิชาการจัดการ", baselineY: 545.23 },
  { label: "สาขาวิชาการตลาดเชิงสร้างสรรค์และดิจิทัล", baselineY: 525.67 },
  { label: "สาขาวิชาการจัดการทรัพยากรมนุษย์และองค์การ", baselineY: 506.23 },
  { label: "สาขาวิชาการจัดการเทคโนโลยีสารสนเทศทางธุรกิจ", baselineY: 486.67 },
  { label: "สาขาวิชาธุรกิจการค้าสมัยใหม่", baselineY: 467.11 },
  { label: "สาขาวิชาการท่องเที่ยวและบริการยุคดิจิทัล", baselineY: 447.67 },
  { label: "สาขาวิชาเศรษฐศาสตร์และภาครัฐ", baselineY: 428.09 },
  { label: "สาขาวิชาการจัดการการท่องเที่ยวระหว่างประเทศ", baselineY: 408.65 },
  { label: "สาขาการบัญชีบัณฑิต", baselineY: 389.09 },
  { label: "สาขาวิชานิเทศศาสตร์", baselineY: 369.53 },
];

function normalize(s: string): string {
  return s.replace(/\s+/g, "").replace(/^สาขา(วิชา)?/, "");
}

function findFacultyRow(faculty?: string | null): number | null {
  if (!faculty) return null;
  const f = normalize(faculty);
  for (let i = 0; i < FACULTY_ROWS.length; i++) {
    if (f === normalize(FACULTY_ROWS[i].label)) return i;
  }
  return null;
}

export async function generateCertificatePDF(data: CertificateData): Promise<Buffer> {
  const templateBytes = readFileSync(TEMPLATE_PATH);
  const fontBytes = readFileSync(FONT_REGULAR_PATH);
  const pdfDoc = await PDFDocument.load(templateBytes);
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });

  const page = pdfDoc.getPage(0);
  const black = rgb(0, 0, 0);

  function drawRight(text: string, endX: number, baselineY: number, size: number, f = font) {
    if (!text) return;
    const w = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: endX - w, y: baselineY, size, font: f, color: black });
  }

  function drawLeft(text: string, startX: number, baselineY: number, size: number, f = font) {
    if (!text) return;
    page.drawText(text, { x: startX, y: baselineY, size, font: f, color: black });
  }

  // Centered text that shrinks (1pt steps) until it fits maxWidth, down to minSize.
  function drawCentered(
    text: string,
    centerX: number,
    baselineY: number,
    size: number,
    maxWidth?: number,
    minSize = size,
  ) {
    if (!text) return;
    let s = size;
    if (maxWidth) {
      while (s > minSize && font.widthOfTextAtSize(text, s) > maxWidth) s -= 1;
    }
    const w = font.widthOfTextAtSize(text, s);
    page.drawText(text, { x: centerX - w / 2, y: baselineY, size: s, font, color: black });
  }

  const printedName = stripThaiNamePrefix(data.studentName);

  // 1. Replace the template's dotted placeholder and hard-coded /2569 with
  // the request number captured at submission time.
  page.drawRectangle({ x: 514.5, y: 749, width: 70.5, height: 19, color: rgb(1, 1, 1) });
  // Number only (no year), left-aligned REQUEST_NUMBER_GAP after the "คำร้องที่" caption (ends x≈511.7).
  drawLeft(String(data.requestNumber), REQUEST_NUMBER_X, 753.24, 14);

  // 2. เขียนที่ (location)
  drawLeft(data.location, 394, 639.46, 16);

  // 3. วันที่ (top): day / month / year — from reviewed_at, same instant as the signature date (step 9)
  const reviewDates = certificateReviewDates(data.reviewedAt);
  drawRight(String(reviewDates.dateDay), 346, 611.86, 16);
  drawRight(reviewDates.dateMonth, 464, 611.86, 16);
  drawRight(String(reviewDates.dateYear), 534, 611.86, 16);

  // 4. ข้าพเจ้า: student name (without title) + รหัสนักศึกษา
  // Space between the "ข้าพเจ้า" caption and the รหัสนักศึกษา caption is ~220pt; shrink long names to fit.
  let nameSize = 16;
  while (nameSize > 11 && font.widthOfTextAtSize(printedName, nameSize) > 220) nameSize -= 1;
  drawRight(printedName, 359, 584.26, nameSize);
  if (data.studentId) drawRight(data.studentId, 532, 584.26, 16);

  // 5. เบอร์โทร
  if (data.phone) drawRight(data.phone, 300, 564.67, 16);

  // 6. สาขา checkbox (√ over dots)
  const rowIdx = findFacultyRow(data.faculty);
  if (rowIdx !== null) {
    drawLeft("√", 110, FACULTY_ROWS[rowIdx].baselineY, 16);
  }

  // 7. ผลการพิจารณา: tick box1 (อนุมัติ) or box2 (ไม่อนุมัติ) + เนื่องจาก
  const boxCenter = data.approved ? 147.4 : 298.6;
  const tickW = font.widthOfTextAtSize("√", 16);
  drawLeft("√", boxCenter - tickW / 2, 170.66, 16);
  if (!data.approved && data.reason) {
    drawLeft(data.reason, 394, 170.66, 16);
  }

  // 8. Student signature block. The "ชื่อ - สกุล" line is left blank for the student
  // to write by hand; below it, top to bottom: (ชื่อ นามสกุล), the role caption and
  // the first-submission time. The template has no room for three lines, so the role
  // caption and the dashed divider are blanked and redrawn ~12pt lower.
  page.drawRectangle({ x: 258, y: 218, width: 98, height: 19, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 70, y: 198, width: 472, height: 10, color: rgb(1, 1, 1) });
  page.drawLine({
    start: { x: 72, y: DIVIDER_Y },
    end: { x: 538.7, y: DIVIDER_Y },
    thickness: 0.6,
    dashArray: [2.2, 1.6],
    color: black,
  });
  drawCentered(`(${printedName})`, SIGNATURE_CENTER_X, 224, 16, SIGNATURE_MAX_WIDTH, 12);
  drawCentered("นักศึกษาผู้ยื่นคำร้อง", SIGNATURE_CENTER_X, 211, 14);
  // First-submission time (requests.submitted_at), never the approval/render time.
  drawCentered(`ยื่นคำร้องเมื่อ ${formatSubmittedAtThai(data.submittedAt)}`, SIGNATURE_CENTER_X, 198, 13, 230, 11);

  // 9. วันที่ (reviewer signature): approval date from requests.reviewed_at, written on
  // the template's own "วันที่......" dots.
  drawRight(reviewDates.signatureDate, 334, 61.44, 16);

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

export const CERTIFICATE_FILENAME = (n: number, year: number) => `ใบรับรองการตรวจสอบกิจกรรม_${n}_${year}.pdf`;

export async function generateCertificatePDFForEmail(data: CertificateData) {
  const buffer = await generateCertificatePDF(data);
  return {
    filename: CERTIFICATE_FILENAME(data.certificateNumber ?? data.requestNumber, data.certificateYear),
    content: buffer.toString("base64"),
  };
}
