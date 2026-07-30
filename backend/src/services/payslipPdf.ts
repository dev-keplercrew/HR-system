// ⚠️ DEMO SIMULATION — NOT A CERTIFIED INTEGRATION.
//
// MOM-compliant itemised payslip PDF builder + bulk-ZIP builder for a payroll run.
// Pure/testable: takes plain interfaces (no Prisma imports) and produces raw
// Buffers. PDFs are built with compress:false so the itemised text is searchable
// in the raw buffer (used by tests and by any downstream text-extraction check).
//
// MOM itemised-payslip line items covered here:
//   - Employer name
//   - Employee name + employee number
//   - Date of payment (run.runDate)
//   - Salary period start & end (derived from run.period "YYYY-MM")
//   - Basic salary
//   - Allowances (itemised)
//   - Overtime hours, overtime pay, OT period
//   - Backpay / adjustments (if present)
//   - Gross pay
//   - Deductions: employee CPF, unpaid-leave deduction, self-help fund lines
//   - Net pay
//   - Employer CPF contribution (employer-paid, shown separately)
//   - SDL (employer-side informational contribution, NOT an employee deduction)

import PDFDocument from "pdfkit";
import archiver from "archiver";
import { round2 } from "./girExport.js";

export interface PayslipPdfEmployee {
  employeeNo: string;
  firstName: string;
  lastName: string;
}

export interface PayslipPdfRun {
  period: string; // salary period "YYYY-MM"
  runDate?: Date | string | null; // date of payment
}

export interface PayslipPdfData {
  basicPay: number;
  allowances: number;
  allowanceBreakdown?: string | null; // JSON array like '[{"label":"Transport","amount":30}]'
  grossPay: number;
  ordinaryWage?: number;
  additionalWage?: number;
  employeeCpf: number;
  employerCpf: number;
  netPay: number;
  otHours?: number;
  otPay?: number;
  backpayAmount?: number;
  unpaidLeaveDeduction?: number;
  sdlAmount?: number;
  cpfAgeBandLabel?: string | null;
  selfHelpFundDeductions?: string | null; // JSON string like {"CDAC":1.5}
}

export interface PayslipPdfInput {
  payslip: PayslipPdfData;
  employee: PayslipPdfEmployee;
  run: PayslipPdfRun;
  employerName?: string;
}

const DEFAULT_EMPLOYER = "Meridian HR (Pte) Ltd";

// Round money to 2dp for display.
function money(n: number | null | undefined): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return round2(v).toFixed(2);
}

// Strip path-traversal / separator characters from an employeeNo before using
// it as a ZIP entry filename. employeeNo is HR/admin-settable with no
// filesystem-safe-character restriction at the DB layer, so a value like
// "../../../tmp/pwned" must not be able to steer where a local unzip tool
// writes the extracted file (zip-slip).
function safeZipEntryName(employeeNo: string): string {
  return String(employeeNo).replace(/[\\/]/g, "_").replace(/^\.+/, "_");
}

