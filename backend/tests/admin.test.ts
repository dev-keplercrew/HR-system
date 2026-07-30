// HTTP-level tests for the admin-editable statutory config surface (item
// constraint: every rate/ceiling/levy-band/bank-format/CSN is admin-editable, not
// hardcoded). Proves the role gate fires on a REAL request and that config is a
// data change. Via the real Express app + seeded DB (httpTestHarness).
import { describe, it, expect } from "vitest";
import { client, authHeader } from "./helpers/httpTestHarness.js";
import { prisma } from "../src/prisma.js";

const CONFIG_ENDPOINTS = [
  "/api/admin/statutory-config",
  "/api/admin/self-help-fund-rates",
  "/api/admin/fwl-rates",
  "/api/admin/bank-formats",
  "/api/admin/cpf-rate-bands",
  "/api/admin/allowance-components",
];

describe("admin statutory config (item constraint: config-driven rates)", () => {
  it("returns the statutory config singleton to an admin", async () => {
    const res = await client().get("/api/admin/statutory-config").set(authHeader("admin"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("cpfOwCeiling");
    expect(res.body).toHaveProperty("employerCsn");
    expect(res.body).toHaveProperty("defaultBankFormat");
  });

  it("lets an admin PATCH a statutory ceiling (2026 rate revision = data change)", async () => {
    const res = await client().patch("/api/admin/statutory-config").set(authHeader("admin")).send({ cpfOwCeiling: 8000 });
    expect(res.status).toBe(200);
    expect(res.body.cpfOwCeiling).toBe(8000);
    // Restore so other tests keep the seeded 7400 ceiling.
    const restore = await client().patch("/api/admin/statutory-config").set(authHeader("admin")).send({ cpfOwCeiling: 7400 });
    expect(restore.body.cpfOwCeiling).toBe(7400);
  });

  it("lists self-help fund rates, FWL rates and bank formats for an admin", async () => {
    for (const ep of CONFIG_ENDPOINTS.slice(1)) {
      const res = await client().get(ep).set(authHeader("admin"));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    }
  });

  it("validates input — an unknown ethnicGroup is rejected 400", async () => {
    const res = await client().post("/api/admin/self-help-fund-rates").set(authHeader("admin")).send({ ethnicGroup: "XYZ", amount: 5 });
    expect(res.status).toBe(400);
  });

  it("is ADMIN-only — hr, manager and employee all get 403 on every config endpoint", async () => {
    for (const ep of CONFIG_ENDPOINTS) {
      for (const role of ["hr", "manager", "employee"] as const) {
        const res = await client().get(ep).set(authHeader(role, 2));
        expect(res.status, `${role} GET ${ep}`).toBe(403);
      }
      // Writes are equally gated.
      const patch = await client().patch("/api/admin/statutory-config").set(authHeader("hr", 2)).send({ cpfOwCeiling: 1 });
      expect(patch.status).toBe(403);
    }
  });
});

describe("CPF rate bands are admin-editable end-to-end (2026 revision = data change)", () => {
  it("PATCHing the <=55 band's employee rate changes a NEW payroll run's computed CPF, then restores", async () => {
    const listBefore = await client().get("/api/admin/cpf-rate-bands").set(authHeader("admin"));
    expect(listBefore.status).toBe(200);
    const band = listBefore.body.find((b: any) => b.label === "<=55");
    expect(band).toBeTruthy();
    expect(band.employeeRate).toBe(0.2);

    const patched = await client().patch(`/api/admin/cpf-rate-bands/${band.id}`).set(authHeader("admin")).send({ employeeRate: 0.21 });
    expect(patched.status).toBe(200);
    expect(patched.body.employeeRate).toBe(0.21);

    try {
      // M011: citizen, general payrollGroup, DOB 1995 (age <=55 as of 2030), basic
      // 4600 → OW 5060 (well under the ceiling). A near-future period (not decades
      // out) keeps the employee inside the <=55 band being tested.
      const m011 = await prisma.employee.findUnique({ where: { employeeNo: "M011" } });
      const run = await client().post("/api/payroll/runs").set(authHeader("hr")).send({ period: "2030-01", payrollGroup: "general" });
      expect(run.status).toBe(201);
      const payslip = run.body.payslips.find((p: any) => p.employeeId === m011!.id);
      expect(payslip.cpfAgeBandLabel).toBe("<=55");
      expect(payslip.employeeCpf).toBe(Math.round(payslip.ordinaryWage * 0.21)); // the PATCHed rate, not the 0.2 default
    } finally {
      // Restore the seeded default so every other test keeps seeing 20%/17%.
      await client().patch(`/api/admin/cpf-rate-bands/${band.id}`).set(authHeader("admin")).send({ employeeRate: 0.2 });
      await prisma.payrollRun.deleteMany({ where: { period: "2030-01" } });
      await prisma.ytdCpfWage.deleteMany({ where: { year: 2030 } });
    }
  });
});

describe("allowance components are admin-editable and genuinely itemised (item 3)", () => {
  it("POSTing a new allowance component appears as a named line on a NEW payroll run's payslip, then is removed", async () => {
    const before = await client().get("/api/admin/allowance-components").set(authHeader("admin"));
    expect(before.status).toBe(200);
    expect(Array.isArray(before.body)).toBe(true);
    // Seeded default is Transport (6%) + Meal (4%) — replace with a single,
    // easy-to-assert-on component for this test.
    const created = await client()
      .post("/api/admin/allowance-components")
      .set(authHeader("admin"))
      .send({ label: "Housing", percentageOfBasic: 0.2, sortOrder: 0 });
    expect(created.status).toBe(201);
    try {
      const run = await client().post("/api/payroll/runs").set(authHeader("hr")).send({ period: "2030-02", payrollGroup: "general" });
      expect(run.status).toBe(201);
      const m011 = await prisma.employee.findUnique({ where: { employeeNo: "M011" } });
      const payslip = run.body.payslips.find((p: any) => p.employeeId === m011!.id);
      const breakdown = JSON.parse(payslip.allowanceBreakdown);
      expect(Array.isArray(breakdown)).toBe(true);
      // Housing (20%) + the two seeded defaults (Transport 6% + Meal 4%) — all
      // three now show as separate named lines, not one synthetic figure.
      expect(breakdown.some((l: any) => l.label === "Housing")).toBe(true);
      expect(breakdown.some((l: any) => l.label === "Transport")).toBe(true);
      expect(payslip.allowances).toBe(breakdown.reduce((s: number, l: any) => s + l.amount, 0));
    } finally {
      // No DELETE route for allowance components (matches every other config
      // table in this file); clean up directly via Prisma.
      await prisma.allowanceComponent.delete({ where: { id: created.body.id } });
      await prisma.payrollRun.deleteMany({ where: { period: "2030-02" } });
      await prisma.ytdCpfWage.deleteMany({ where: { year: 2030 } });
    }
  });
});

describe("overtime cap/multiplier are admin-configurable, not hardcoded (item 7)", () => {
  it("PATCHing otMultiplier changes a NEW payroll run's computed OT pay, then restores", async () => {
    const m011 = await prisma.employee.findUnique({ where: { employeeNo: "M011" } });
    const patched = await client().patch("/api/admin/statutory-config").set(authHeader("admin")).send({ otMultiplier: 2, otCapHoursPerMonth: 60 });
    expect(patched.status).toBe(200);
    expect(patched.body.otMultiplier).toBe(2);
    try {
      const run = await client()
        .post("/api/payroll/runs")
        .set(authHeader("hr"))
        .send({ period: "2030-03", payrollGroup: "general", inputs: { M011: { otHours: 10 } } });
      expect(run.status).toBe(201);
      const payslip = run.body.payslips.find((p: any) => p.employeeId === m011!.id);
      const hourlyRate = m011!.basicSalary / 176; // WORKING_HOURS_PER_MONTH
      expect(payslip.otPay).toBe(Math.round(hourlyRate * 2 * 10)); // the PATCHed 2x multiplier, not the 1.5x default
    } finally {
      await client().patch("/api/admin/statutory-config").set(authHeader("admin")).send({ otMultiplier: 1.5, otCapHoursPerMonth: 72 });
      await prisma.payrollRun.deleteMany({ where: { period: "2030-03" } });
      await prisma.ytdCpfWage.deleteMany({ where: { year: 2030 } });
    }
  });
});

describe("working-days/working-hours per month are admin-configurable, not hardcoded", () => {
  it("PATCHing workingDaysPerMonth changes a NEW run's mid-month proration, then restores", async () => {
    const m011 = await prisma.employee.findUnique({ where: { employeeNo: "M011" } });
    const patched = await client().patch("/api/admin/statutory-config").set(authHeader("admin")).send({ workingDaysPerMonth: 20 });
    expect(patched.status).toBe(200);
    expect(patched.body.workingDaysPerMonth).toBe(20);
    try {
      // No workingDaysInPeriod override supplied — the route must fall back to
      // the PATCHed config value (20), not the old hardcoded 22.
      const run = await client()
        .post("/api/payroll/runs")
        .set(authHeader("hr"))
        .send({ period: "2030-04", payrollGroup: "general", inputs: { M011: { workingDaysWorked: 18 } } });
      expect(run.status).toBe(201);
      const payslip = run.body.payslips.find((p: any) => p.employeeId === m011!.id);
      expect(payslip.basicPay).toBe(Math.round((m011!.basicSalary * 18) / 20)); // prorated against the PATCHed 20, not 22
    } finally {
      await client().patch("/api/admin/statutory-config").set(authHeader("admin")).send({ workingDaysPerMonth: 22 });
      await prisma.payrollRun.deleteMany({ where: { period: "2030-04" } });
      await prisma.ytdCpfWage.deleteMany({ where: { year: 2030 } });
    }
  });

  it("PATCHing workingHoursPerMonth changes a NEW run's OT hourly-rate base, then restores", async () => {
    const m011 = await prisma.employee.findUnique({ where: { employeeNo: "M011" } });
    const patched = await client().patch("/api/admin/statutory-config").set(authHeader("admin")).send({ workingHoursPerMonth: 160 });
    expect(patched.status).toBe(200);
    expect(patched.body.workingHoursPerMonth).toBe(160);
    try {
      const run = await client()
        .post("/api/payroll/runs")
        .set(authHeader("hr"))
        .send({ period: "2030-05", payrollGroup: "general", inputs: { M011: { otHours: 10 } } });
      expect(run.status).toBe(201);
      const payslip = run.body.payslips.find((p: any) => p.employeeId === m011!.id);
      const hourlyRate = m011!.basicSalary / 160; // the PATCHed 160, not the old hardcoded 176
      expect(payslip.otPay).toBe(Math.round(hourlyRate * 1.5 * 10));
    } finally {
      await client().patch("/api/admin/statutory-config").set(authHeader("admin")).send({ workingHoursPerMonth: 176 });
      await prisma.payrollRun.deleteMany({ where: { period: "2030-05" } });
      await prisma.ytdCpfWage.deleteMany({ where: { year: 2030 } });
    }
  });

  it("prices OT from the FULL basic salary, not the mid-month-prorated figure, when both apply in the same period", async () => {
    const m011 = await prisma.employee.findUnique({ where: { employeeNo: "M011" } });
    try {
      // Half the period worked (11 of 22 days) AND 10 OT hours in the same run —
      // the OT hourly rate must still be priced off the full monthly basic, not
      // the halved proratedBasic (otherwise a mid-month joiner/leaver with OT is
      // underpaid overtime).
      const run = await client()
        .post("/api/payroll/runs")
        .set(authHeader("hr"))
        .send({ period: "2030-06", payrollGroup: "general", inputs: { M011: { workingDaysWorked: 11, otHours: 10 } } });
      expect(run.status).toBe(201);
      const payslip = run.body.payslips.find((p: any) => p.employeeId === m011!.id);
      const correctHourlyRate = m011!.basicSalary / 176; // full basic, NOT proratedBasic (half of it)
      expect(payslip.otPay).toBe(Math.round(correctHourlyRate * 1.5 * 10));
      expect(payslip.basicPay).toBe(Math.round((m011!.basicSalary * 11) / 22)); // proration still applies to basic pay itself
    } finally {
      await prisma.payrollRun.deleteMany({ where: { period: "2030-06" } });
      await prisma.ytdCpfWage.deleteMany({ where: { year: 2030 } });
    }
  });
});
