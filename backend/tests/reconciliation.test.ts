import { describe, it, expect } from "vitest";
import {
  parseBankStatementCsv,
  matchAgainstPayslips,
  type BankStatementLineParsed,
  type ReconcilePayslip,
} from "../src/services/reconciliation.js";

describe("parseBankStatementCsv", () => {
  it("parses a header row + 3 data lines into 3 parsed lines", () => {
    const csv = [
      "reference,name,amount", // header (last field not numeric)
      "M001,Aisha Rahman,4000.00",
      "M002,Priya Nair,3200.50",
      "M003,1500", // reference,amount form
    ].join("\n");

    const parsed = parseBankStatementCsv(csv);

    expect(parsed).toHaveLength(3);
    expect(parsed[0].reference).toBe("M001");
    expect(parsed[0].amount).toBe(4000);
    expect(parsed[1].reference).toBe("M002");
    expect(parsed[1].amount).toBe(3200.5);
    expect(parsed[2].reference).toBe("M003");
    expect(parsed[2].amount).toBe(1500);
  });

  it("skips blank lines", () => {
    const csv = ["reference,amount", "", "M001,4000", "   ", "M002,3200"].join("\n");

    const parsed = parseBankStatementCsv(csv);

    expect(parsed).toHaveLength(2);
    expect(parsed.map((p) => p.reference)).toEqual(["M001", "M002"]);
    expect(parsed.map((p) => p.amount)).toEqual([4000, 3200]);
  });
});

describe("matchAgainstPayslips", () => {
  const lines: BankStatementLineParsed[] = [
    { rawLine: "M001,Aisha Rahman,4000.00", amount: 4000, reference: "M001" },
    { rawLine: "M002,Priya Nair,3199.00", amount: 3199, reference: "M002" },
    { rawLine: "M999,Unknown Person,500.00", amount: 500, reference: "M999" },
  ];

  const payslips: ReconcilePayslip[] = [
    { employeeId: 1, employeeNo: "M001", employeeName: "Aisha Rahman", netPay: 4000 },
    { employeeId: 2, employeeNo: "M002", employeeName: "Priya Nair", netPay: 3200.5 },
  ];

  it("produces one matched, one amount-mismatch, one unmatched with exact fields", () => {
    const report = matchAgainstPayslips(lines, payslips);

    // Line 0 — exact net pay match.
    expect(report.results[0].status).toBe("matched");
    expect(report.results[0].matchedEmployeeId).toBe(1);
    expect(report.results[0].matchedAmount).toBe(4000);

    // Line 1 — candidate found but amount differs beyond tolerance.
    expect(report.results[1].status).toBe("amount-mismatch");
    expect(report.results[1].matchedEmployeeId).toBe(2);
    expect(report.results[1].matchedAmount).toBe(3200.5);

    // Line 2 — no candidate payslip.
    expect(report.results[2].status).toBe("unmatched");
    expect(report.results[2].matchedEmployeeId).toBe(null);
    expect(report.results[2].matchedAmount).toBe(null);

    expect(report.summary).toEqual({
      matched: 1,
      unmatched: 1,
      amountMismatch: 1,
      total: 3,
    });
  });

  it("treats a line 0.005 off from netPay as matched under default tolerance", () => {
    const toleranceLines: BankStatementLineParsed[] = [
      { rawLine: "M001,Aisha Rahman,4000.005", amount: 4000.005, reference: "M001" },
    ];
    const report = matchAgainstPayslips(toleranceLines, payslips);

    expect(report.results[0].status).toBe("matched");
    expect(report.results[0].matchedEmployeeId).toBe(1);
    expect(report.summary.matched).toBe(1);
  });
});
