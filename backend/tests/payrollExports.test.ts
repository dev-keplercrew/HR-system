// HTTP-level tests for the statutory exports (CPF EZPay, IRAS IR8A, GIRO), the
// payslip PDF (with a real cross-employee IDOR check), and bank reconciliation —
// plus the dedicated authorization-hardening matrix (step 13): every HR-global
// endpoint 403s for employee AND manager, and the payslip PDF stays scope=mine.
// All via the real Express app + seeded Prisma DB (httpTestHarness).
import { describe, it, expect, beforeAll } from "vitest";
import { client, authHeader } from "./helpers/httpTestHarness.js";
import { prisma } from "../src/prisma.js";

// IR8A now buckets by the run's `period` (e.g. "2097-06"), not its processing
// runDate (see payroll.ts's IR8A route) — so the query year below must match
// the YEAR embedded in the fixed future periods this file creates runs under
// (2097-06/2097-07), not the real current year.
const IR8A_YEAR = 2097;
let execRunId: number;
let mgmtRunId: number; // an approved management run — all citizens, passes CPF validation
let m004Id: number, m005Id: number;
let m004PayslipId: number, m005PayslipId: number;

async function cleanup() {
  await prisma.payrollRun.deleteMany({ where: { period: { in: ["2097-06", "2097-07", "2097-08", "2096-05", "2096-06"] } } });
  await prisma.ytdCpfWage.deleteMany({ where: { year: { in: [2097, 2096] } } });
  await prisma.claim.deleteMany({ where: { claimDate: { gte: new Date("2097-01-01"), lt: new Date("2098-01-01") } } });
}

beforeAll(async () => {
  await cleanup();
  const execRun = await prisma.payrollRun.findFirst({
    where: { payrollGroup: "executive" },
    orderBy: { id: "desc" },
    include: { payslips: { include: { employee: true } } },
  });
  execRunId = execRun!.id;
  const m004 = await prisma.employee.findUnique({ where: { employeeNo: "M004" } });
  const m005 = await prisma.employee.findUnique({ where: { employeeNo: "M005" } });
  m004Id = m004!.id;
  m005Id = m005!.id;
  m004PayslipId = execRun!.payslips.find((p) => p.employeeId === m004Id)!.id;
  m005PayslipId = execRun!.payslips.find((p) => p.employeeId === m005Id)!.id;

  // Create + approve a management run (M001/M003/M009 — all citizens with NRIC).
  const created = await client().post("/api/payroll/runs").set(authHeader("hr")).send({ period: "2097-06", payrollGroup: "management" });
  mgmtRunId = created.body.id;
  await client().post(`/api/payroll/runs/${mgmtRunId}/review`).set(authHeader("hr"));
  await client().post(`/api/payroll/runs/${mgmtRunId}/approve`).set(authHeader("hr"));
});

describe("CPF e-Submission (item 5)", () => {
  it("generates the EZPay file for a valid approved run, carrying the admin CSN", async () => {
    const res = await client().get(`/api/payroll/runs/${mgmtRunId}/cpf-submission`).set(authHeader("hr"));
    expect(res.status).toBe(200);
    expect(res.text).toContain("CPF-EZPAY");
    expect(res.text).toContain("123456789A-PTE-01"); // the seeded employer CSN (config-driven)
  });

  it("BLOCKS generation (400) and lists offending employees when NRIC/data is missing", async () => {
    // The seeded executive run includes EP/PR employees with a null NRIC.
    const res = await client().get(`/api/payroll/runs/${execRunId}/cpf-submission`).set(authHeader("hr"));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("missing required fields");
    expect(res.body.error).toContain("M006"); // an EP employee with null NRIC
  });

  it("is HR-only — employee and manager get 403", async () => {
    for (const role of ["employee", "manager"] as const) {
      const res = await client().get(`/api/payroll/runs/${mgmtRunId}/cpf-submission`).set(authHeader(role, 4));
      expect(res.status).toBe(403);
    }
  });
});

