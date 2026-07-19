// Payroll route module — CPF / IRAS / GIRO vertical slice.
//
// ⚠️ DEMO SIMULATION: all statutory figures (CPF, IRAS, GIRO) are produced by a
// functional simulation for demonstration only — NOT a certified statutory
// payroll integration. See services/payrollCalc.ts and services/girExport.ts.
import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../prisma.js";
import { authenticate, type AuthRequest } from "../middleware/auth.js";
import { requireHR } from "../middleware/rbac.js";
import { ah, intParam } from "../http.js";
import { audit } from "../services/audit.js";
import { buildPayslip } from "../services/payrollCalc.js";
import { buildGiroCsv } from "../services/girExport.js";

const router = Router();
router.use(authenticate);

// Employees eligible to be paid: active or on probation (not resigned/terminated).
const PAYABLE_STATUSES = ["active", "probation"];

// GET /runs — all payroll runs, newest first.
router.get(
  "/runs",
  requireHR,
  ah(async (_req, res) => {
    const runs = await prisma.payrollRun.findMany({ orderBy: { runDate: "desc" } });
    res.json(runs);
  })
);

// POST /runs — run payroll for a group/period. Computes each employee's payslip
// via the frozen buildPayslip() simulation and persists a finalised run.
router.post(
  "/runs",
  requireHR,
  ah(async (req: AuthRequest, res: Response) => {
    const period = String(req.body?.period ?? "").trim();
    const payrollGroup = String(req.body?.payrollGroup ?? "").trim();
    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw Object.assign(new Error("period must be in YYYY-MM format"), { status: 400 });
    }
    if (!["general", "executive", "management", "hourly"].includes(payrollGroup)) {
      throw Object.assign(new Error("Invalid payrollGroup"), { status: 400 });
    }

    const employees = await prisma.employee.findMany({
      where: { payrollGroup, status: { in: PAYABLE_STATUSES } },
      orderBy: { employeeNo: "asc" },
    });
    if (employees.length === 0) {
      throw Object.assign(new Error("No payable employees in this payroll group"), { status: 400 });
    }

    // Employees missing a dateOfBirth can't have a CPF age band computed and
    // are flagged for manual review instead of silently defaulting; the run
    // is blocked until HR backfills their record.
    const missingDob = employees.filter((emp) => !emp.dateOfBirth);
    if (missingDob.length > 0) {
      throw Object.assign(
        new Error(
          `Payroll run blocked: ${missingDob.length} employee(s) missing dateOfBirth ` +
            `(cannot determine CPF age band): ${missingDob.map((e) => e.employeeNo).join(", ")}. ` +
            `Backfill their record before running payroll for this group.`
        ),
        { status: 400 }
      );
    }

    const asOf = new Date(`${period}-01T00:00:00Z`);
    const payslipData = employees.map((emp) => {
      const allowances = Math.round(emp.basicSalary * 0.1);
      const fig = buildPayslip({
        basicSalary: emp.basicSalary,
        allowances,
        dateOfBirth: emp.dateOfBirth,
        workPassType: emp.workPassType as
          | "citizen"
          | "pr"
          | "ep"
          | "sp"
          | "wp"
          | null,
        asOf,
      });
      return {
        employeeId: emp.id,
        basicPay: fig.basicPay,
        allowances: fig.allowances,
        grossPay: fig.grossPay,
        employeeCpf: fig.employeeCpf,
        employerCpf: fig.employerCpf,
        netPay: fig.netPay,
        totalCpf: fig.totalCpf,
      };
    });

    const totalGross = payslipData.reduce((s, p) => s + p.grossPay, 0);
    const totalNet = payslipData.reduce((s, p) => s + p.netPay, 0);
    const totalCpf = payslipData.reduce((s, p) => s + p.totalCpf, 0);

    const run = await prisma.payrollRun.create({
      data: {
        period,
        payrollGroup,
        status: "finalised",
        runDate: new Date(),
        totalGross,
        totalNet,
        totalCpf,
        payslips: {
          create: payslipData.map((p) => ({
            employeeId: p.employeeId,
            basicPay: p.basicPay,
            allowances: p.allowances,
            grossPay: p.grossPay,
            employeeCpf: p.employeeCpf,
            employerCpf: p.employerCpf,
            netPay: p.netPay,
          })),
        },
      },
      include: { payslips: { include: { employee: true } } },
    });

    await audit(
      req.auth,
      "payroll.run",
      "PayrollRun",
      run.id,
      `Finalised ${payrollGroup} payroll for ${period}: ${employees.length} employees, net ${totalNet}`
    );

    res.status(201).json(run);
  })
);

// GET /runs/:id — one run with its payslips + employees.
router.get(
  "/runs/:id",
  requireHR,
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const run = await prisma.payrollRun.findUnique({
      where: { id },
      include: { payslips: { include: { employee: true } } },
    });
    if (!run) throw Object.assign(new Error("Not found"), { status: 404 });
    res.json(run);
  })
);

// GET /runs/:id/giro — GIRO bank-file CSV for a run (net pay per employee).
router.get(
  "/runs/:id/giro",
  requireHR,
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const run = await prisma.payrollRun.findUnique({
      where: { id },
      include: { payslips: { include: { employee: true } } },
    });
    if (!run) throw Object.assign(new Error("Not found"), { status: 404 });

    const csv = buildGiroCsv({
      period: run.period,
      records: run.payslips.map((p) => ({
        employeeNo: p.employee.employeeNo,
        employeeName: `${p.employee.firstName} ${p.employee.lastName}`,
        bankName: p.employee.bankName ?? "",
        bankAccount: p.employee.bankAccount ?? "",
        amount: p.netPay,
      })),
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=giro-${run.period}.csv`);
    res.send(csv);
  })
);

// GET /payslips — scope=mine (own, any role) | scope=all / employeeId (HR only).
router.get(
  "/payslips",
  ah(async (req: AuthRequest, res: Response) => {
    const scope = String(req.query.scope ?? "mine");
    const employeeIdQuery = req.query.employeeId;
    const isHR = req.auth?.role === "admin" || req.auth?.role === "hr";

    let where: { employeeId?: number } = {};

    if (scope === "all" || employeeIdQuery != null) {
      if (!isHR) throw Object.assign(new Error("Insufficient permissions"), { status: 403 });
      if (employeeIdQuery != null) {
        where = { employeeId: intParam(String(employeeIdQuery), "employeeId") };
      }
    } else {
      // scope=mine (default): the caller's own payslips.
      if (req.auth?.employeeId == null) {
        return res.json([]);
      }
      where = { employeeId: req.auth.employeeId };
    }

    const payslips = await prisma.payslip.findMany({
      where,
      include: { payrollRun: true, employee: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(payslips);
  })
);

// GET /cpf-summary — aggregate CPF totals across all payslips.
router.get(
  "/cpf-summary",
  requireHR,
  ah(async (_req, res) => {
    const agg = await prisma.payslip.aggregate({
      _sum: { employeeCpf: true, employerCpf: true },
    });
    const totalEmployeeCpf = agg._sum.employeeCpf ?? 0;
    const totalEmployerCpf = agg._sum.employerCpf ?? 0;

    const latestRun = await prisma.payrollRun.findFirst({
      orderBy: { runDate: "desc" },
      select: { period: true },
    });

    res.json({
      totalEmployeeCpf,
      totalEmployerCpf,
      totalCpf: totalEmployeeCpf + totalEmployerCpf,
      latestPeriod: latestRun?.period ?? null,
    });
  })
);

export default router;
