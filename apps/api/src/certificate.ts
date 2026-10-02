import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { certificateDateFields, fitCenteredInRange, stripThaiNamePrefix } from "./certificate-format";

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
   * Used only for the top "วันที่ … เดือน … พ.ศ. …" line (Asia/Bangkok).
   */
  reviewedAt: Date;
}

// Center / width of the template's "ชื่อ - สกุล......" signature line.
const SIGNATURE_CENTER_X = 306;
const SIGNATURE_MAX_WIDTH = 180;
// "คำร้องที่" caption ends at x≈511.7; the number starts ~6pt after it.
// Center of the reviewer box ("ผู้ตรวจสอบกิจกรรม" caption spans x 244–330).
const REVIEWER_DATE_CENTER_X = 287;
const REQUEST_NUMBER_X = 517.7;

/**
 * Dotted fields that hold centred text. startX/endX are the first/last "." of the template's
 * dot run, measured from the template PDF itself (PyMuPDF rawdict, per-character bbox of the
 * "." glyphs on that line; the caption glyphs before/after the run delimit it); baselineY is the
 * text baseline in PDF coordinates (origin bottom-left) taken from the same line.
 * Name run ends where the "รหัสนักศึกษา" caption starts (x 364.6).
 */
export const CENTERED_FIELDS = {
  studentName: { startX: 140.04, endX: 364.59, baselineY: 584.26 },
  studentId: { startX: 419.81, endX: 537.63, baselineY: 584.26 },
  phone: { startX: 109.19, endX: 305.34, baselineY: 564.67 },
} as const;

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

  // Centered on a point; shrinks (1pt steps) until it fits maxWidth, down to minSize.
  function drawCenteredAt(
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

  // Centred inside a dotted field (see CENTERED_FIELDS); shrinks to fit, never touches the captions.
  function drawCentered(text: string, startX: number, endX: number, baselineY: number, size: number) {
    if (!text) return;
    const fit = fitCenteredInRange((t, sz) => font.widthOfTextAtSize(t, sz), text, startX, endX, size);
    page.drawText(text, { x: fit.x, y: baselineY, size: fit.size, font, color: black });
  }

  const printedName = stripThaiNamePrefix(data.studentName);

  // 1. Replace the template's dotted placeholder and hard-coded /2569 with
  // the request number captured at submission time.
  page.drawRectangle({ x: 514.5, y: 749, width: 70.5, height: 19, color: rgb(1, 1, 1) });
  // Number only (no year), left-aligned REQUEST_NUMBER_GAP after the "คำร้องที่" caption (ends x≈511.7).
  drawLeft(String(data.requestNumber), REQUEST_NUMBER_X, 753.24, 14);

  // 2. เขียนที่ (location)
  drawLeft(data.location, 394, 639.46, 16);

  // 3. วันที่ (top): day / month / year — from reviewed_at, independent of the reviewer-box time (step 9)
  const { top: reviewDates, reviewerLine } = certificateDateFields(data);
  drawRight(String(reviewDates.dateDay), 346, 611.86, 16);
  drawRight(reviewDates.dateMonth, 464, 611.86, 16);
  drawRight(String(reviewDates.dateYear), 534, 611.86, 16);

  // 4. ข้าพเจ้า: student name (without title) + รหัสนักศึกษา, centred in their dotted fields
  const { studentName: nameField, studentId: idField, phone: phoneField } = CENTERED_FIELDS;
  drawCentered(printedName, nameField.startX, nameField.endX, nameField.baselineY, 16);
  if (data.studentId) drawCentered(data.studentId, idField.startX, idField.endX, idField.baselineY, 16);

  // 5. เบอร์โทร
  if (data.phone) drawCentered(data.phone, phoneField.startX, phoneField.endX, phoneField.baselineY, 16);

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
  // to write by hand; below it: (ชื่อ นามสกุล), then the role caption. The template's
  // caption is blanked and redrawn one line lower to make room; the dashed divider
  // stays exactly where the template has it.
  page.drawRectangle({ x: 258, y: 218, width: 98, height: 19, color: rgb(1, 1, 1) });
  drawCenteredAt(`(${printedName})`, SIGNATURE_CENTER_X, 223, 16, SIGNATURE_MAX_WIDTH, 12);
  drawCenteredAt("นักศึกษาผู้ยื่นคำร้อง", SIGNATURE_CENTER_X, 207.5, 14);

  // 9. Reviewer box "วันที่......" (between "(ว่าที่ร้อยตรีหญิง…)" above and
  // "เจ้าหน้าที่ฝ่ายพัฒนานักศึกษา" below): first-submission time (requests.submitted_at,
  // Asia/Bangkok), never the approval/render time. Blank the template dots (x 235–339,
  // y 57.5–75) and write the full string centred on the same line.
  page.drawRectangle({ x: 233, y: 58, width: 108, height: 17, color: rgb(1, 1, 1) });
  drawCenteredAt(reviewerLine, REVIEWER_DATE_CENTER_X, 61.44, 15, 230, 12);

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
