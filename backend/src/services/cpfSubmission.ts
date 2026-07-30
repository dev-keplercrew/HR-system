// CPF EZPay monthly submission-file generator (simulation).
//
// ⚠️ DEMO SIMULATION — NOT A CERTIFIED INTEGRATION.
//
// LIMITATIONS (read before relying on this):
//  - MASKED NRIC: Employee.nric is stored MASKED by existing system design
//    (e.g. "S****123A"). Validation here can therefore only check that an NRIC
//    value is PRESENT — it CANNOT verify a real, unmasked, checksum-valid NRIC.
//    Any "valid" result attests presence only, never correctness of the NRIC.
//  - REPRESENTATIVE LAYOUT: The CPF EZPay field layout produced below is a
//    representative, ASSUMED layout. There is no public certified EZPay file
//    spec bundled here; column order/content are for demonstration only and
//    must NOT be submitted to CPF as-is.
//
// Design contract:
//  - buildCpfEzPayFile() does NOT re-validate. The HTTP route MUST call
//    validateCpfSubmission() first and return 400 with the offending list when
//    invalid; buildCpfEzPayFile() assumes it receives already-valid input.
//  - The employer CSN is admin-configurable and is always passed in via params.
//    It is NEVER hardcoded in this module.

import { sanitizeCsvField as sanitize, round2 } from "./girExport.js";

// ---- Plain, Prisma-free input interfaces (kept pure/testable) --------------

interface CpfEmployee {
  employeeNo: string;
  firstName: string;
  lastName: string;
  nric?: string | null;
  dateOfBirth?: Date | string | null;
  workPassType?: string | null;
  nationality?: string | null;
}

interface CpfPayslipLine {
  employee: CpfEmployee;
  ordinaryWage: number;
  additionalWage: number;
  employeeCpf: number;
  employerCpf: number;
  totalCpf: number;
  selfHelpFundDeductions?: string | null; // JSON string, e.g. {"CDAC":1.5}
}

export interface CpfValidationResult {
  valid: boolean;
  offending: { employeeNo: string; missingFields: string[] }[];
}

// A value is "present" when it is a non-null, non-empty (after trim) string, or
// any Date. Numbers/other truthy scalars also count as present.
function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (v instanceof Date) return !isNaN(v.getTime());
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

// Fields the CPF submission requires per employee.
const REQUIRED_FIELDS: { key: keyof CpfEmployee; name: string }[] = [
  { key: "nric", name: "nric" },
  { key: "dateOfBirth", name: "dateOfBirth" },
  { key: "workPassType", name: "workPassType" },
  { key: "nationality", name: "nationality" },
];

/**
 * Validate each payslip line's employee for PRESENCE of the CPF-required
 * fields. See file banner for the masked-NRIC limitation (presence only).
 */
export function validateCpfSubmission(lines: CpfPayslipLine[]): CpfValidationResult {
  const offending: { employeeNo: string; missingFields: string[] }[] = [];
  for (const line of lines) {
    const emp = line.employee;
    const missingFields: string[] = [];
    for (const f of REQUIRED_FIELDS) {
      if (!isPresent(emp[f.key])) missingFields.push(f.name);
    }
    if (missingFields.length > 0) {
      offending.push({ employeeNo: emp.employeeNo, missingFields });
    }
  }
  return { valid: offending.length === 0, offending };
}

// Parse the self-help-fund JSON string into a normalized fund->amount map.
// Malformed / empty JSON yields an empty map (no throw — the value is optional).
function parseSelfHelpFunds(json?: string | null): Record<string, number> {
  if (!json || !json.trim()) return {};
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (!isNaN(n)) out[sanitize(k)] = n;
    }
    return out;
  } catch {
    return {};
  }
}

// Deterministic, sorted list of every fund key appearing across all lines, so
// the per-fund breakdown columns are stable regardless of input JSON key order.
function collectFundKeys(lines: CpfPayslipLine[]): string[] {
  const keys = new Set<string>();
  for (const line of lines) {
    for (const k of Object.keys(parseSelfHelpFunds(line.selfHelpFundDeductions))) {
      keys.add(k);
    }
  }
  return Array.from(keys).sort();
}

function money(n: number): string {
  return round2(Number(n) || 0).toFixed(2);
}

/**
 * Build the CPF EZPay monthly submission text file (representative layout).
 *
 * Assumes `params.lines` has already passed validateCpfSubmission() — the route
 * gates on validation; this function does NOT re-validate.
 *
 * FILE LAYOUT (pipe-delimited, deterministic, trailing newline):
 *   Header:  H|CPF-EZPAY|<employerCsn>|<period>|<recordCount>
 *   Detail:  D|<employeeNo>|<nric>|<ordinaryWage>|<additionalWage>|<totalCpf>|<shfTotal>[|<fund>=<amt> ...]
 *            The self-help-fund breakdown columns are one column per fund key,
 *            in sorted key order across the whole run, emitted as "<FUND>=<amt>".
 *            <shfTotal> is the sum of that employee's parsed fund amounts.
 *   Trailer: T|<recordCount>|<controlTotalOfTotalCpf>
 * All amounts are formatted to 2 decimal places. Text fields are sanitized.
 */
export function buildCpfEzPayFile(params: {
  period: string;
  employerCsn: string;
  lines: CpfPayslipLine[];
}): string {
  const { period, employerCsn, lines } = params;
  const fundKeys = collectFundKeys(lines);

  const out: string[] = [];
  out.push(
    ["H", "CPF-EZPAY", sanitize(employerCsn), sanitize(period), String(lines.length)].join("|")
  );

  let controlTotal = 0;
  for (const line of lines) {
    const emp = line.employee;
    const funds = parseSelfHelpFunds(line.selfHelpFundDeductions);
    const shfTotal = Object.values(funds).reduce((a, b) => a + b, 0);
    controlTotal += Number(line.totalCpf) || 0;

    const detail = [
      "D",
      sanitize(emp.employeeNo),
      sanitize(emp.nric || ""),
      money(line.ordinaryWage),
      money(line.additionalWage),
      money(line.totalCpf),
      money(shfTotal),
      ...fundKeys.map((k) => `${k}=${money(funds[k] ?? 0)}`),
    ];
    out.push(detail.join("|"));
  }

  out.push(["T", String(lines.length), money(controlTotal)].join("|"));
  return out.join("\n") + "\n";
}
