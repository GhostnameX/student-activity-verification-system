import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEMPLATE_PATH = path.join(__dirname, "..", "assets", "forms", "activity-request-form.pdf");
const FONT_REGULAR_PATH = path.join(__dirname, "..", "assets", "fonts", "THSarabunNew.ttf");
const FONT_BOLD_PATH = path.join(__dirname, "..", "assets", "fonts", "THSarabunNew-Bold.ttf");

export interface CertificateData {
  requestNumber: number;
  location: string;
  dateDay: number;
  dateMonth: string;
  dateYear: number;
  studentName: string;
  studentId?: string | null;
  phone?: string | null;
  faculty?: string | null;
  approved: boolean;
  reason?: string | null;
  reviewedDate: string;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

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
  const boldFontBytes = readFileSync(FONT_BOLD_PATH);

  const pdfDoc = await PDFDocument.load(templateBytes);
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });
  const boldFont = await pdfDoc.embedFont(boldFontBytes, { subset: true });

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

  // 1. คำร้องที่ N/2569 (size 14, right-aligned before "/")
  drawRight(String(data.requestNumber), 557, 753.24, 14);

  // 2. เขียนที่ (location)
  drawLeft(data.location, 394, 639.46, 16);

  // 3. วันที่ (top): day / month / year
  drawRight(String(data.dateDay), 346, 611.86, 16);
  drawRight(data.dateMonth, 464, 611.86, 16);
  drawRight(String(data.dateYear), 534, 611.86, 16);

  // 4. ข้าพเจ้า: student name + รหัสนักศึกษา
  drawRight(data.studentName, 359, 584.26, 16);
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

  // 8. ชื่อ - สกุล (student signature name)
  drawRight(data.studentName, 392, 242.54, 16);

  // 9. วันที่ (signature, reviewed date)
  drawRight(data.reviewedDate, 334, 61.44, 16);

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

export const CERTIFICATE_FILENAME = (n: number) => `ใบรับรองการตรวจสอบกิจกรรม_${n}_2569.pdf`;

export async function generateCertificatePDFForEmail(data: CertificateData) {
  const buffer = await generateCertificatePDF(data);
  return {
    filename: CERTIFICATE_FILENAME(data.requestNumber),
    content: buffer.toString("base64"),
  };
}