// Format the date of payment. Accepts Date, ISO string, or null.
function formatDate(d: Date | string | null | undefined): string {
  if (d == null) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Derive salary period start & end from "YYYY-MM":
//   start = YYYY-MM-01, end = last calendar day of that month.
function periodRange(period: string): { start: string; end: string } {
  const match = /^(\d{4})-(\d{2})/.exec(period ?? "");
  if (!match) return { start: period ?? "—", end: period ?? "—" };
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const start = `${match[1]}-${match[2]}-01`;
  // Day 0 of next month = last day of this month.
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const end = `${match[1]}-${match[2]}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

// Parse the self-help fund JSON into { name, amount } lines. Tolerant of
// malformed / null input — returns [] rather than throwing.
function parseSelfHelpFunds(
  raw: string | null | undefined,
): Array<{ name: string; amount: number }> {
  if (!raw) return [];
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return [];
    return Object.entries(obj as Record<string, unknown>).map(([name, amount]) => ({
      name,
      amount: typeof amount === "number" ? amount : Number(amount) || 0,
    }));
  } catch {
    return [];
  }
}

// Parse the itemised allowance JSON array into { label, amount } lines.
// Tolerant of malformed / null input — returns [] rather than throwing (older
// payslips predating this field fall back to the single "Allowances" line).
function parseAllowanceBreakdown(
  raw: string | null | undefined,
): Array<{ label: string; amount: number }> {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((l) => l && typeof l.label === "string")
      .map((l) => ({ label: l.label, amount: typeof l.amount === "number" ? l.amount : Number(l.amount) || 0 }));
  } catch {
    return [];
  }
}

export function buildPayslipPdf(input: PayslipPdfInput): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const { payslip, employee, run } = input;
      const employerName = input.employerName ?? DEFAULT_EMPLOYER;

      // compress:false is CRITICAL — keeps the text streams uncompressed so the
      // itemised content is searchable in the raw output buffer.
      const doc = new PDFDocument({ compress: false, margin: 50 });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const { start, end } = periodRange(run.period);
      const funds = parseSelfHelpFunds(payslip.selfHelpFundDeductions);
      const allowanceLines = parseAllowanceBreakdown(payslip.allowanceBreakdown);

      // ---- Banner / employer ------------------------------------------------
      doc.fontSize(16).text(employerName, { align: "left" });
      doc.moveDown(0.2);
      doc.fontSize(9).text("DEMO SIMULATION — itemised payslip (not a certified document)");
      doc.moveDown(0.5);
      doc.fontSize(14).text("ITEMISED PAYSLIP");
      doc.moveDown(0.5);

      const line = (label: string, value: string) => {
        doc.fontSize(10).text(`${label}: ${value}`);
      };

      // ---- Employee & period ------------------------------------------------
      line("Employee", `${employee.firstName} ${employee.lastName}`);
      line("Employee No", employee.employeeNo);
      line("Date of Payment", formatDate(run.runDate));
      line("Salary Period Start", start);
      line("Salary Period End", end);
      if (payslip.cpfAgeBandLabel) line("CPF Age Band", payslip.cpfAgeBandLabel);
      doc.moveDown(0.5);

      // ---- Earnings ---------------------------------------------------------
      doc.fontSize(11).text("EARNINGS");
      line("Basic Salary", money(payslip.basicPay));
      if (allowanceLines.length > 0) {
        for (const a of allowanceLines) line(`Allowance (${a.label})`, money(a.amount));
      } else {
        line("Allowances", money(payslip.allowances));
      }
      if (payslip.otHours != null && payslip.otHours > 0) {
        line("Overtime Hours", String(payslip.otHours));
        line("Overtime Pay", money(payslip.otPay));
        line("OT Period", `${start} to ${end}`);
      } else if (payslip.otPay != null && payslip.otPay > 0) {
        line("Overtime Pay", money(payslip.otPay));
        line("OT Period", `${start} to ${end}`);
      }
      if (payslip.backpayAmount != null && payslip.backpayAmount !== 0) {
        line("Backpay / Adjustments", money(payslip.backpayAmount));
      }
      if (payslip.ordinaryWage != null) line("Ordinary Wage (OW)", money(payslip.ordinaryWage));
      if (payslip.additionalWage != null) line("Additional Wage (AW)", money(payslip.additionalWage));
      doc.moveDown(0.2);
      line("GROSS PAY", money(payslip.grossPay));
      doc.moveDown(0.5);

      // ---- Deductions (employee-side) --------------------------------------
      doc.fontSize(11).text("DEDUCTIONS");
      line("Employee CPF Contribution", money(payslip.employeeCpf));
      if (payslip.unpaidLeaveDeduction != null && payslip.unpaidLeaveDeduction !== 0) {
        line("Unpaid Leave Deduction", money(payslip.unpaidLeaveDeduction));
      }
      for (const fund of funds) {
        line(`Self-Help Fund (${fund.name})`, money(fund.amount));
      }
      doc.moveDown(0.2);
      line("NET PAY", money(payslip.netPay));
      doc.moveDown(0.5);

      // ---- Employer contributions (informational, NOT employee deductions) --
      doc.fontSize(11).text("EMPLOYER CONTRIBUTIONS (paid by employer)");
      line("Employer CPF Contribution", money(payslip.employerCpf));
      if (payslip.sdlAmount != null) {
        line("Skills Development Levy (SDL, employer-side)", money(payslip.sdlAmount));
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export function buildPayslipsZip(items: PayslipPdfInput[]): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    (async () => {
      try {
        const archive = archiver("zip");
        const chunks: Buffer[] = [];
        archive.on("data", (chunk: Buffer) => chunks.push(chunk));
        archive.on("end", () => resolve(Buffer.concat(chunks)));
        archive.on("error", reject);
        archive.on("warning", (w) => reject(w));

        for (const item of items) {
          const pdf = await buildPayslipPdf(item);
          archive.append(pdf, { name: `payslip-${safeZipEntryName(item.employee.employeeNo)}.pdf` });
        }

        await archive.finalize();
      } catch (err) {
        reject(err);
      }
    })();
  });
}
