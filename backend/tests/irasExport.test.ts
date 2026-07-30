import { describe, it, expect } from "vitest";
import {
  buildIr8a,
  buildAppendix8a,
  buildIr8s,
  buildIr21,
  ir8aEligible,
  renderIrasAisText,
  renderIrasAisXml,
  renderIrasCsv,
  IRAS_CSV_HEADER,
  type IrasEmployee,
  type IrasPayslipYear,
} from "../src/services/irasExport.js";

// A FIXED seeded employee + fixed year payslips — the golden-file fixtures.
const EMP: IrasEmployee = {
  employeeNo: "E001",
  firstName: "Alice",
  lastName: "Tan",
  nric: "S1234567A",
  nationality: "Singaporean",
  dateOfBirth: "1990-01-15",
  workPassType: "citizen",
};

const SLIPS: IrasPayslipYear[] = [
  { grossPay: 5000, employeeCpf: 1000, employerCpf: 850 },
  { grossPay: 5000, employeeCpf: 1000, employerCpf: 850 },
  { grossPay: 8000, employeeCpf: 1000, employerCpf: 850 },
];

describe("buildIr8a aggregation", () => {
  it("sums income and CPF exactly", () => {
    const r = buildIr8a(EMP, SLIPS, 2025);
    expect(r.totalIncome).toBe(18000);
    expect(r.totalEmployeeCpf).toBe(3000);
    expect(r.totalEmployerCpf).toBe(2550);
    expect(r.donations).toBe(0);
    expect(r.benefitsInKind).toBe(0);
    expect(r.year).toBe(2025);
  });

  it("carries donations/benefits from opts", () => {
    const r = buildIr8a(EMP, SLIPS, 2025, { donations: 120.5, benefitsInKind: 300 });
    expect(r.donations).toBe(120.5);
    expect(r.benefitsInKind).toBe(300);
  });
});

describe("IR8A golden CSV contract", () => {
  it("emits the exact CSV content", () => {
    const r = buildIr8a(EMP, SLIPS, 2025);
    const csv = renderIrasCsv([r]);
    const expected =
      "EmployeeNo,Name,NRIC,Year,TotalIncome,EmployeeCPF,EmployerCPF,Donations,BenefitsInKind\n" +
      "E001,Alice Tan,S1234567A,2025,18000.00,3000.00,2550.00,0.00,0.00\n";
    expect(csv).toBe(expected);
    expect(csv.startsWith(IRAS_CSV_HEADER + "\n")).toBe(true);
  });

  it("neutralises CSV formula injection in text fields", () => {
    const evil: IrasEmployee = { ...EMP, firstName: "=cmd", lastName: "Tan" };
    const r = buildIr8a(evil, SLIPS, 2025);
    const csv = renderIrasCsv([r]);
    expect(csv).toContain("'=cmd Tan");
  });
});

describe("IR8A golden AIS text contract", () => {
  it("emits the exact fixed-line text content", () => {
    const r = buildIr8a(EMP, SLIPS, 2025);
    const text = renderIrasAisText([r]);
    const expected =
      "H1|2025|1\n" +
      "A8A|E001|Alice Tan|S1234567A|2025|18000.00|3000.00|2550.00|0.00|0.00\n" +
      "T1|1|18000.00\n";
    expect(text).toBe(expected);
  });

  it("strips a literal pipe from name/NRIC fields so the pipe-delimited columns never desync", () => {
    const evil: IrasEmployee = { ...EMP, firstName: "A|B", nric: "S123|4567A" };
    const r = buildIr8a(evil, SLIPS, 2025);
    const text = renderIrasAisText([r]);
    const dataLine = text.split("\n")[1];
    expect(dataLine.split("|")).toHaveLength(10);
    expect(dataLine).not.toContain("A|B");
    expect(dataLine).not.toContain("S123|4567A");
  });
});

describe("IR8A AIS XML contract", () => {
  it("emits well-formed escaped XML", () => {
    const r = buildIr8a({ ...EMP, firstName: "A&B", lastName: "Tan" }, SLIPS, 2025);
    const xml = renderIrasAisXml([r]);
    expect(xml).toContain(`<IR8AReturn year="2025" count="1">`);
    expect(xml).toContain(`<Name>A&amp;B Tan</Name>`);
    expect(xml).toContain(`<TotalIncome>18000.00</TotalIncome>`);
    expect(xml).toContain(`</IR8AReturn>`);
  });
});

describe("buildAppendix8a", () => {
  it("sums benefit lines", () => {
    const a = buildAppendix8a(EMP, [
      { description: "Housing", amount: 12000 },
      { description: "Car", amount: 3000.5 },
    ]);
    expect(a.total).toBe(15000.5);
    expect(a.benefits).toHaveLength(2);
  });
});

describe("buildIr8s", () => {
  it("wraps the excess CPF figure", () => {
    const s = buildIr8s(EMP, 450.25);
    expect(s.excessCpf).toBe(450.25);
    expect(s.employee.employeeNo).toBe("E001");
  });
});

describe("buildIr21 tax clearance", () => {
  it("is applicable for ep/sp/wp foreign pass holders", () => {
    for (const pass of ["ep", "sp", "wp"]) {
      const r = buildIr21({ ...EMP, workPassType: pass }, "2026-03-31");
      expect(r.applicable).toBe(true);
      expect(r.clearanceDate).toBe("2026-03-31");
    }
  });

  it("is NOT applicable for a citizen", () => {
    const r = buildIr21({ ...EMP, workPassType: "citizen" }, "2026-03-31");
    expect(r.applicable).toBe(false);
  });
});

describe("ir8aEligible", () => {
  it("flags a missing NRIC", () => {
    const r = ir8aEligible({ ...EMP, nric: null });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("nric");
  });

  it("flags a missing dateOfBirth", () => {
    const r = ir8aEligible({ ...EMP, dateOfBirth: null });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("dateOfBirth");
  });

  it("passes a complete employee", () => {
    expect(ir8aEligible(EMP).ok).toBe(true);
  });
});
