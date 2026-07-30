// ⚠️ DEMO SIMULATION — NOT A CERTIFIED INTEGRATION.
//
// Pure reconciliation helpers: parse an uploaded bank statement CSV and match
// credited amounts against a payroll run's payslip net pay. No DB / Prisma here —
// the route layer owns parsing the upload and persisting results.

export interface BankStatementLineParsed {
  rawLine: string;
  amount: number;
  reference: string;
}

// Minimal CSV-quote-aware split: a plain `line.split(",")` desyncs on a bank
// export's common "Lastname, Firstname" quoted-field convention (a comma
// INSIDE a quoted field would otherwise be treated as a column separator).
// Handles double-quoted fields with "" as an escaped quote; unquoted fields
// pass through unchanged.
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

/**
 * Parse a simple bank statement CSV.
 *
 * Accepts rows of the form `reference,name,amount` OR `reference,amount`.
 * Lenient rules:
 *  - the amount is the LAST numeric field on the line,
 *  - the reference is the FIRST field,
 *  - blank lines are skipped,
 *  - an optional header row is skipped (detected when the last field is not a
 *    parseable number).
 * Fields are trimmed; amount is parsed as a float.
 */
export function parseBankStatementCsv(csvText: string): BankStatementLineParsed[] {
  const out: BankStatementLineParsed[] = [];

  for (const rawLine of csvText.split(/\r?\n/)) {
    if (rawLine.trim() === "") continue; // skip blank lines

    const fields = splitCsvLine(rawLine).map((f) => f.trim());
    const lastField = fields[fields.length - 1];
    const amount = parseFloat(lastField);

    // Header / non-numeric last field → skip (treated as header row).
    if (!Number.isFinite(amount) || lastField === "") continue;

    out.push({
      rawLine,
      amount,
      reference: fields[0] ?? "",
    });
  }

  return out;
}

export interface ReconcilePayslip {
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  netPay: number;
}

export interface ReconcileLineResult {
  rawLine: string;
  amount: number;
  reference: string;
  matchedEmployeeId: number | null;
  matchedAmount: number | null;
  status: "matched" | "unmatched" | "amount-mismatch";
}

export interface ReconcileReport {
  results: ReconcileLineResult[];
  summary: {
    matched: number;
    unmatched: number;
    amountMismatch: number;
    total: number;
  };
}

/**
 * Reconcile parsed bank statement lines against payslip net pay.
 *
 * Matching rules (case-insensitive), for each line in order:
 *  - find an unconsumed payslip whose employeeNo equals the line's reference,
 *    falling back to a payslip whose employeeName equals the line's reference;
 *  - no candidate            → "unmatched", matchedEmployeeId = null;
 *  - candidate & |amount − netPay| <= tolerance → "matched";
 *  - candidate & amount differs beyond tolerance → "amount-mismatch".
 * A payslip matches at most one line (consumed once used).
 */
export function matchAgainstPayslips(
  lines: BankStatementLineParsed[],
  payslips: ReconcilePayslip[],
  opts?: { tolerance?: number },
): ReconcileReport {
  const tolerance = opts?.tolerance ?? 0.01;

  const consumed = new Set<number>(); // indices of payslips already matched
  const results: ReconcileLineResult[] = [];

  let matched = 0;
  let unmatched = 0;
  let amountMismatch = 0;

  for (const line of lines) {
    const ref = line.reference.trim().toLowerCase();

    // Match reference against employeeNo first, then employeeName.
    let candidateIdx = payslips.findIndex(
      (p, i) => !consumed.has(i) && p.employeeNo.trim().toLowerCase() === ref,
    );
    if (candidateIdx === -1) {
      candidateIdx = payslips.findIndex(
        (p, i) => !consumed.has(i) && p.employeeName.trim().toLowerCase() === ref,
      );
    }

    if (candidateIdx === -1) {
      results.push({
        rawLine: line.rawLine,
        amount: line.amount,
        reference: line.reference,
        matchedEmployeeId: null,
        matchedAmount: null,
        status: "unmatched",
      });
      unmatched++;
      continue;
    }

    const payslip = payslips[candidateIdx];
    consumed.add(candidateIdx);

    const status: ReconcileLineResult["status"] =
      Math.abs(line.amount - payslip.netPay) <= tolerance ? "matched" : "amount-mismatch";

    if (status === "matched") matched++;
    else amountMismatch++;

    results.push({
      rawLine: line.rawLine,
      amount: line.amount,
      reference: line.reference,
      matchedEmployeeId: payslip.employeeId,
      matchedAmount: payslip.netPay,
      status,
    });
  }

  return {
    results,
    summary: {
      matched,
      unmatched,
      amountMismatch,
      total: results.length,
    },
  };
}
