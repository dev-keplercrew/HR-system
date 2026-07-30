import { sanitizeCsvField, round2 } from "./girExport.js";

// ---------------------------------------------------------------------------
// Singapore IRAS Auto-Inclusion Scheme (AIS) exports — IR8A / Appendix 8A /
// IR8S / IR21.
//
// ⚠️ DEMO SIMULATION — NOT A CERTIFIED INTEGRATION.
//
// The field layouts below are a REPRESENTATIVE, ASSUMED IRAS AIS layout. There
// is NO public certified spec bundled here, so the exact field order, tags and
// record structure are our own documented convention chosen to be deterministic
// and human-auditable. These outputs are for demonstration only and are NOT
// submission-ready — real AIS submission uses IRAS-certified software / the
// IRAS API with validated fixed formats. Do not file these as-is.
//
// This module intentionally defines its OWN plain input interfaces (no Prisma
// types) so it stays pure and unit-testable: callers aggregate already-computed
// Payslip figures into IrasPayslipYear[] and pass employee metadata in.
// ---------------------------------------------------------------------------

// --- Plain input types (deliberately NOT Prisma-derived) -------------------

export interface IrasEmployee {
  employeeNo: string;
  firstName: string;
  lastName: string;
  nric?: string | null;
  nationality?: string | null;
  dateOfBirth?: Date | string | null;
  workPassType?: string | null;
}

// One entry per payslip issued to the employee in the calendar year.
export interface IrasPayslipYear {
  grossPay: number;
  employeeCpf: number;
  employerCpf: number;
}

// --- Output record types ---------------------------------------------------

export interface Ir8aRecord {
  employee: IrasEmployee;
  year: number;
  totalIncome: number;
  totalEmployeeCpf: number;
  totalEmployerCpf: number;
  donations: number;
  benefitsInKind: number;
}

export interface Appendix8aBenefit {
  description: string;
  amount: number;
}

export interface Appendix8aRecord {
  employee: IrasEmployee;
  benefits: Appendix8aBenefit[];
  total: number;
}

export interface Ir8sRecord {
  employee: IrasEmployee;
  excessCpf: number;
}

export interface Ir21Record {
  employee: IrasEmployee;
  clearanceDate: string;
  applicable: boolean;
}

// CSV-injection guard, shared with girExport.ts/bankAdapters.ts/cpfSubmission.ts.
// Unlike those (GIRO/CPF) formats this preserves original case (names/
// descriptions read better in the human-facing IRAS CSV/AIS text).
function sanitize(s: string): string {
  return sanitizeCsvField(s ?? "", { uppercase: false });
}

