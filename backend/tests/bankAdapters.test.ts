import { describe, it, expect } from "vitest";
import { buildGiroCsv } from "../src/services/girExport.js";
import {
  genericAdapter,
  dbsIdealAdapter,
  ocbcVelocityAdapter,
  uobFixedWidthAdapter,
  getBankAdapter,
  type GiroBatch,
} from "../src/services/bankAdapters.js";

const batch: GiroBatch = {
  period: "2025-07",
  records: [
    { employeeNo: "M001", employeeName: "Aisha Rahman", bankName: "DBS", bankAccount: "1234567", amount: 4000 },
    { employeeNo: "M002", employeeName: "Priya Nair", bankName: "OCBC", bankAccount: "7654321", amount: 3200.5 },
  ],
};

describe("bank GIRO adapters", () => {
  it("generic adapter delegates to buildGiroCsv (identical output)", () => {
    expect(genericAdapter.build(batch)).toBe(buildGiroCsv(batch));
  });

  it("generic adapter golden output", () => {
    expect(genericAdapter.build(batch)).toBe(
      "H,GIRO,2025-07,2\n" +
        "D,M001,AISHA RAHMAN,DBS,1234567,4000.00\n" +
        "D,M002,PRIYA NAIR,OCBC,7654321,3200.50\n" +
        "T,2,7200.50\n"
    );
  });

  it("DBS IDEAL golden output", () => {
    expect(dbsIdealAdapter.build(batch)).toBe(
      "HDR,IBG,2025-07,DBS202507,VALUE-DATE,2\n" +
        "DTL,M001,AISHA RAHMAN,DBS,1234567,4000.00\n" +
        "DTL,M002,PRIYA NAIR,OCBC,7654321,3200.50\n" +
        "TRL,2,7200.50\n"
    );
  });

  it("OCBC Velocity golden output", () => {
    expect(ocbcVelocityAdapter.build(batch)).toBe(
      "01,VELOCITY,2025-07,2\n" +
        "02,M001,1234567,AISHA RAHMAN,DBS,4000.00\n" +
        "02,M002,7654321,PRIYA NAIR,OCBC,3200.50\n" +
        "09,2,7200.50\n"
    );
  });

  it("UOB fixed-width golden output", () => {
    // Hand-written literal fixed-width lines, spelled out character-by-character
    // from the documented column spec in bankAdapters.ts (NOT recomputed with the
    // production padRight/padZero helpers — that would make this test circular:
    // a shared off-by-one or wrong-padding-direction bug in those helpers would
    // then pass silently). Each segment below is annotated with its column range
    // and width so the literal can be checked against the spec by inspection.
    const header =
      "10" + // cols 1-2:  record type
      "UOBGIRO " + // cols 3-10:  batch label, 8 chars, already exactly 8
      "2025-07" + // cols 11-17: period, 7 chars, already exactly 7
      "000002"; // cols 18-23: record count (2), zero-padded to 6
    const d1 =
      "20" + // cols 1-2:   record type
      "M001      " + // cols 3-12:  employee no "M001" + 6 spaces = 10
      "AISHA RAHMAN                  " + // cols 13-42: name (12 chars) + 18 spaces = 30
      "DBS                 " + // cols 43-62: bank name (3 chars) + 17 spaces = 20
      "1234567          " + // cols 63-79: account (7 chars) + 10 spaces = 17
      "0000000400000"; // cols 80-92: 4000.00 -> 400000 cents, zero-padded to 13
    const d2 =
      "20" +
      "M002      " + // "M002" + 6 spaces = 10
      "PRIYA NAIR                    " + // "PRIYA NAIR" (10 chars) + 20 spaces = 30
      "OCBC                " + // "OCBC" (4 chars) + 16 spaces = 20
      "7654321          " + // "7654321" (7 chars) + 10 spaces = 17
      "0000000320050"; // 3200.50 -> 320050 cents, zero-padded to 13
    const trailer =
      "90" + // cols 1-2: record type
      "000002" + // cols 3-8:  record count (2), zero-padded to 6
      "000000000720050"; // cols 9-23: 720050 total cents, zero-padded to 15
    expect(uobFixedWidthAdapter.build(batch)).toBe([header, d1, d2, trailer].join("\n") + "\n");

    // Independent sanity check on the hand-written literals themselves (plain
    // string .length, not derived from the SUT's padding helpers).
    expect(header.length).toBe(23);
    expect(trailer.length).toBe(23);
    expect(d1.length).toBe(92);
    expect(d2.length).toBe(92);
  });

  it("registry resolves known keys and rejects unknown ones", () => {
    expect(getBankAdapter("dbs")).toBe(dbsIdealAdapter);
    expect(getBankAdapter("generic")).toBe(genericAdapter);
    expect(getBankAdapter("ocbc")).toBe(ocbcVelocityAdapter);
    expect(getBankAdapter("uob")).toBe(uobFixedWidthAdapter);
    let err: any;
    try {
      getBankAdapter("nope");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Unknown bank format: nope");
    expect(err.status).toBe(400);
  });

  it("neutralises spreadsheet formula-injection in comma-delimited adapters", () => {
    const evil: GiroBatch = {
      period: "2025-07",
      records: [
        { employeeNo: "M009", employeeName: "=SUM(A1:A9)", bankName: "DBS", bankAccount: "999", amount: 10 },
      ],
    };
    // A leading "=" is quoted (prefixed with a single quote) so a spreadsheet
    // will not evaluate the cell as a formula.
    expect(genericAdapter.build(evil)).toContain(",'=SUM(A1:A9),");
    expect(dbsIdealAdapter.build(evil)).toContain(",'=SUM(A1:A9),");
    expect(ocbcVelocityAdapter.build(evil)).toContain(",'=SUM(A1:A9),");
  });

  it("sanitizes a comma inside employeeNo so it cannot desync the column count", () => {
    // employeeNo is HR/admin-settable with only a non-empty check (no charset
    // validation), so a literal comma in it must not inject an extra column
    // into a file that is submitted as a real GIRO bank-payment batch.
    const evil: GiroBatch = {
      period: "2025-07",
      records: [
        { employeeNo: "E001,999999.00", employeeName: "Tan Wei Ming", bankName: "DBS", bankAccount: "1234567890", amount: 1000 },
      ],
    };
    for (const adapter of [genericAdapter, dbsIdealAdapter, ocbcVelocityAdapter]) {
      const detailLine = adapter.build(evil).split("\n")[1];
      expect(detailLine.split(",")).toHaveLength(6);
      expect(detailLine).not.toContain("E001,999999.00");
    }
  });
});
