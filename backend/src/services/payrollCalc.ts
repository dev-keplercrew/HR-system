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

// Annual ceiling on total Wages (OW + AW) subject to CPF for a calendar year.
// The Additional Wage ceiling for an employee = AW_CEILING_ANNUAL − (OW subject
// to CPF year-to-date). Config-driven at the route layer; this constant is the
// documented 2025 default.
export const AW_CEILING_ANNUAL = 102000;

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

// One admin-configurable CPF age band (backed by the CpfRateBand Prisma model).
// ageUpper is inclusive; null marks the highest band (no upper bound).
export interface CpfRateBand {
  ageUpper: number | null;
  employee: number;
  employer: number;
  label: string;
}

// Published 2025 default bands — used whenever the route layer doesn't supply an
// admin-configured override (e.g. CpfRateBand table not yet seeded). This is the
// ONLY place the 2025 rates are hardcoded; every caller can override via the
// optional `cpfRateBands` param so a 2026 revision is a data change, not a
// code deploy (config-driven at the CpfRateBand table, read in routes/payroll.ts).
export const DEFAULT_CPF_RATE_BANDS: CpfRateBand[] = [
  { ageUpper: 55, employee: 0.2, employer: 0.17, label: "<=55" },
  { ageUpper: 60, employee: 0.17, employer: 0.155, label: "56-60" },
  { ageUpper: 65, employee: 0.115, employer: 0.12, label: "61-65" },
  { ageUpper: 70, employee: 0.075, employer: 0.09, label: "66-70" },
  { ageUpper: null, employee: 0.05, employer: 0.075, label: ">70" },
];

function findCpfBand(age: number, bands: CpfRateBand[]): CpfRateBand {
  for (const band of bands) {
    if (band.ageUpper === null || age <= band.ageUpper) return band;
  }
  return bands[bands.length - 1];
}

