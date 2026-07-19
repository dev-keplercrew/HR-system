// ---------------------------------------------------------------------------
// Singapore CPF / payroll calculation.
//
// ⚠️ DEMO SIMULATION — NOT A CERTIFIED INTEGRATION.
// CPF contributions are computed from the PUBLISHED CPF contribution rate tables
// (private-sector employees, 2025 rates). This is a functional simulation for
// demonstration only; it is NOT a CPF Board / IRAS certified payroll engine and
// must not be used for actual statutory filing without proper certification.
// Source of rate structure: CPF Board contribution rates (2025).
// ---------------------------------------------------------------------------

// Ordinary Wage ceiling subject to CPF (2025: S$7,400/month).
export const CPF_OW_CEILING = 7400;

export type WorkPassType = "citizen" | "pr" | "ep" | "sp" | "wp" | null | undefined;

// Only Citizens and Permanent Residents contribute to CPF. Foreign work-pass
// holders (EP/SP/WP) do not — their employers pay other levies instead.
export function isCpfEligible(workPassType: WorkPassType): boolean {
  return workPassType === "citizen" || workPassType === "pr";
}

interface CpfRate {
  employee: number; // fraction of ordinary wage
  employer: number;
}

// Age-banded contribution rates (private sector, 2025). Fractions of ordinary wage.
export function getCpfRates(age: number): CpfRate {
  if (age <= 55) return { employee: 0.2, employer: 0.17 };
  if (age <= 60) return { employee: 0.17, employer: 0.155 };
  if (age <= 65) return { employee: 0.115, employer: 0.12 };
  if (age <= 70) return { employee: 0.075, employer: 0.09 };
  return { employee: 0.05, employer: 0.075 };
}

// Throws when dateOfBirth is missing rather than silently assuming an age —
// guessing an age can put an employee in the wrong CPF contribution band.
export function ageFrom(dateOfBirth: Date | string | null | undefined, asOf: Date = new Date()): number {
  if (!dateOfBirth) {
    throw new Error("Cannot compute CPF age: employee dateOfBirth is missing");
  }
  const dob = new Date(dateOfBirth);
  let age = asOf.getFullYear() - dob.getFullYear();
  const m = asOf.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && asOf.getDate() < dob.getDate())) age--;
  return age;
}

export interface CpfResult {
  ordinaryWage: number;
  cpfableWage: number;
  employeeCpf: number;
  employerCpf: number;
  totalCpf: number;
}

// Compute CPF for one month's ordinary wage. Figures rounded to the nearest dollar
// (documented simplification of CPF's actual rounding rules).
export function calcCpf(params: {
  ordinaryWage: number;
  age: number;
  workPassType: WorkPassType;
}): CpfResult {
  const { ordinaryWage, age, workPassType } = params;
  if (!isCpfEligible(workPassType)) {
    return { ordinaryWage, cpfableWage: 0, employeeCpf: 0, employerCpf: 0, totalCpf: 0 };
  }
  const cpfableWage = Math.min(ordinaryWage, CPF_OW_CEILING);
  const rates = getCpfRates(age);
  const employeeCpf = Math.round(cpfableWage * rates.employee);
  const employerCpf = Math.round(cpfableWage * rates.employer);
  return {
    ordinaryWage,
    cpfableWage,
    employeeCpf,
    employerCpf,
    totalCpf: employeeCpf + employerCpf,
  };
}

export interface PayslipFigures {
  basicPay: number;
  allowances: number;
  grossPay: number;
  employeeCpf: number;
  employerCpf: number;
  netPay: number;
  totalCpf: number;
}

// Build the monetary lines for one employee's payslip for a period.
// Ordinary wage for CPF = basic + allowances (simplified; no additional-wage split).
export function buildPayslip(params: {
  basicSalary: number;
  allowances?: number;
  dateOfBirth?: Date | string | null;
  workPassType?: WorkPassType;
  asOf?: Date;
}): PayslipFigures {
  const basicPay = params.basicSalary || 0;
  const allowances = params.allowances || 0;
  const grossPay = basicPay + allowances;
  const age = ageFrom(params.dateOfBirth, params.asOf ?? new Date());
  const cpf = calcCpf({ ordinaryWage: grossPay, age, workPassType: params.workPassType });
  const netPay = grossPay - cpf.employeeCpf;
  return {
    basicPay,
    allowances,
    grossPay,
    employeeCpf: cpf.employeeCpf,
    employerCpf: cpf.employerCpf,
    netPay,
    totalCpf: cpf.totalCpf,
  };
}
