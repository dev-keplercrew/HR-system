import { describe, it, expect } from "vitest";
import { calcCpf, buildPayslip, getCpfRates, CPF_OW_CEILING } from "../src/services/payrollCalc.js";

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
  });
});
