import { describe, it, expect } from "vitest";
import {
  calcCpf,
  buildPayslip,
  getCpfRates,
  CPF_OW_CEILING,
  calcCpfOwAw,
  cpfAgeBandLabel,
  prorateWage,
  unpaidLeaveDeduction,
  dailyRate,
  otPay,
  DEFAULT_CPF_RATE_BANDS,
  type CpfRateBand,
} from "../src/services/payrollCalc.js";

describe("CPF calculation (2025 rates, private sector)", () => {
  it("computes employee/employer CPF for a citizen aged ≤55 below the ceiling", () => {
    const r = calcCpf({ ordinaryWage: 5000, age: 35, workPassType: "citizen" });
    expect(r.employeeCpf).toBe(1000); // 20% of 5000
    expect(r.employerCpf).toBe(850); //  17% of 5000
    expect(r.totalCpf).toBe(1850);
  });

  it("caps ordinary wage at the CPF ceiling", () => {
    const r = calcCpf({ ordinaryWage: 8000, age: 40, workPassType: "citizen" });
    expect(r.cpfableWage).toBe(CPF_OW_CEILING); // 7400
    expect(r.employeeCpf).toBe(1480); // 20% of 7400
    expect(r.employerCpf).toBe(1258); // 17% of 7400
  });

  it("applies age-banded rates for older employees", () => {
    expect(getCpfRates(35)).toEqual({ employee: 0.2, employer: 0.17 });
    expect(getCpfRates(62)).toEqual({ employee: 0.115, employer: 0.12 });
    const r = calcCpf({ ordinaryWage: 6000, age: 62, workPassType: "citizen" });
    expect(r.employeeCpf).toBe(690); // 11.5% of 6000
    expect(r.employerCpf).toBe(720); // 12% of 6000
  });

  it("charges no CPF for foreign work-pass holders (EP/SP/WP)", () => {
    for (const wp of ["ep", "sp", "wp"] as const) {
      const r = calcCpf({ ordinaryWage: 6000, age: 30, workPassType: wp });
      expect(r.totalCpf).toBe(0);
      expect(r.employeeCpf).toBe(0);
    }
  });

  it("builds a payslip with net = gross − employee CPF", () => {
    const p = buildPayslip({ basicSalary: 5000, allowances: 0, dateOfBirth: "1990-01-01", workPassType: "citizen" });
    expect(p.grossPay).toBe(5000);
    expect(p.employeeCpf).toBe(1000);
    expect(p.netPay).toBe(4000);
    // Additive OW/AW fields are populated even with no additional wage.
    expect(p.ordinaryWage).toBe(5000);
    expect(p.additionalWage).toBe(0);
    expect(p.cpfAgeBandLabel).toBe("<=55");
  });
});

describe("CPF age band edges (item 'Below 50 20%' → kept <=55 band)", () => {
  // getCpfRates and the band label must agree exactly at every boundary.
  it("keeps the <=55 band at 20%/17% (NOT changed to 50)", () => {
    expect(getCpfRates(54)).toEqual({ employee: 0.2, employer: 0.17 });
    expect(getCpfRates(55)).toEqual({ employee: 0.2, employer: 0.17 });
    expect(cpfAgeBandLabel(55)).toBe("<=55");
  });
  it("labels every band edge correctly at 56/60/65/70", () => {
    expect(cpfAgeBandLabel(56)).toBe("56-60");
    expect(cpfAgeBandLabel(60)).toBe("56-60");
    expect(cpfAgeBandLabel(61)).toBe("61-65");
    expect(cpfAgeBandLabel(65)).toBe("61-65");
    expect(cpfAgeBandLabel(66)).toBe("66-70");
    expect(cpfAgeBandLabel(70)).toBe("66-70");
    expect(cpfAgeBandLabel(71)).toBe(">70");
  });
  it("rates step down across 55→56 and 60→65 boundaries", () => {
    expect(getCpfRates(56)).toEqual({ employee: 0.17, employer: 0.155 });
    expect(getCpfRates(60)).toEqual({ employee: 0.17, employer: 0.155 });
    expect(getCpfRates(65)).toEqual({ employee: 0.115, employer: 0.12 });
    expect(getCpfRates(70)).toEqual({ employee: 0.075, employer: 0.09 });
  });
});

describe("CPF rate table is config-driven, not hardcoded (2026 revision = data change)", () => {
  // An admin-configured band table (as would be read from the CpfRateBand table
  // at the route layer) must override the published-2025 defaults everywhere the
  // rates are consumed — getCpfRates, cpfAgeBandLabel, calcCpf, calcCpfOwAw and
  // buildPayslip all the way through, so a 2026 rate revision needs no code change.
  const revised2026: CpfRateBand[] = [
    { ageUpper: 55, employee: 0.21, employer: 0.18, label: "<=55 (2026)" },
    { ageUpper: null, employee: 0.05, employer: 0.075, label: ">55 (2026)" },
  ];

  it("getCpfRates and cpfAgeBandLabel honor the override and ignore the default table", () => {
    expect(getCpfRates(35, revised2026)).toEqual({ employee: 0.21, employer: 0.18 });
    expect(cpfAgeBandLabel(35, revised2026)).toBe("<=55 (2026)");
    // Omitting the override still falls back to the published 2025 defaults.
    expect(getCpfRates(35)).toEqual({ employee: DEFAULT_CPF_RATE_BANDS[0].employee, employer: DEFAULT_CPF_RATE_BANDS[0].employer });
  });

  it("calcCpf produces different CPF figures under the override than under the default", () => {
    const withDefault = calcCpf({ ordinaryWage: 5000, age: 35, workPassType: "citizen" });
    const withOverride = calcCpf({ ordinaryWage: 5000, age: 35, workPassType: "citizen", cpfRateBands: revised2026 });
    expect(withOverride.employeeCpf).toBe(1050); // 21% of 5000
    expect(withOverride.employeeCpf).not.toBe(withDefault.employeeCpf);
  });

  it("buildPayslip threads the override all the way through to the persisted figures", () => {
    const p = buildPayslip({ basicSalary: 5000, allowances: 0, dateOfBirth: "1990-01-01", workPassType: "citizen", cpfRateBands: revised2026 });
    expect(p.employeeCpf).toBe(1050); // 21% under the override, not 1000 (20% default)
    expect(p.cpfAgeBandLabel).toBe("<=55 (2026)");
  });
});

