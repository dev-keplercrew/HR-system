// Pluggable per-bank GIRO adapters (client gap-list item 6, part 1).
//
// ⚠️ DEMO SIMULATION — NOT A CERTIFIED INTEGRATION.
// Each bank layout below (DBS IDEAL, OCBC Velocity, UOB fixed-width) is a
// REPRESENTATIVE format for demonstration only. It is NOT a bank-certified GIRO
// spec: real DBS IDEAL / OCBC Velocity / UOB bulk-payment files use proprietary,
// bank-issued layouts and must be validated through each bank's own certification
// and test cycle. Do NOT submit output from these adapters to a live bank.

import { buildGiroCsv, sanitizeCsvField as sanitize, round2 } from "./girExport.js";
import type { GiroBatch, GiroRecord } from "./girExport.js";

// Re-export the frozen contract types so callers can import them from here too.
export type { GiroBatch, GiroRecord } from "./girExport.js";

export interface GiroBankAdapter {
  key: string;
  label: string;
  build(batch: GiroBatch): string;
}

// Shared header/detail/trailer assembly reused by every fixed-structure adapter
// below: each adapter supplies its own field layout via the three callbacks,
// while the record loop and running-total accumulation live in one place.
// `detailLine` returns the amount it contributed so accumulation stays generic
// whether the adapter totals in dollars (DBS/OCBC) or integer cents (UOB).
function buildLines(
  batch: GiroBatch,
  header: (count: number) => string,
  detailLine: (r: GiroRecord) => { line: string; amount: number },
  trailer: (count: number, total: number) => string
): string {
  const lines: string[] = [header(batch.records.length)];
  let total = 0;
  for (const r of batch.records) {
    const { line, amount } = detailLine(r);
    total += amount;
    lines.push(line);
  }
  lines.push(trailer(batch.records.length, total));
  return lines.join("\n") + "\n";
}

// ── generic ────────────────────────────────────────────────────────────────
// The existing girExport CSV, kept as the "generic" adapter. Delegates so the
// byte-for-byte format stays owned by girExport.ts.
export const genericAdapter: GiroBankAdapter = {
  key: "generic",
  label: "Generic GIRO CSV",
  build(batch: GiroBatch): string {
    return buildGiroCsv(batch);
  },
};

// ── DBS IDEAL ────────────────────────────────────────────────────────────────
// Representative comma-delimited layout distinct from generic: it carries a
// batch reference and a value-date placeholder in the header.
//   header:  HDR,IBG,<period>,<batchRef>,<valueDate>,<count>
//   detail:  DTL,<employeeNo>,<NAME>,<BANK>,<account no spaces>,<amt.toFixed(2)>
//   trailer: TRL,<count>,<total.toFixed(2)>
// batchRef  = "DBS" + period with the "-" removed (e.g. DBS202507).
// valueDate = "VALUE-DATE" placeholder (no real settlement date is simulated).
export const dbsIdealAdapter: GiroBankAdapter = {
  key: "dbs",
  label: "DBS IDEAL (IBG)",
  build(batch: GiroBatch): string {
    const batchRef = `DBS${batch.period.replace(/-/g, "")}`;
    const valueDate = "VALUE-DATE";
    return buildLines(
      batch,
      (count) => `HDR,IBG,${batch.period},${batchRef},${valueDate},${count}`,
      (r) => {
        const amt = round2(r.amount);
        return {
          amount: amt,
          line: [
            "DTL",
            sanitize(r.employeeNo),
            sanitize(r.employeeName),
            sanitize(r.bankName || "UNKNOWN"),
            (r.bankAccount || "").replace(/\s/g, ""),
            amt.toFixed(2),
          ].join(","),
        };
      },
      (count, total) => `TRL,${count},${round2(total).toFixed(2)}`
    );
  },
};

