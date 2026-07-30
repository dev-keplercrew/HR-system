// ⚠️ DEMO SIMULATION — NOT A CERTIFIED INTEGRATION.
import { describe, it, expect } from "vitest";
import {
  buildPayslipPdf,
  buildPayslipsZip,
  type PayslipPdfData,
  type PayslipPdfEmployee,
  type PayslipPdfRun,
} from "../src/services/payslipPdf.js";

// pdfkit lays out text with the built-in Helvetica AFM font, which encodes each
// run as hex strings inside PDF `TJ`/`Tj` operators (kerning splits a word into
// several <hex> fragments). Because we build with compress:false the content
// streams are un-deflated, so the text IS present in the raw buffer — we just
// have to decode the hex fragments to search it as plain text.
function extractPdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  return [...raw.matchAll(/<([0-9A-Fa-f]+)>/g)]
    .map((m) => Buffer.from(m[1], "hex").toString("latin1"))
    .join("");
}

const employee: PayslipPdfEmployee = {
  employeeNo: "M001",
  firstName: "Aisha",
  lastName: "Rahman",
};

const run: PayslipPdfRun = {
  period: "2025-07",
  runDate: new Date("2025-07-25T00:00:00Z"),
};

const payslip: PayslipPdfData = {
  basicPay: 4000,
  allowances: 300.5,
  grossPay: 4300.5,
  ordinaryWage: 4300.5,
  additionalWage: 0,
  employeeCpf: 860.1,
  employerCpf: 731.09,
  netPay: 3438.9,
  otHours: 5,
  otPay: 129.02,
  backpayAmount: 150,
  unpaidLeaveDeduction: 0,
  sdlAmount: 10.75,
  cpfAgeBandLabel: "55 and below",
  selfHelpFundDeductions: '{"CDAC":1.5}',
};

describe("MOM itemised payslip PDF", () => {
  it("builds a searchable PDF carrying the mandated items", async () => {
    const buf = await buildPayslipPdf({ payslip, employee, run });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);

    // compress:false => the (un-deflated) text is recoverable from the raw buffer.
    const text = extractPdfText(buf);
    expect(text).toContain("Aisha");
    expect(text).toContain("Rahman");
    expect(text).toContain("DEMO SIMULATION");
    // Net-pay figure formatted to 2dp.
    expect(text).toContain("3438.90");
    // Self-help fund label parsed from the JSON.
    expect(text).toContain("CDAC");
    // Salary period derivation start/end.
    expect(text).toContain("2025-07-01");
    expect(text).toContain("2025-07-31");
  });

  it("renders itemised allowance lines when allowanceBreakdown is set, not the flat legacy line", async () => {
    const itemised: PayslipPdfData = {
      ...payslip,
      allowanceBreakdown: JSON.stringify([
        { label: "Transport", amount: 150.25 },
        { label: "Meal", amount: 150.25 },
      ]),
    };
    const buf = await buildPayslipPdf({ payslip: itemised, employee, run });
    const text = extractPdfText(buf);
    expect(text).toContain("Allowance (Transport)");
    expect(text).toContain("Allowance (Meal)");
    expect(text).toContain("150.25");
    // The single flat "Allowances" (plural, no breakdown) fallback line must
    // NOT appear once a real itemised breakdown is supplied.
    expect(text).not.toContain("Allowances:");
  });

  it("bundles multiple payslips into a ZIP (PK magic)", async () => {
    const buf = await buildPayslipsZip([
      { payslip, employee, run },
      {
        payslip: { ...payslip, netPay: 3200 },
        employee: { employeeNo: "M002", firstName: "Priya", lastName: "Nair" },
        run,
      },
    ]);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    // ZIP magic bytes: 0x50 0x4B ("PK").
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("sanitizes employeeNo in the ZIP entry name so a crafted value can't traverse out of the archive (zip-slip)", async () => {
    const buf = await buildPayslipsZip([
      {
        payslip,
        employee: { employeeNo: "../../../tmp/pwned", firstName: "Evil", lastName: "Emp" },
        run,
      },
    ]);
    const text = buf.toString("latin1");
    expect(text).not.toContain("../");
    expect(text).not.toContain("..\\");
  });
});
