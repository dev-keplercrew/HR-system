import { describe, it, expect } from "vitest";
import {
  buildCpfEzPayFile,
  validateCpfSubmission,
} from "../src/services/cpfSubmission.js";

// A fixed, fully-valid two-employee fixture with known figures. The golden
// assertion below pins the EXACT generated file content.
const EMPLOYER_CSN = "TEST-CSN-01";
const PERIOD = "2026-07";

const validLines = [
  {
    employee: {
      employeeNo: "E001",
      firstName: "Alice",
      lastName: "Tan",
      nric: "S1234567A",
      dateOfBirth: new Date("1990-01-15"),
      workPassType: "CITIZEN",
      nationality: "SINGAPOREAN",
    },
    ordinaryWage: 5000,
    additionalWage: 0,
    employeeCpf: 1000,
    employerCpf: 850,
    totalCpf: 1850,
    selfHelpFundDeductions: '{"CDAC":1.5}',
  },
  {
    employee: {
      employeeNo: "E002",
      firstName: "Bala",
      lastName: "Kumar",
      nric: "S7654321B",
      dateOfBirth: new Date("1985-06-20"),
      workPassType: "PR",
      nationality: "MALAYSIAN",
    },
    ordinaryWage: 4000,
    additionalWage: 1000,
    employeeCpf: 800,
    employerCpf: 680,
    totalCpf: 1480,
    selfHelpFundDeductions: '{"CDAC":2}',
  },
];

describe("buildCpfEzPayFile golden file", () => {
  it("produces the exact expected file content", () => {
    const out = buildCpfEzPayFile({
      period: PERIOD,
      employerCsn: EMPLOYER_CSN,
      lines: validLines,
    });

    const expected =
      "H|CPF-EZPAY|TEST-CSN-01|2026-07|2\n" +
      "D|E001|S1234567A|5000.00|0.00|1850.00|1.50|CDAC=1.50\n" +
      "D|E002|S7654321B|4000.00|1000.00|1480.00|2.00|CDAC=2.00\n" +
      "T|2|3330.00\n";

    expect(out).toBe(expected);
  });

  it("emits the employer CSN from params (proves it is not hardcoded)", () => {
    const out = buildCpfEzPayFile({
      period: PERIOD,
      employerCsn: "OTHER-CSN-99",
      lines: validLines,
    });
    expect(out).toContain("OTHER-CSN-99");
    expect(out).not.toContain("TEST-CSN-01");
  });

  it("strips a literal pipe from NRIC so the pipe-delimited D-line columns never desync", () => {
    const out = buildCpfEzPayFile({
      period: PERIOD,
      employerCsn: EMPLOYER_CSN,
      lines: [{ ...validLines[0], employee: { ...validLines[0].employee, nric: "S123|4567A" } }],
    });
    const dLine = out.split("\n")[1];
    expect(dLine.split("|")).toHaveLength(8); // D + 6 fixed columns + 1 self-help-fund column
    expect(dLine).not.toContain("S123|4567A");
  });
});

describe("validateCpfSubmission", () => {
  it("flags an employee missing dateOfBirth", () => {
    const lines = [
      validLines[0],
      {
        ...validLines[1],
        employee: { ...validLines[1].employee, dateOfBirth: null },
      },
    ];
    const result = validateCpfSubmission(lines);
    expect(result.valid).toBe(false);
    const offender = result.offending.find((o) => o.employeeNo === "E002");
    expect(offender).toBeDefined();
    expect(offender!.missingFields).toContain("dateOfBirth");
    // The fully-valid employee is not flagged.
    expect(result.offending.find((o) => o.employeeNo === "E001")).toBeUndefined();
  });

  it("returns valid:true with no offenders for a fully-populated fixture", () => {
    const result = validateCpfSubmission(validLines);
    expect(result.valid).toBe(true);
    expect(result.offending).toEqual([]);
  });
});