// Age-banded contribution rates. Fractions of ordinary wage. Pass `bands` (read
// from the CpfRateBand table at the route layer) to use the admin-configured
// table instead of the DEFAULT_CPF_RATE_BANDS.
export function getCpfRates(age: number, bands: CpfRateBand[] = DEFAULT_CPF_RATE_BANDS): CpfRate {
  const band = findCpfBand(age, bands);
  return { employee: band.employee, employer: band.employer };
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
  cpfRateBands?: CpfRateBand[];
  // OW ceiling to clamp against. Defaults to the documented 2025 constant for
  // direct/legacy callers; calcCpfOwAw() passes its own resolved ceiling (or
  // Infinity for the AW leg, which is already bounded by the AW ceiling) so a
  // caller-supplied ceiling isn't silently overridden by the hardcoded default.
  owCeiling?: number;
}): CpfResult {
  const { ordinaryWage, age, workPassType } = params;
  if (!isCpfEligible(workPassType)) {
    return { ordinaryWage, cpfableWage: 0, employeeCpf: 0, employerCpf: 0, totalCpf: 0 };
  }
  const owCeiling = params.owCeiling ?? CPF_OW_CEILING;
  const cpfableWage = Math.min(ordinaryWage, owCeiling);
  const rates = getCpfRates(age, params.cpfRateBands);
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

// Human-readable label for the CPF age band an employee falls into. Surfaced on
// the payslip and API response so HR can see which band was applied (the client
// asked to "see which band was used"). Bands mirror getCpfRates() exactly.
export function cpfAgeBandLabel(age: number, bands: CpfRateBand[] = DEFAULT_CPF_RATE_BANDS): string {
  return findCpfBand(age, bands).label;
}

export interface OwAwCpfResult {
  ordinaryWage: number;
  additionalWage: number;
  owSubjectToCpf: number; // OW after the monthly OW ceiling
  awSubjectToCpf: number; // AW after the annual AW ceiling (given YTD OW)
  owCpf: CpfResult;
  awCpf: CpfResult;
  employeeCpf: number; // ow + aw employee CPF combined
  employerCpf: number; // ow + aw employer CPF combined
  totalCpf: number;
  cpfAgeBandLabel: string;
}

// Item 1 — compute CPF with an explicit Ordinary Wage / Additional Wage split.
// The OW ceiling (default CPF_OW_CEILING) caps OW per month; the AW ceiling
// (awCeilingAnnual − ytdOwSubjectToCpf) caps AW for the calendar year. Each
// component runs through calcCpf() so the age-banded rate table is reused once
// (no duplicated rates). Figures are rounded per-component — a documented
// simplification of CPF's actual combined-wage rounding (see DEMO SIMULATION banner).
export function calcCpfOwAw(params: {
  ordinaryWage: number;
  additionalWage?: number;
  ytdOwSubjectToCpf?: number;
  age: number;
  workPassType: WorkPassType;
  owCeiling?: number;
  awCeilingAnnual?: number;
  cpfRateBands?: CpfRateBand[];
}): OwAwCpfResult {
  const ordinaryWage = params.ordinaryWage || 0;
  const additionalWage = params.additionalWage || 0;
  const ytdOw = params.ytdOwSubjectToCpf || 0;
  const owCeiling = params.owCeiling ?? CPF_OW_CEILING;
  const awCeilingAnnual = params.awCeilingAnnual ?? AW_CEILING_ANNUAL;

  const owSubjectToCpf = Math.min(ordinaryWage, owCeiling);
  const awCeilingRemaining = Math.max(0, awCeilingAnnual - ytdOw);
  const awSubjectToCpf = Math.min(additionalWage, awCeilingRemaining);

  // owSubjectToCpf is already clamped to `owCeiling` above; pass the same
  // ceiling through so calcCpf's internal clamp is idempotent instead of
  // silently re-clamping to the hardcoded CPF_OW_CEILING default when a
  // caller (e.g. an admin-raised owCeiling) supplied a different one.
  // awSubjectToCpf is already bounded by the annual AW ceiling (a separate,
  // unrelated cap) — pass Infinity so it isn't re-clamped by the OW ceiling.
  const owCpf = calcCpf({ ordinaryWage: owSubjectToCpf, age: params.age, workPassType: params.workPassType, cpfRateBands: params.cpfRateBands, owCeiling });
  const awCpf = calcCpf({ ordinaryWage: awSubjectToCpf, age: params.age, workPassType: params.workPassType, cpfRateBands: params.cpfRateBands, owCeiling: Infinity });

  return {
    ordinaryWage,
    additionalWage,
    owSubjectToCpf,
    awSubjectToCpf,
    owCpf,
    awCpf,
    employeeCpf: owCpf.employeeCpf + awCpf.employeeCpf,
    employerCpf: owCpf.employerCpf + awCpf.employerCpf,
    totalCpf: owCpf.totalCpf + awCpf.totalCpf,
    cpfAgeBandLabel: cpfAgeBandLabel(params.age, params.cpfRateBands),
  };
}

// Item 7 — pro-rate a monthly wage for a mid-month joiner/leaver on a
// working-day basis. Returns the full wage when the employee worked the whole
// period; guards against divide-by-zero.
export function prorateWage(monthlyWage: number, workingDaysInPeriod: number, workingDaysWorked: number): number {
  if (workingDaysInPeriod <= 0) return 0;
  const worked = Math.max(0, Math.min(workingDaysWorked, workingDaysInPeriod));
  return Math.round((monthlyWage * worked) / workingDaysInPeriod);
}

// Item 7 — no-pay / unpaid-leave deduction at a given daily rate.
export function unpaidLeaveDeduction(dailyRate: number, unpaidDays: number): number {
  if (unpaidDays <= 0 || dailyRate <= 0) return 0;
  return Math.round(dailyRate * unpaidDays);
}

// Item 7 — daily rate from a monthly wage over the period's working days.
export function dailyRate(monthlyWage: number, workingDaysInPeriod: number): number {
  if (workingDaysInPeriod <= 0) return 0;
  return monthlyWage / workingDaysInPeriod;
}

export interface OtPayResult {
  pay: number;
  exceededCap: boolean;
  cappedHours: number;
}

// Item 7 — overtime pay at (by default) 1.5× the hourly basic rate, capped at
// the statutory 72 OT hours/month. Both the cap and the multiplier are
// admin-configurable (see StatutoryConfig.otCapHoursPerMonth/otMultiplier) —
// the defaults here are only the fallback when no config row exists yet.
// Exceeding the cap flags a warning rather than silently truncating pay for
// the disallowed hours.
export function otPay(
  hourlyBasicRate: number,
  otHours: number,
  capHoursPerMonth = 72,
  multiplier = 1.5
): OtPayResult {
  const hours = Math.max(0, otHours);
  const exceededCap = hours > capHoursPerMonth;
  const cappedHours = Math.min(hours, capHoursPerMonth);
  return {
    pay: Math.round(hourlyBasicRate * multiplier * cappedHours),
    exceededCap,
    cappedHours,
  };
}

export interface AllowanceLine {
  label: string;
  amount: number;
}

export interface AllowanceComponentInput {
  label: string;
  percentageOfBasic: number;
}

// Item 3 — split total allowances into named, itemised lines (MOM-mandated
// "allowances (itemised)" payslip requirement) rather than one synthetic
// figure. `components` come from the admin-editable AllowanceComponent table;
// an empty/undefined table falls back to a single legacy 10%-of-basic line so
// existing behaviour (and its total) is preserved when nothing is configured.
export function allowanceBreakdown(
  basicPay: number,
  components?: AllowanceComponentInput[]
): { lines: AllowanceLine[]; total: number } {
  const cfg = components && components.length > 0 ? components : [{ label: "Allowance", percentageOfBasic: 0.1 }];
  const lines = cfg.map((c) => ({ label: c.label, amount: Math.round(basicPay * c.percentageOfBasic) }));
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  return { lines, total };
}

export interface PayslipFigures {
  basicPay: number;
  allowances: number;
  grossPay: number;
  employeeCpf: number;
  employerCpf: number;
  netPay: number;
  totalCpf: number;
  // Item 1 additive fields (present even when additionalWage is omitted).
  ordinaryWage: number;
  additionalWage: number;
  owCpf: number;
  awCpf: number;
  cpfAgeBandLabel: string;
}

// Build the monetary lines for one employee's payslip for a period.
// Ordinary wage for CPF = basic + allowances. When additionalWage (bonus/
// commission/backpay) is supplied it is split out and the AW ceiling applies;
// when omitted the result is identical to the original OW-only behaviour, so
// existing callers/tests are unaffected. The additive OW/AW fields are always
// populated (additionalWage defaults to 0).
export function buildPayslip(params: {
  basicSalary: number;
  allowances?: number;
  additionalWage?: number;
  ytdOwSubjectToCpf?: number;
  dateOfBirth?: Date | string | null;
  workPassType?: WorkPassType;
  asOf?: Date;
  owCeiling?: number;
  awCeilingAnnual?: number;
  cpfRateBands?: CpfRateBand[];
}): PayslipFigures {
  const basicPay = params.basicSalary || 0;
  const allowances = params.allowances || 0;
  const additionalWage = params.additionalWage || 0;
  const ordinaryWage = basicPay + allowances;
  const grossPay = ordinaryWage + additionalWage;
  const age = ageFrom(params.dateOfBirth, params.asOf ?? new Date());
  const cpf = calcCpfOwAw({
    ordinaryWage,
    additionalWage,
    ytdOwSubjectToCpf: params.ytdOwSubjectToCpf,
    age,
    workPassType: params.workPassType,
    owCeiling: params.owCeiling,
    awCeilingAnnual: params.awCeilingAnnual,
    cpfRateBands: params.cpfRateBands,
  });
  const netPay = grossPay - cpf.employeeCpf;
  return {
    basicPay,
    allowances,
    grossPay,
    employeeCpf: cpf.employeeCpf,
    employerCpf: cpf.employerCpf,
    netPay,
    totalCpf: cpf.totalCpf,
    ordinaryWage,
    additionalWage,
    owCpf: cpf.owCpf.employeeCpf + cpf.owCpf.employerCpf,
    awCpf: cpf.awCpf.employeeCpf + cpf.awCpf.employerCpf,
    cpfAgeBandLabel: cpf.cpfAgeBandLabel,
  };
}