// ── OCBC Velocity ────────────────────────────────────────────────────────────
// Representative comma-delimited layout with a distinct field order and prefix
// codes (numeric record-type codes instead of letters, account before name).
//   header:  01,VELOCITY,<period>,<count>
//   detail:  02,<employeeNo>,<account no spaces>,<NAME>,<BANK>,<amt.toFixed(2)>
//   trailer: 09,<count>,<total.toFixed(2)>
export const ocbcVelocityAdapter: GiroBankAdapter = {
  key: "ocbc",
  label: "OCBC Velocity",
  build(batch: GiroBatch): string {
    return buildLines(
      batch,
      (count) => `01,VELOCITY,${batch.period},${count}`,
      (r) => {
        const amt = round2(r.amount);
        return {
          amount: amt,
          line: [
            "02",
            sanitize(r.employeeNo),
            (r.bankAccount || "").replace(/\s/g, ""),
            sanitize(r.employeeName),
            sanitize(r.bankName || "UNKNOWN"),
            amt.toFixed(2),
          ].join(","),
        };
      },
      (count, total) => `09,${count},${round2(total).toFixed(2)}`
    );
  },
};

// ── UOB fixed-width ──────────────────────────────────────────────────────────
// Genuine fixed-width layout. Every line is the SAME total width; each field
// occupies a documented column range. Text fields are right-padded with spaces
// (left-justified); numeric fields are left-padded with zeros (right-justified).
// Amount is expressed in CENTS with NO decimal point (standard fixed-width GIRO
// convention), zero-padded to 13 digits.
//
//   RECORD TYPE (col 1-2): "10" header, "20" detail, "90" trailer.
//
//   Header  (record type 10):
//     cols 1-2    (2)  record type      = "10"
//     cols 3-10   (8)  batch label      = "UOBGIRO " (right-padded)
//     cols 11-17  (7)  period           right-padded (e.g. "2025-07")
//     cols 18-23  (6)  record count     zero-padded
//     total width = 23
//
//   Detail  (record type 20):
//     cols 1-2    (2)  record type      = "20"
//     cols 3-12   (10) employee no      right-padded
//     cols 13-42  (30) employee name    right-padded (sanitised, no commas)
//     cols 43-62  (20) bank name        right-padded (sanitised, no commas)
//     cols 63-79  (17) account number   right-padded (spaces stripped)
//     cols 80-92  (13) amount in cents  zero-padded, no decimal point
//     total width = 92
//
//   Trailer (record type 90):
//     cols 1-2    (2)  record type      = "90"
//     cols 3-8    (6)  record count     zero-padded
//     cols 9-23   (15) total in cents   zero-padded, no decimal point
//     total width = 23
function padRight(s: string, width: number): string {
  return (s || "").slice(0, width).padEnd(width, " ");
}
function padZero(n: number, width: number): string {
  return String(n).padStart(width, "0");
}
export const uobFixedWidthAdapter: GiroBankAdapter = {
  key: "uob",
  label: "UOB (fixed-width)",
  build(batch: GiroBatch): string {
    return buildLines(
      batch,
      (count) => "10" + padRight("UOBGIRO ", 8) + padRight(batch.period, 7) + padZero(count, 6),
      (r) => {
        const cents = Math.round(round2(r.amount) * 100);
        return {
          amount: cents,
          line:
            "20" +
            padRight(r.employeeNo, 10) +
            padRight(sanitize(r.employeeName), 30) +
            padRight(sanitize(r.bankName || "UNKNOWN"), 20) +
            padRight((r.bankAccount || "").replace(/\s/g, ""), 17) +
            padZero(cents, 13),
        };
      },
      (count, totalCents) => "90" + padZero(count, 6) + padZero(totalCents, 15)
    );
  },
};

// ── registry ─────────────────────────────────────────────────────────────────
const REGISTRY: Record<string, GiroBankAdapter> = {
  generic: genericAdapter,
  dbs: dbsIdealAdapter,
  ocbc: ocbcVelocityAdapter,
  uob: uobFixedWidthAdapter,
};

export function getBankAdapter(key: string): GiroBankAdapter {
  const adapter = REGISTRY[key];
  if (!adapter) {
    throw Object.assign(new Error(`Unknown bank format: ${key}`), { status: 400 });
  }
  return adapter;
}
