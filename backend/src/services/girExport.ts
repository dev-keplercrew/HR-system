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

// Produce a GIRO-style CSV batch: a header row, one detail row per employee,
// and a trailer with the record count and control total.
export function buildGiroCsv(batch: GiroBatch): string {
  const lines: string[] = [];
  lines.push(`H,GIRO,${batch.period},${batch.records.length}`);
  let total = 0;
  for (const r of batch.records) {
    const amt = Math.round(r.amount * 100) / 100;
    total += amt;
    lines.push(
      [
        "D",
        r.employeeNo,
        sanitize(r.employeeName),
        sanitize(r.bankName || "UNKNOWN"),
        (r.bankAccount || "").replace(/\s/g, ""),
        amt.toFixed(2),
      ].join(",")
    );
  }
  lines.push(`T,${batch.records.length},${(Math.round(total * 100) / 100).toFixed(2)}`);
  return lines.join("\n") + "\n";
}

function sanitize(s: string): string {
  // Strip commas/newlines so the CSV stays well-formed.
  const v = (s || "").replace(/[,\r\n]/g, " ").trim().toUpperCase();
  // Neutralize spreadsheet-formula injection: a leading =, +, - or @ makes
  // Excel/Sheets evaluate the cell as a formula when the file is opened.
  return /^[=+\-@]/.test(v) ? `'${v}` : v;
}