describe("IRAS IR8A (item 4)", () => {
  it("returns the IR8A CSV for a year (HR)", async () => {
    const res = await client().get(`/api/payroll/iras/ir8a?year=${IR8A_YEAR}`).set(authHeader("hr"));
    expect(res.status).toBe(200);
    expect(res.text).toContain("EmployeeNo,Name,NRIC,Year");
  });
  it("supports text and xml formats", async () => {
    const xml = await client().get(`/api/payroll/iras/ir8a?year=${IR8A_YEAR}&format=xml`).set(authHeader("hr"));
    expect(xml.status).toBe(200);
    expect(xml.text).toContain("<IR8AReturn");
  });
  it("is HR-only — employee and manager get 403", async () => {
    for (const role of ["employee", "manager"] as const) {
      const res = await client().get(`/api/payroll/iras/ir8a?year=${IR8A_YEAR}`).set(authHeader(role, 4));
      expect(res.status).toBe(403);
    }
  });
  it("excludes an unapproved (draft) run's employees, then includes them once approved (item 7 gate)", async () => {
    const m011 = await prisma.employee.findUnique({ where: { employeeNo: "M011" } });
    const created = await client().post("/api/payroll/runs").set(authHeader("hr")).send({ period: "2097-07", payrollGroup: "general" });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("draft");
    const runId = created.body.id;

    const draft = await client().get(`/api/payroll/iras/ir8a?year=${IR8A_YEAR}`).set(authHeader("hr"));
    expect(draft.status).toBe(200);
    expect(draft.text).not.toContain(m011!.employeeNo);

    await client().post(`/api/payroll/runs/${runId}/review`).set(authHeader("hr"));
    await client().post(`/api/payroll/runs/${runId}/approve`).set(authHeader("hr"));

    const approved = await client().get(`/api/payroll/iras/ir8a?year=${IR8A_YEAR}`).set(authHeader("hr"));
    expect(approved.status).toBe(200);
    expect(approved.text).toContain(m011!.employeeNo);
  });
});

describe("IR8A optional attachments — Appendix 8A / IR8S (item 4)", () => {
  it("Appendix 8A: reachable via the API and lists the employee's PAID claims for the year as benefit lines", async () => {
    const m009 = await prisma.employee.findUnique({ where: { employeeNo: "M009" } });
    const claimType = await prisma.claimType.findFirst();
    const claim = await prisma.claim.create({
      data: {
        employeeId: m009!.id,
        claimTypeId: claimType!.id,
        amount: 250,
        status: "paid",
        claimDate: new Date("2097-06-15T00:00:00Z"),
      },
    });
    try {
      const res = await client().get(`/api/payroll/iras/ir8a/attachments?year=${IR8A_YEAR}`).set(authHeader("hr"));
      expect(res.status).toBe(200);
      const entry = res.body.attachments.find((a: any) => a.employeeNo === "M009");
      expect(entry).toBeTruthy();
      expect(entry.appendix8a).toBeTruthy();
      expect(entry.appendix8a.total).toBe(250);
      expect(entry.appendix8a.benefits.some((b: any) => b.amount === 250)).toBe(true);
    } finally {
      await prisma.claim.delete({ where: { id: claim.id } });
    }
  });

  it("IR8S: reachable via the API and reports CPF paid on a since-voided run as excess CPF to refund", async () => {
    const m011 = await prisma.employee.findUnique({ where: { employeeNo: "M011" } });
    const created = await client().post("/api/payroll/runs").set(authHeader("hr")).send({ period: "2097-08", payrollGroup: "general" });
    expect(created.status).toBe(201);
    const runId = created.body.id;
    const m011Payslip = created.body.payslips.find((p: any) => p.employeeId === m011!.id);
    expect(m011Payslip.employeeCpf + m011Payslip.employerCpf).toBeGreaterThan(0);

    await client().post(`/api/payroll/runs/${runId}/review`).set(authHeader("hr"));
    await client().post(`/api/payroll/runs/${runId}/approve`).set(authHeader("hr"));
    const rb = await client().post(`/api/payroll/runs/${runId}/rollback`).set(authHeader("hr")).send({ reason: "test voiding for IR8S" });
    expect(rb.status).toBe(200);

    const res = await client().get(`/api/payroll/iras/ir8a/attachments?year=${IR8A_YEAR}`).set(authHeader("hr"));
    expect(res.status).toBe(200);
    const entry = res.body.attachments.find((a: any) => a.employeeNo === "M011");
    expect(entry).toBeTruthy();
    expect(entry.ir8s).toBeTruthy();
    expect(entry.ir8s.excessCpf).toBe(m011Payslip.employeeCpf + m011Payslip.employerCpf);
  });

  it("is HR-only — employee and manager get 403", async () => {
    for (const role of ["employee", "manager"] as const) {
      const res = await client().get(`/api/payroll/iras/ir8a/attachments?year=${IR8A_YEAR}`).set(authHeader(role, 4));
      expect(res.status).toBe(403);
    }
  });
});