describe("OW/AW split (item 1)", () => {
  it("caps OW at the ceiling — 7399 vs 7400 vs 7401", () => {
    const below = calcCpfOwAw({ ordinaryWage: 7399, additionalWage: 0, age: 35, workPassType: "citizen" });
    const at = calcCpfOwAw({ ordinaryWage: 7400, additionalWage: 0, age: 35, workPassType: "citizen" });
    const above = calcCpfOwAw({ ordinaryWage: 7401, additionalWage: 0, age: 35, workPassType: "citizen" });
    expect(below.owSubjectToCpf).toBe(7399);
    expect(at.owSubjectToCpf).toBe(7400);
    expect(above.owSubjectToCpf).toBe(7400); // capped
    expect(above.owCpf.employeeCpf).toBe(1480); // 20% of 7400
  });

  it("applies the AW ceiling = annual cap − YTD OW subject to CPF", () => {
    // YTD OW already 100000 → AW ceiling remaining = 102000 − 100000 = 2000.
    const r = calcCpfOwAw({
      ordinaryWage: 5000,
      additionalWage: 10000, // only 2000 is subject to CPF
      ytdOwSubjectToCpf: 100000,
      age: 35,
      workPassType: "citizen",
    });
    expect(r.awSubjectToCpf).toBe(2000);
    expect(r.awCpf.employeeCpf).toBe(400); // 20% of 2000
  });

  it("exhausts the AW ceiling fully — YTD OW at 102000 leaves zero AW room", () => {
    const r = calcCpfOwAw({ ordinaryWage: 5000, additionalWage: 8000, ytdOwSubjectToCpf: 102000, age: 40, workPassType: "citizen" });
    expect(r.awSubjectToCpf).toBe(0);
    expect(r.awCpf.totalCpf).toBe(0);
  });

  it("charges no OW/AW CPF for foreign work-pass holders", () => {
    const r = calcCpfOwAw({ ordinaryWage: 6000, additionalWage: 3000, age: 30, workPassType: "ep" });
    expect(r.totalCpf).toBe(0);
  });

  it("actually uses an admin-configured owCeiling above 7400, not the hardcoded default (config-driven mandate)", () => {
    // A raised owCeiling (e.g. a 2026 revision) must change the real computed
    // CPF money, not just the reported owSubjectToCpf figure.
    const r = calcCpfOwAw({ ordinaryWage: 7800, age: 40, workPassType: "citizen", owCeiling: 8000 });
    expect(r.owSubjectToCpf).toBe(7800);
    expect(r.owCpf.cpfableWage).toBe(7800);
    expect(r.owCpf.employeeCpf).toBe(1560); // 20% of 7800, NOT re-clamped to 7400*0.20=1480
  });

  it("also respects a LOWERED owCeiling below 7400", () => {
    const r = calcCpfOwAw({ ordinaryWage: 7000, age: 40, workPassType: "citizen", owCeiling: 6000 });
    expect(r.owSubjectToCpf).toBe(6000);
    expect(r.owCpf.employeeCpf).toBe(1200); // 20% of 6000
  });
});

describe("engine hardening (item 7)", () => {
  it("pro-rates a mid-month joiner on a working-day basis", () => {
    // 15 of 22 working days worked on a 4400 monthly wage.
    expect(prorateWage(4400, 22, 15)).toBe(3000);
    expect(prorateWage(4400, 22, 22)).toBe(4400); // full month
    expect(prorateWage(4400, 0, 10)).toBe(0); // guard divide-by-zero
  });

  it("deducts unpaid leave at the daily rate", () => {
    const rate = dailyRate(4400, 22); // 200/day
    expect(unpaidLeaveDeduction(rate, 3)).toBe(600);
    expect(unpaidLeaveDeduction(rate, 0)).toBe(0);
  });

  it("caps OT at 72 hours and warns beyond it", () => {
    const hourly = 20;
    const at72 = otPay(hourly, 72);
    const over = otPay(hourly, 73);
    expect(at72.exceededCap).toBe(false);
    expect(at72.pay).toBe(Math.round(20 * 1.5 * 72));
    expect(over.exceededCap).toBe(true);
    expect(over.cappedHours).toBe(72); // pay never exceeds the 72h cap
    expect(over.pay).toBe(at72.pay);
  });
});