// Escape the five XML special characters for text nodes/attributes.
function xmlEscape(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Round to cents deterministically.
function money(n: number): number {
  return round2(n || 0);
}

function fullName(e: IrasEmployee): string {
  return `${e.firstName} ${e.lastName}`.trim();
}

function toDateString(d: Date | string): string {
  // Deterministic YYYY-MM-DD (UTC) so text/XML/CSV output does not depend on
  // the host timezone.
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
}

// --- Builders --------------------------------------------------------------

// IR8A annual return: aggregate a year of payslips into one income record.
// income = Σ grossPay, employeeCpf = Σ employeeCpf, employerCpf = Σ employerCpf.
export function buildIr8a(
  employee: IrasEmployee,
  yearPayslips: IrasPayslipYear[],
  year: number,
  opts?: { donations?: number; benefitsInKind?: number }
): Ir8aRecord {
  const slips = yearPayslips || [];
  const totalIncome = money(slips.reduce((s, p) => s + (p.grossPay || 0), 0));
  const totalEmployeeCpf = money(slips.reduce((s, p) => s + (p.employeeCpf || 0), 0));
  const totalEmployerCpf = money(slips.reduce((s, p) => s + (p.employerCpf || 0), 0));
  return {
    employee,
    year,
    totalIncome,
    totalEmployeeCpf,
    totalEmployerCpf,
    donations: money(opts?.donations ?? 0),
    benefitsInKind: money(opts?.benefitsInKind ?? 0),
  };
}

// Appendix 8A — benefits-in-kind detail lines with a summed total.
export function buildAppendix8a(
  employee: IrasEmployee,
  benefits: Appendix8aBenefit[]
): Appendix8aRecord {
  const rows = (benefits || []).map((b) => ({ description: b.description, amount: money(b.amount) }));
  const total = money(rows.reduce((s, b) => s + b.amount, 0));
  return { employee, benefits: rows, total };
}

// IR8S — excess CPF contributions (e.g. over the annual wage ceiling) to refund.
export function buildIr8s(employee: IrasEmployee, excessCpf: number): Ir8sRecord {
  return { employee, excessCpf: money(excessCpf) };
}

// IR21 — tax clearance for DEPARTING FOREIGN employees only. Tax clearance is
// required for foreign work-pass holders (EP/SP/WP); Citizens/PRs are not in
// scope, so `applicable` is true only for those pass types.
export function buildIr21(employee: IrasEmployee, clearanceDate: Date | string): Ir21Record {
  const pass = (employee.workPassType ?? "").toLowerCase();
  const applicable = pass === "ep" || pass === "sp" || pass === "wp";
  return { employee, clearanceDate: toDateString(clearanceDate), applicable };
}

// Flag employees who cannot be filed with correct figures. An IR8A record needs
// a valid identity (NRIC/FIN) and a date of birth; missing either means the
// caller should exclude or manually review the employee rather than emitting a
// wrong return.
export function ir8aEligible(employee: IrasEmployee): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!employee.nric) missing.push("nric");
  if (!employee.dateOfBirth) missing.push("dateOfBirth");
  return { ok: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// AIS-style fixed-line TEXT layout (REPRESENTATIVE / assumed).
//
// Record types, one per line, pipe-delimited. Documented field order:
//   H1|<year>|<recordCount>                          (header)
//   A8A|<employeeNo>|<fullName>|<nric>|<year>|<totalIncome>|<totalEmployeeCpf>|
//       <totalEmployerCpf>|<donations>|<benefitsInKind>   (one per IR8A record)
//   T1|<recordCount>|<sumTotalIncome>                (trailer / control total)
// All money fields are printed with 2 decimals. Deterministic ordering: records
// are emitted in the order supplied by the caller.
// ---------------------------------------------------------------------------
export function renderIrasAisText(records: Ir8aRecord[]): string {
  const recs = records || [];
  const year = recs.length ? recs[0].year : 0;
  const lines: string[] = [];
  lines.push(`H1|${year}|${recs.length}`);
  let sumIncome = 0;
  for (const r of recs) {
    sumIncome += r.totalIncome;
    lines.push(
      [
        "A8A",
        sanitize(r.employee.employeeNo),
        sanitize(fullName(r.employee)),
        sanitize(r.employee.nric ?? ""),
        r.year,
        r.totalIncome.toFixed(2),
        r.totalEmployeeCpf.toFixed(2),
        r.totalEmployerCpf.toFixed(2),
        r.donations.toFixed(2),
        r.benefitsInKind.toFixed(2),
      ].join("|")
    );
  }
  lines.push(`T1|${recs.length}|${money(sumIncome).toFixed(2)}`);
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// AIS-style XML layout (REPRESENTATIVE / assumed). Well-formed, special chars
// escaped. Structure:
//   <IR8AReturn year="..." count="...">
//     <Employee>
//       <EmployeeNo/> <Name/> <NRIC/> <TotalIncome/> <EmployeeCPF/>
//       <EmployerCPF/> <Donations/> <BenefitsInKind/>
//     </Employee> ...
//   </IR8AReturn>
// ---------------------------------------------------------------------------
export function renderIrasAisXml(records: Ir8aRecord[]): string {
  const recs = records || [];
  const year = recs.length ? recs[0].year : 0;
  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<IR8AReturn year="${xmlEscape(String(year))}" count="${recs.length}">`);
  for (const r of recs) {
    parts.push(`  <Employee>`);
    parts.push(`    <EmployeeNo>${xmlEscape(r.employee.employeeNo)}</EmployeeNo>`);
    parts.push(`    <Name>${xmlEscape(fullName(r.employee))}</Name>`);
    parts.push(`    <NRIC>${xmlEscape(r.employee.nric ?? "")}</NRIC>`);
    parts.push(`    <TotalIncome>${r.totalIncome.toFixed(2)}</TotalIncome>`);
    parts.push(`    <EmployeeCPF>${r.totalEmployeeCpf.toFixed(2)}</EmployeeCPF>`);
    parts.push(`    <EmployerCPF>${r.totalEmployerCpf.toFixed(2)}</EmployerCPF>`);
    parts.push(`    <Donations>${r.donations.toFixed(2)}</Donations>`);
    parts.push(`    <BenefitsInKind>${r.benefitsInKind.toFixed(2)}</BenefitsInKind>`);
    parts.push(`  </Employee>`);
  }
  parts.push(`</IR8AReturn>`);
  return parts.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Human-readable CSV. Documented header row + one row per employee. Text fields
// (name, NRIC) pass through sanitize() to block CSV-formula injection. Column
// order matches the header exactly:
//   EmployeeNo,Name,NRIC,Year,TotalIncome,EmployeeCPF,EmployerCPF,Donations,BenefitsInKind
// ---------------------------------------------------------------------------
export const IRAS_CSV_HEADER =
  "EmployeeNo,Name,NRIC,Year,TotalIncome,EmployeeCPF,EmployerCPF,Donations,BenefitsInKind";

export function renderIrasCsv(records: Ir8aRecord[]): string {
  const lines: string[] = [IRAS_CSV_HEADER];
  for (const r of records || []) {
    lines.push(
      [
        sanitize(r.employee.employeeNo),
        sanitize(fullName(r.employee)),
        sanitize(r.employee.nric ?? ""),
        r.year,
        r.totalIncome.toFixed(2),
        r.totalEmployeeCpf.toFixed(2),
        r.totalEmployerCpf.toFixed(2),
        r.donations.toFixed(2),
        r.benefitsInKind.toFixed(2),
      ].join(",")
    );
  }
  return lines.join("\n") + "\n";
}