describe("Payslip PDF — scope=mine ownership (item 3, IDOR guard)", () => {
  it("lets HR download any employee's payslip PDF", async () => {
    const res = await client().get(`/api/payroll/payslips/${m004PayslipId}/pdf`).set(authHeader("hr"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
  });
  it("lets an employee download THEIR OWN payslip PDF", async () => {
    const res = await client().get(`/api/payroll/payslips/${m004PayslipId}/pdf`).set(authHeader("employee", m004Id));
    expect(res.status).toBe(200);
  });
  it("BLOCKS employee A from downloading employee B's payslip PDF → 403 (real IDOR exploitation)", async () => {
    const res = await client().get(`/api/payroll/payslips/${m005PayslipId}/pdf`).set(authHeader("employee", m004Id));
    expect(res.status).toBe(403);
  });
  it("rejects an unauthenticated PDF request → 401", async () => {
    const res = await client().get(`/api/payroll/payslips/${m004PayslipId}/pdf`);
    expect(res.status).toBe(401);
  });
});

describe("Bulk payslip ZIP (item 3)", () => {
  it("lets HR download the run's payslips as a ZIP (PK magic)", async () => {
    const res = await client().get(`/api/payroll/runs/${execRunId}/payslips.zip`).set(authHeader("hr")).buffer(true).parse((response, cb) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/zip");
    const buf = res.body as Buffer;
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });
  it("is HR-only — employee and manager get 403", async () => {
    for (const role of ["employee", "manager"] as const) {
      const res = await client().get(`/api/payroll/runs/${execRunId}/payslips.zip`).set(authHeader(role, 4));
      expect(res.status).toBe(403);
    }
  });
  it("rejects an unauthenticated request → 401", async () => {
    const res = await client().get(`/api/payroll/runs/${execRunId}/payslips.zip`);
    expect(res.status).toBe(401);
  });
  it("BLOCKS (400) download for a draft (not yet approved) run", async () => {
    const draft = await client().post("/api/payroll/runs").set(authHeader("hr")).send({ period: "2096-05", payrollGroup: "hourly" });
    const res = await client().get(`/api/payroll/runs/${draft.body.id}/payslips.zip`).set(authHeader("hr"));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("must be approved");
  });
});

describe("Bank statement reconciliation (item 6)", () => {
  it("reconciles an uploaded CSV against the run's payslips (HR)", async () => {
    const payslips = await prisma.payslip.findMany({ where: { payrollRunId: execRunId }, include: { employee: true } });
    const p = payslips[0];
    const csv = `reference,name,amount\n${p.employee.employeeNo},${p.employee.firstName} ${p.employee.lastName},${p.netPay.toFixed(2)}\nX999,Unknown,1234.00`;
    const res = await client().post(`/api/payroll/runs/${execRunId}/reconciliation`).set(authHeader("hr")).send({ csv, filename: "stmt.csv" });
    expect(res.status).toBe(201);
    expect(res.body.summary.matched).toBe(1);
    expect(res.body.summary.unmatched).toBe(1);
  });
  it("upload and read are HR-only — employee and manager get 403", async () => {
    for (const role of ["employee", "manager"] as const) {
      const up = await client().post(`/api/payroll/runs/${execRunId}/reconciliation`).set(authHeader(role, 4)).send({ csv: "a,b,1" });
      expect(up.status).toBe(403);
      const read = await client().get(`/api/payroll/runs/${execRunId}/reconciliation`).set(authHeader(role, 4));
      expect(read.status).toBe(403);
    }
  });
  it("BLOCKS (400) reconciliation upload for a draft (not yet approved) run", async () => {
    const draft = await client().post("/api/payroll/runs").set(authHeader("hr")).send({ period: "2096-06", payrollGroup: "hourly" });
    const res = await client()
      .post(`/api/payroll/runs/${draft.body.id}/reconciliation`)
      .set(authHeader("hr"))
      .send({ csv: "reference,amount\nM001,4000" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("must be approved");
  });
});

describe("GIRO export authorization (item 6)", () => {
  it("is HR-only — employee and manager get 403", async () => {
    for (const role of ["employee", "manager"] as const) {
      const res = await client().get(`/api/payroll/runs/${execRunId}/giro`).set(authHeader(role, 4));
      expect(res.status).toBe(403);
    }
  });
});
