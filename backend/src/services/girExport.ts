// GIRO bank-file export (simulation).
//
// ⚠️ DEMO SIMULATION — produces a GIRO-style fixed-field CSV/text batch, NOT a
// bank-certified GIRO file. Real GIRO submission uses bank-specific fixed-width
// formats and testing; this is a representative export for demonstration.

export interface GiroRecord {
  employeeNo: string;
  employeeName: string;
  bankName: string;
  bankAccount: string;
  amount: number; // net pay to credit
}

export interface GiroBatch {
  period: string;
  records: GiroRecord[];
}

// Shared 2dp money rounding, reused by bankAdapters.ts, cpfSubmission.ts,
// irasExport.ts and payslipPdf.ts so the rounding rule lives in one place
// instead of being reimplemented per module.
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Produce a GIRO-style CSV batch: a header row, one detail row per employee,
// and a trailer with the record count and control total.
export function buildGiroCsv(batch: GiroBatch): string {
  const lines: string[] = [];
  lines.push(`H,GIRO,${batch.period},${batch.records.length}`);
  let total = 0;
  for (const r of batch.records) {
    const amt = round2(r.amount);
    total += amt;
    lines.push(
      [
        "D",
        sanitizeCsvField(r.employeeNo),
        sanitizeCsvField(r.employeeName),
        sanitizeCsvField(r.bankName || "UNKNOWN"),
        (r.bankAccount || "").replace(/\s/g, ""),
        amt.toFixed(2),
      ].join(",")
    );
  }
  lines.push(`T,${batch.records.length},${round2(total).toFixed(2)}`);
  return lines.join("\n") + "\n";
}

// Shared CSV/text-delimiter-injection guard, reused by bankAdapters.ts,
// cpfSubmission.ts and irasExport.ts so the escaping rule lives in one place.
// Strips commas/pipes/newlines so the row stays well-formed regardless of
// which delimiter the caller's format uses (comma for GIRO/IRAS CSV, pipe for
// CPF EZPay and the IRAS AIS text layout — a literal delimiter character in a
// name/NRIC would otherwise desync every downstream column), then neutralizes
// spreadsheet-formula injection: a leading =, +, - or @ makes Excel/Sheets
// evaluate the cell as a formula when the file is opened. `uppercase` defaults
// to true (this file's original behavior); irasExport.ts opts out to preserve
// name casing.
export function sanitizeCsvField(s: string, opts: { uppercase?: boolean } = {}): string {
  const uppercase = opts.uppercase ?? true;
  let v = (s || "").replace(/[,|\r\n]/g, " ").trim();
  if (uppercase) v = v.toUpperCase();
  return /^[=+\-@]/.test(v) ? `'${v}` : v;
}
