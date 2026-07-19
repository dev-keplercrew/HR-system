import { describe, it, expect } from "vitest";
import { buildGiroCsv } from "../src/services/girExport.js";

describe("GIRO export format", () => {
  const csv = buildGiroCsv({
    period: "2025-07",
    records: [
      { employeeNo: "M001", employeeName: "Aisha Rahman", bankName: "DBS", bankAccount: "1234567", amount: 4000 },
      { employeeNo: "M002", employeeName: "Priya Nair", bankName: "OCBC", bankAccount: "7654321", amount: 3200.5 },
    ],
  });
  const lines = csv.trim().split("\n");

  it("starts with a header carrying the record count", () => {
    expect(lines[0]).toBe("H,GIRO,2025-07,2");
  });

  it("emits one detail row per employee with amount to 2dp", () => {
    expect(lines[1]).toBe("D,M001,AISHA RAHMAN,DBS,1234567,4000.00");
    expect(lines[2]).toBe("D,M002,PRIYA NAIR,OCBC,7654321,3200.50");
  });

  it("ends with a trailer carrying the record count and control total", () => {
    expect(lines[3]).toBe("T,2,7200.50");
  });
});
