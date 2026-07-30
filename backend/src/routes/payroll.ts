// Payroll route module — CPF / IRAS / GIRO vertical slice.
//
// ⚠️ DEMO SIMULATION: all statutory figures (CPF, IRAS, GIRO, CPF EZPay, bank
// GIRO adapters) are produced by a functional simulation for demonstration only —
// NOT a certified statutory integration. See services/payrollCalc.ts,
// services/statutoryLevies.ts, services/girExport.ts, services/bankAdapters.ts,
// services/cpfSubmission.ts and services/irasExport.ts.
import { Router } from "express";
import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { authenticate, type AuthRequest } from "../middleware/auth.js";
import { requireHR } from "../middleware/rbac.js";
import { ah, intParam } from "../http.js";
import { audit } from "../services/audit.js";
import {
  buildPayslip,
  otPay,
  dailyRate,
  unpaidLeaveDeduction,
  allowanceBreakdown,
  type WorkPassType,
  type CpfRateBand,
} from "../services/payrollCalc.js";
import { buildGiroCsv } from "../services/girExport.js";
import {
  computeSdl,
  computeFwlFromBands,
  selfHelpFundFromBands,
} from "../services/statutoryLevies.js";
import { getBankAdapter } from "../services/bankAdapters.js";
import { buildPayslipPdf, buildPayslipsZip } from "../services/payslipPdf.js";
import { validateCpfSubmission, buildCpfEzPayFile } from "../services/cpfSubmission.js";
import {
  buildIr8a,
  buildAppendix8a,
  buildIr8s,
  ir8aEligible,
  renderIrasAisText,
  renderIrasAisXml,
  renderIrasCsv,
  type Ir8aRecord,
} from "../services/irasExport.js";
import { parseBankStatementCsv, matchAgainstPayslips } from "../services/reconciliation.js";

const router = Router();
router.use(authenticate);

// Employees eligible to be paid: active or on probation (not resigned/terminated).
const PAYABLE_STATUSES = ["active", "probation"];
const EMPLOYER_NAME = "Meridian HR (Pte) Ltd";

// Load the admin-editable statutory config, creating the default row on first use
// so every rate/ceiling read comes from the database (config-driven, never hardcoded).
async function getStatutoryConfig() {
  const existing = await prisma.statutoryConfig.findFirst();
  if (existing) return existing;
  return prisma.statutoryConfig.create({ data: {} });
}

// Load the admin-editable CPF age-band rate table. Returns undefined when no rows
// are configured yet so buildPayslip() falls back to its published-2025 defaults
// (never throws on an empty table).
async function getCpfRateBands(): Promise<CpfRateBand[] | undefined> {
  const rows = await prisma.cpfRateBand.findMany({ orderBy: { sortOrder: "asc" } });
  if (rows.length === 0) return undefined;
  return rows.map((r) => ({ ageUpper: r.ageUpper, employee: r.employeeRate, employer: r.employerRate, label: r.label }));
}

// Single source of truth for "approved enough to export" — reused by both the
// single-run gate below and the multi-run IR8A query filter so there is one
// place to change the gating rule, not two.
const APPROVED_RUN_STATUSES = ["approved", "finalised"];

// Reject an export when the run has not been approved yet (lifecycle gate).
function requireApprovedRun(run: { status: string }) {
  if (!APPROVED_RUN_STATUSES.includes(run.status)) {
    throw Object.assign(
      new Error(`Run must be approved before this export is available (current status: ${run.status})`),
      { status: 400 }
    );
  }
}

// Shared scope=mine ownership check for payslip reads/downloads (item 3 ESS).
function isHRRole(req: AuthRequest): boolean {
  return req.auth?.role === "admin" || req.auth?.role === "hr";
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

// GET /runs — all payroll runs, newest first.
router.get(
  "/runs",
  requireHR,
  ah(async (_req, res) => {
    const runs = await prisma.payrollRun.findMany({ orderBy: { runDate: "desc" } });
    res.json(runs);
  })
);

// GET /bank-formats — the selectable GIRO bank adapters, for the per-run picker.
// Read-only for HR (admin owns create/edit via /api/admin/bank-formats).
router.get(
  "/bank-formats",
  requireHR,
  ah(async (_req, res) => {
    res.json(await prisma.bankFormatConfig.findMany({ orderBy: { bankKey: "asc" } }));
  })
);

interface PerEmployeeInput {
  additionalWage?: number;
  backpay?: number;
  otHours?: number;
  unpaidLeaveDays?: number;
  workingDaysInPeriod?: number;
  workingDaysWorked?: number;
}

// POST /runs — run payroll for a group/period. Creates a DRAFT run (item 7
// lifecycle: draft → reviewed → approved → finalised). Computes each employee's
// payslip with the OW/AW split, YTD-tracked AW ceiling, statutory levies, OT pay,
// unpaid-leave deduction and proration. Backward compatible: with no per-employee
// inputs the ordinary-wage figures match the previous behaviour.
// BREAKING CHANGE for any non-UI API consumer: this endpoint previously created
// the run already `finalised`; it now creates `draft` and GIRO/CPF/IRAS exports
// 400 until the run is reviewed → approved (see README "Intentional behaviour
// change" section for the full rationale).
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
    // Optional per-employee inputs keyed by employeeNo (all default to 0/none).
    const inputs: Record<string, PerEmployeeInput> = (req.body?.inputs ?? {}) as Record<string, PerEmployeeInput>;
    // Reject non-finite numeric overrides (NaN, strings, nested objects) up
    // front rather than letting them propagate as NaN into the computed
    // totals persisted below — mirrors the numFields guard in admin.ts.
    const numericInputFields = ["additionalWage", "backpay", "otHours", "unpaidLeaveDays", "workingDaysInPeriod", "workingDaysWorked"] as const;
    const badInputs: string[] = [];
    for (const [empNo, inp] of Object.entries(inputs ?? {})) {
      if (!inp || typeof inp !== "object") continue;
      for (const f of numericInputFields) {
        const v = (inp as Record<string, unknown>)[f];
        if (v !== undefined && !Number.isFinite(Number(v))) badInputs.push(`${empNo}.${f}`);
      }
    }
    if (badInputs.length > 0) {
      throw Object.assign(new Error(`inputs contain non-numeric value(s): ${badInputs.join(", ")}`), { status: 400 });
    }
    // Optional per-run bank format (validated against the configured adapters).
    const bankFormatRaw = req.body?.bankFormat ? String(req.body.bankFormat).trim() : null;

    const employees = await prisma.employee.findMany({
      where: { payrollGroup, status: { in: PAYABLE_STATUSES } },
      orderBy: { employeeNo: "asc" },
    });
    if (employees.length === 0) {
      throw Object.assign(new Error("No payable employees in this payroll group"), { status: 400 });
    }

    // Employees missing a dateOfBirth can't have a CPF age band computed and are
    // flagged for manual review instead of silently defaulting. (Distinct from the
    // CPF e-submission validation gate, which checks NRIC/nationality too.)
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

    const year = Number(period.slice(0, 4));
    const asOf = new Date(`${period}-01T00:00:00Z`);
    const cfg = await getStatutoryConfig();
    const cpfRateBands = await getCpfRateBands();
    // Validate the requested bank format against the configured adapters; fall
    // back to the admin default when not supplied.
    let bankFormat = cfg.defaultBankFormat;
    if (bankFormatRaw) {
      const known = await prisma.bankFormatConfig.findUnique({ where: { bankKey: bankFormatRaw } });
      if (!known) throw Object.assign(new Error(`Unknown bank format: ${bankFormatRaw}`), { status: 400 });
      bankFormat = bankFormatRaw;
    }
    const [shfBands, fwlBands, unpaidLeaveTypes, ytdRows, allowanceComponents] = await Promise.all([
      prisma.selfHelpFundRate.findMany(),
      prisma.fwlRateConfig.findMany(),
      prisma.leaveType.findMany({ where: { paid: false }, select: { id: true } }),
      prisma.ytdCpfWage.findMany({ where: { year, employeeId: { in: employees.map((e) => e.id) } } }),
      prisma.allowanceComponent.findMany({ orderBy: { sortOrder: "asc" } }),
    ]);
    const unpaidTypeIds = unpaidLeaveTypes.map((t) => t.id);
    const ytdByEmp = new Map(ytdRows.map((r) => [r.employeeId, r.totalOwSubjectToCpf]));

    // Source OT hours (approved overtime in the period) and unpaid-leave days
    // (approved unpaid-type leave in the period) from the existing modules.
    const empIds = employees.map((e) => e.id);
    const [otReqs, unpaidLeaves] = await Promise.all([
      prisma.overtimeRequest.findMany({ where: { employeeId: { in: empIds }, status: "approved" } }),
      unpaidTypeIds.length
        ? prisma.leaveRequest.findMany({ where: { employeeId: { in: empIds }, status: "approved", leaveTypeId: { in: unpaidTypeIds } } })
        : Promise.resolve([]),
    ]);
    const inPeriod = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` === period;
    const otByEmp = new Map<number, number>();
    for (const o of otReqs) if (inPeriod(new Date(o.date))) otByEmp.set(o.employeeId, (otByEmp.get(o.employeeId) ?? 0) + o.hours);
    const unpaidByEmp = new Map<number, number>();
    for (const l of unpaidLeaves) if (inPeriod(new Date(l.startDate))) unpaidByEmp.set(l.employeeId, (unpaidByEmp.get(l.employeeId) ?? 0) + l.days);

    // Build every payslip in memory first (pure), then persist in one transaction.
    const computed = employees.map((emp) => {
      const inp = inputs[emp.employeeNo] ?? {};
      const workPassType = emp.workPassType as WorkPassType;
      // Proration for a mid-month joiner/leaver (working-day basis) when supplied.
      const workingDaysInPeriod = inp.workingDaysInPeriod ?? cfg.workingDaysPerMonth;
      const workingDaysWorked = inp.workingDaysWorked ?? workingDaysInPeriod;
      const proratedBasic =
        workingDaysWorked < workingDaysInPeriod
          ? Math.round((emp.basicSalary * workingDaysWorked) / workingDaysInPeriod)
          : emp.basicSalary;
      const allowanceCalc = allowanceBreakdown(proratedBasic, allowanceComponents);
      const allowances = allowanceCalc.total;
      const backpay = Math.max(0, inp.backpay ?? 0);
      const additionalWage = Math.max(0, inp.additionalWage ?? 0) + backpay;

      const fig = buildPayslip({
        basicSalary: proratedBasic,
        allowances,
        additionalWage,
        ytdOwSubjectToCpf: ytdByEmp.get(emp.id) ?? 0,
        dateOfBirth: emp.dateOfBirth,
        workPassType,
        asOf,
        owCeiling: cfg.cpfOwCeiling,
        awCeilingAnnual: cfg.awCeilingAnnual,
        cpfRateBands,
      });

      // Statutory levies (config-driven). SDL & FWL are EMPLOYER-side (not deducted
      // from net); the self-help fund contribution IS an employee deduction.
      const otHours = inp.otHours ?? otByEmp.get(emp.id) ?? 0;
      // OT hourly rate is priced from the employee's full (un-prorated) monthly
      // basic salary, not proratedBasic — proration reduces OW for a mid-month
      // joiner/leaver, but the statutory hourly rate used to price overtime
      // hours is unaffected by how many days were actually worked.
      const ot = otPay(emp.basicSalary / cfg.workingHoursPerMonth, otHours, cfg.otCapHoursPerMonth, cfg.otMultiplier);
      const totalMonthlyWages = fig.grossPay + ot.pay;
      const sdlAmount = computeSdl(totalMonthlyWages, {
        rate: cfg.sdlRate,
        wageCap: cfg.sdlWageCap,
        min: cfg.sdlMinAmount,
        max: cfg.sdlMaxAmount,
      });
      const fwlAmount = computeFwlFromBands(workPassType, fwlBands);
      const shfAmount = selfHelpFundFromBands(emp.ethnicGroup, fig.grossPay, shfBands);
      const shfJson = shfAmount > 0 && emp.ethnicGroup ? JSON.stringify({ [emp.ethnicGroup]: shfAmount }) : null;

      // NOTE: `workingDaysWorked` (manual mid-month proration) and the
      // auto-derived unpaid-leave days below are assumed mutually exclusive —
      // HR should use ONE mechanism per employee per period, not both, or the
      // same absent days get deducted twice (once via a reduced proratedBasic,
      // once via unpaidLeaveDeduction). This is a data-entry/process
      // assumption, not enforced in code, because the two mechanisms model
      // genuinely different real-world cases (a starter/leaver's partial
      // period vs. a full-period employee taking unpaid leave) that HR is
      // expected to distinguish when running payroll.
      const unpaidDays = inp.unpaidLeaveDays ?? unpaidByEmp.get(emp.id) ?? 0;
      const unpaidDeduction = unpaidLeaveDeduction(dailyRate(proratedBasic, workingDaysInPeriod), unpaidDays);

      const grossPay = fig.grossPay + ot.pay;
      const netPay = fig.netPay + ot.pay - shfAmount - unpaidDeduction;
      const owSubjectToCpf = Math.min(fig.ordinaryWage, cfg.cpfOwCeiling);

      return {
        employeeId: emp.id,
        data: {
          employeeId: emp.id,
          basicPay: proratedBasic,
          allowances,
          allowanceBreakdown: JSON.stringify(allowanceCalc.lines),
          grossPay,
          employeeCpf: fig.employeeCpf,
          employerCpf: fig.employerCpf,
          netPay,
          ordinaryWage: fig.ordinaryWage,
          additionalWage: fig.additionalWage,
          owSubjectToCpf,
          owCpf: fig.owCpf,
          awCpf: fig.awCpf,
          cpfAgeBandLabel: fig.cpfAgeBandLabel,
          sdlAmount,
          fwlAmount,
          selfHelpFundDeductions: shfJson,
          otHours,
          otPay: ot.pay,
          unpaidLeaveDays: unpaidDays,
          unpaidLeaveDeduction: unpaidDeduction,
          backpayAmount: backpay,
        },
        owSubjectToCpf,
        otExceeded: ot.exceededCap,
      };
    });

    const totalGross = computed.reduce((s, p) => s + p.data.grossPay, 0);
    const totalNet = computed.reduce((s, p) => s + p.data.netPay, 0);
    const totalCpf = computed.reduce((s, p) => s + p.data.employeeCpf + p.data.employerCpf, 0);
    const otWarnings = computed.filter((c) => c.otExceeded).length;

    // Reject a duplicate run for the same period+payrollGroup (unless the prior
    // one was voided) so a double-submit can't double-accumulate YTD OW. This
    // findFirst is a fast, friendly early-exit for the common sequential case;
    // it does NOT by itself close the race between two concurrent requests (both
    // could pass it before either commits). The `dedupeKey` unique constraint on
    // PayrollRun is the actual DB-enforced guard — see the catch below.
    const dedupeKey = `${period}|${payrollGroup}`;
    const duplicate = await prisma.payrollRun.findFirst({
      where: { period, payrollGroup, status: { not: "voided" } },
    });
    if (duplicate) {
      throw Object.assign(
        new Error(`A payroll run for ${payrollGroup} ${period} already exists (status: ${duplicate.status}, id: ${duplicate.id}). Void it first if you need to rerun.`),
        { status: 400 }
      );
    }

    let run;
    try {
      run = await prisma.$transaction(async (tx) => {
        const created = await tx.payrollRun.create({
          data: {
            period,
            payrollGroup,
            status: "draft", // item 7: runs start as draft and must be reviewed/approved
            runDate: new Date(),
            totalGross,
            totalNet,
            totalCpf,
            bankFormat,
            dedupeKey,
            payslips: { create: computed.map((c) => c.data) },
          },
          include: { payslips: { include: { employee: true } } },
        });
        // Backpay adjustment lines + YTD OW accumulation (same transaction so a
        // rerun can't double-count the year-to-date figure that drives the AW ceiling).
        for (const c of computed) {
          if (c.data.backpayAmount > 0) {
            const ps = created.payslips.find((p) => p.employeeId === c.employeeId);
            if (ps) await tx.payslipAdjustment.create({ data: { payslipId: ps.id, type: "backpay", amount: c.data.backpayAmount, note: "Backpay / ad-hoc adjustment" } });
          }
          await tx.ytdCpfWage.upsert({
            where: { employeeId_year: { employeeId: c.employeeId, year } },
            create: { employeeId: c.employeeId, year, totalOwSubjectToCpf: c.owSubjectToCpf },
            update: { totalOwSubjectToCpf: { increment: c.owSubjectToCpf } },
          });
        }
        return created;
      });
    } catch (err) {
      // A concurrent request won the race and committed its dedupeKey first: the
      // DB's unique constraint rejects this insert with P2002. Translate to the
      // same friendly 400 the findFirst check gives in the sequential case.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw Object.assign(
          new Error(`A payroll run for ${payrollGroup} ${period} already exists. Void it first if you need to rerun.`),
          { status: 400 }
        );
      }
      throw err;
    }

    await audit(
      req.auth,
      "payroll.run",
      "PayrollRun",
      run.id,
      `Created DRAFT ${payrollGroup} payroll for ${period}: ${employees.length} employees, net ${totalNet}` +
        (otWarnings ? ` (${otWarnings} employee(s) exceeded the 72h OT cap)` : "")
    );

    res.status(201).json({ ...run, otCapWarnings: otWarnings });
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
      include: { payslips: { include: { employee: true, adjustments: true } } },
    });
    if (!run) throw Object.assign(new Error("Not found"), { status: 404 });
    res.json(run);
  })
);

// ---------------------------------------------------------------------------
// Run lifecycle (item 7): draft → reviewed → approved → finalised, plus rollback.
// ---------------------------------------------------------------------------

const LIFECYCLE: Record<string, { from: string; stamp: "reviewedAt" | "approvedAt" | "finalisedAt" }> = {
  review: { from: "draft", stamp: "reviewedAt" },
  approve: { from: "reviewed", stamp: "approvedAt" },
  finalise: { from: "approved", stamp: "finalisedAt" },
};

for (const action of Object.keys(LIFECYCLE)) {
  router.post(
    `/runs/:id/${action}`,
    requireHR,
    ah(async (req: AuthRequest, res) => {
      const id = intParam(req.params.id);
      const run = await prisma.payrollRun.findUnique({ where: { id } });
      if (!run) throw Object.assign(new Error("Not found"), { status: 404 });
      const step = LIFECYCLE[action];
      if (run.status !== step.from) {
        throw Object.assign(
          new Error(`Cannot ${action} a run in status '${run.status}' (expected '${step.from}')`),
          { status: 400 }
        );
      }
      const newStatus = action === "review" ? "reviewed" : action === "approve" ? "approved" : "finalised";
      const updated = await prisma.payrollRun.update({
        where: { id },
        data: { status: newStatus, [step.stamp]: new Date() },
      });
      await audit(req.auth, `payroll.run.${action}`, "PayrollRun", id, `${run.status} → ${newStatus}`);
      res.json(updated);
    })
  );
}

// POST /runs/:id/rollback — void an approved/finalised run WITHOUT deleting
// payslip history (item 7 reversal). Also reverses the YTD OW subject-to-CPF
// that this run credited, so a voided run doesn't permanently shrink the
// Additional Wage ceiling for the rest of the calendar year (the ceiling is
// AW_CEILING_ANNUAL − YTD OW, computed in payrollCalc.calcCpfOwAw).
router.post(
  "/runs/:id/rollback",
  requireHR,
  ah(async (req: AuthRequest, res) => {
    const id = intParam(req.params.id);
    const run = await prisma.payrollRun.findUnique({
      where: { id },
      include: { payslips: { select: { employeeId: true, owSubjectToCpf: true } } },
    });
    if (!run) throw Object.assign(new Error("Not found"), { status: 404 });
    if (run.status !== "approved" && run.status !== "finalised") {
      throw Object.assign(new Error(`Only approved/finalised runs can be rolled back (status: ${run.status})`), { status: 400 });
    }
    const reason = String(req.body?.reason ?? "").trim() || "No reason provided";
    const year = Number(run.period.slice(0, 4));

    const updated = await prisma.$transaction(async (tx) => {
      // Guard the status transition atomically inside the transaction, keyed
      // on the status we actually observed above: two genuinely concurrent
      // rollback requests both read status='approved'/'finalised' before
      // either commits, but only ONE updateMany can match that status —
      // once the first commits, the row's status is 'voided' and the
      // second's WHERE clause matches zero rows, so its count is 0 and it
      // must NOT proceed to reverse YTD OW a second time.
      const result = await tx.payrollRun.updateMany({
        where: { id, status: run.status },
        // Clear dedupeKey (not just status) so a new run for the same
        // period+payrollGroup can be created — the unique constraint only
        // allows one NON-NULL dedupeKey per period+group at a time.
        data: { status: "voided", voidedAt: new Date(), voidReason: reason, dedupeKey: null },
      });
      if (result.count === 0) {
        throw Object.assign(
          new Error(`Run ${id} was already rolled back or changed status concurrently`),
          { status: 409 }
        );
      }
      for (const p of run.payslips) {
        if (p.owSubjectToCpf <= 0) continue;
        const ytd = await tx.ytdCpfWage.findUnique({ where: { employeeId_year: { employeeId: p.employeeId, year } } });
        if (!ytd) continue;
        await tx.ytdCpfWage.update({
          where: { employeeId_year: { employeeId: p.employeeId, year } },
          data: { totalOwSubjectToCpf: Math.max(0, ytd.totalOwSubjectToCpf - p.owSubjectToCpf) },
        });
      }
      return tx.payrollRun.findUniqueOrThrow({ where: { id } });
    });
    await audit(
      req.auth,
      "payroll.run.rollback",
      "PayrollRun",
      id,
      `Voided (${run.status}): ${reason} — reversed YTD OW for ${run.payslips.length} employee(s)`
    );
    res.json(updated);
  })
);

// ---------------------------------------------------------------------------
// GIRO export (item 6): bank-format-aware, gated on an approved run.
// ---------------------------------------------------------------------------

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
    requireApprovedRun(run);

    const cfg = await getStatutoryConfig();
    const key = run.bankFormat ?? cfg.defaultBankFormat ?? "generic";
    const adapter = getBankAdapter(key);
    const batch = {
      period: run.period,
      records: run.payslips.map((p) => ({
        employeeNo: p.employee.employeeNo,
        employeeName: `${p.employee.firstName} ${p.employee.lastName}`,
        bankName: p.employee.bankName ?? "",
        bankAccount: p.employee.bankAccount ?? "",
        amount: p.netPay,
      })),
    };
    const csv = adapter.build(batch);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=giro-${key}-${run.period}.csv`);
    res.send(csv);
  })
);

// ---------------------------------------------------------------------------
// Payslips (item 3): list, single PDF (scope=mine for employees), bulk ZIP (HR).
// ---------------------------------------------------------------------------

// GET /payslips — scope=mine (own, any role) | scope=all / employeeId (HR only).
router.get(
  "/payslips",
  ah(async (req: AuthRequest, res: Response) => {
    const scope = String(req.query.scope ?? "mine");
    const employeeIdQuery = req.query.employeeId;

    let where: { employeeId?: number } = {};

    if (scope === "all" || employeeIdQuery != null) {
      if (!isHRRole(req)) throw Object.assign(new Error("Insufficient permissions"), { status: 403 });
      if (employeeIdQuery != null) {
        where = { employeeId: intParam(String(employeeIdQuery), "employeeId") };
      }
    } else {
      if (req.auth?.employeeId == null) {
        return res.json([]);
      }
      where = { employeeId: req.auth.employeeId };
    }

    const payslips = await prisma.payslip.findMany({
      where,
      include: { payrollRun: true, employee: true, adjustments: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(payslips);
  })
);

// GET /payslips/:id/pdf — a single payslip PDF. Reuses the scope=mine ownership
// rule verbatim: an employee may only download THEIR OWN payslip; HR/admin any.
router.get(
  "/payslips/:id/pdf",
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const payslip = await prisma.payslip.findUnique({
      where: { id },
      include: { employee: true, payrollRun: true },
    });
    if (!payslip) throw Object.assign(new Error("Not found"), { status: 404 });
    // Ownership check — NOT a role-only gate (prior-cycle authorization-drift fix).
    if (!isHRRole(req) && req.auth?.employeeId !== payslip.employeeId) {
      throw Object.assign(new Error("Insufficient permissions"), { status: 403 });
    }
    const pdf = await buildPayslipPdf({
      payslip,
      employee: payslip.employee,
      run: payslip.payrollRun,
      employerName: EMPLOYER_NAME,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=payslip-${payslip.employee.employeeNo}-${payslip.payrollRun.period}.pdf`);
    res.send(pdf);
  })
);

// GET /runs/:id/payslips.zip — every payslip PDF in a run, bundled (HR only).
// Gated on run approval, same as GIRO/CPF/IRAS: a bulk export of net-pay figures
// across every employee in the run shouldn't leave the system before the run has
// been reviewed and approved.
router.get(
  "/runs/:id/payslips.zip",
  requireHR,
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const run = await prisma.payrollRun.findUnique({
      where: { id },
      include: { payslips: { include: { employee: true } } },
    });
    if (!run) throw Object.assign(new Error("Not found"), { status: 404 });
    requireApprovedRun(run);
    const zip = await buildPayslipsZip(
      run.payslips.map((p) => ({ payslip: p, employee: p.employee, run, employerName: EMPLOYER_NAME }))
    );
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=payslips-${run.period}.zip`);
    res.send(zip);
  })
);

// ---------------------------------------------------------------------------
// CPF e-Submission (item 5): CPF EZPay file with a validation gate.
// ---------------------------------------------------------------------------

router.get(
  "/runs/:id/cpf-submission",
  requireHR,
  ah(async (req: AuthRequest, res) => {
    const id = intParam(req.params.id);
    const run = await prisma.payrollRun.findUnique({
      where: { id },
      include: { payslips: { include: { employee: true } } },
    });
    if (!run) throw Object.assign(new Error("Not found"), { status: 404 });
    requireApprovedRun(run);
    const cfg = await getStatutoryConfig();

    const lines = run.payslips.map((p) => ({
      employee: {
        employeeNo: p.employee.employeeNo,
        firstName: p.employee.firstName,
        lastName: p.employee.lastName,
        nric: p.employee.nric,
        dateOfBirth: p.employee.dateOfBirth,
        workPassType: p.employee.workPassType,
        nationality: p.employee.nationality,
      },
      ordinaryWage: p.ordinaryWage,
      additionalWage: p.additionalWage,
      employeeCpf: p.employeeCpf,
      employerCpf: p.employerCpf,
      totalCpf: p.employeeCpf + p.employerCpf,
      selfHelpFundDeductions: p.selfHelpFundDeductions,
    }));

    const validation = validateCpfSubmission(lines);
    if (!validation.valid) {
      throw Object.assign(
        new Error(
          "CPF submission blocked — employees missing required fields: " +
            validation.offending.map((o) => `${o.employeeNo} (${o.missingFields.join("/")})`).join("; ")
        ),
        { status: 400, offending: validation.offending }
      );
    }
    const file = buildCpfEzPayFile({ period: run.period, employerCsn: cfg.employerCsn, lines });
    await audit(req.auth, "payroll.cpf.submission", "PayrollRun", run.id, `Generated CPF EZPay file for ${run.period}`);
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", `attachment; filename=cpf-ezpay-${run.period}.txt`);
    res.send(file);
  })
);

// ---------------------------------------------------------------------------
// IRAS IR8A (item 4): annual return per employee for a year.
// ---------------------------------------------------------------------------

router.get(
  "/iras/ir8a",
  requireHR,
  ah(async (req: AuthRequest, res) => {
    const year = intParam(String(req.query.year ?? ""), "year");
    const format = String(req.query.format ?? "csv");

    // Bucket by the run's pay PERIOD (e.g. "2025-12"), not its processing
    // runDate — a December run finalised in January still belongs to the prior
    // tax year. Every other year-scoped calculation in this file (rollback's
    // YTD reversal, the `period.slice(0,4)` above in POST /runs) already
    // derives the year from period; this keeps IR8A consistent with that.
    const payslips = await prisma.payslip.findMany({
      where: { payrollRun: { period: { startsWith: String(year) }, status: { in: APPROVED_RUN_STATUSES } } },
      include: { employee: true },
    });
    // Group by employee.
    const byEmp = new Map<number, { emp: (typeof payslips)[number]["employee"]; slips: typeof payslips }>();
    for (const p of payslips) {
      const g = byEmp.get(p.employeeId) ?? { emp: p.employee, slips: [] };
      g.slips.push(p);
      byEmp.set(p.employeeId, g);
    }

    const records: Ir8aRecord[] = [];
    const excluded: { employeeNo: string; missing: string[] }[] = [];
    for (const { emp, slips } of byEmp.values()) {
      const irasEmp = {
        employeeNo: emp.employeeNo,
        firstName: emp.firstName,
        lastName: emp.lastName,
        nric: emp.nric,
        nationality: emp.nationality,
        dateOfBirth: emp.dateOfBirth,
        workPassType: emp.workPassType,
      };
      const eligible = ir8aEligible(irasEmp);
      if (!eligible.ok) {
        excluded.push({ employeeNo: emp.employeeNo, missing: eligible.missing });
        continue;
      }
      records.push(
        buildIr8a(
          irasEmp,
          slips.map((s) => ({ grossPay: s.grossPay, employeeCpf: s.employeeCpf, employerCpf: s.employerCpf })),
          year
        )
      );
    }

    await audit(req.auth, "payroll.iras.ir8a", "PayrollRun", null, `Generated IR8A for ${year}: ${records.length} employee(s), ${excluded.length} excluded`);

    if (format === "xml") {
      res.setHeader("Content-Type", "application/xml");
      res.setHeader("Content-Disposition", `attachment; filename=ir8a-${year}.xml`);
      return res.send(renderIrasAisXml(records));
    }
    if (format === "text" || format === "ais") {
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Content-Disposition", `attachment; filename=ir8a-${year}.txt`);
      return res.send(renderIrasAisText(records));
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=ir8a-${year}.csv`);
    res.send(renderIrasCsv(records));
  })
);

// GET /iras/ir8a/attachments — item 4's optional Appendix 8A (benefits-in-kind)
// and IR8S (excess CPF) attachments, as JSON, one per eligible employee for the
// year. DEMO SIMULATION data sources (documented, not IRAS-certified figures):
//   - Appendix 8A benefit lines = the employee's PAID claims in the calendar
//     year (Claim.status === "paid"), grouped by claim type — a representative
//     stand-in for "benefits the employer provided" since no separate
//     benefits-in-kind data model exists in this demo.
//   - IR8S excess CPF = employee/employer CPF actually paid on payslips whose
//     run was later VOIDED (rolled back) within the year — CPF that was
//     contributed and then reversed at the YTD-wage level, so it is genuinely
//     "excess" CPF the employer needs to account for/recover, not a synthetic
//     number.
router.get(
  "/iras/ir8a/attachments",
  requireHR,
  ah(async (req: AuthRequest, res) => {
    const year = intParam(String(req.query.year ?? ""), "year");
    const start = new Date(`${year}-01-01T00:00:00Z`);
    const end = new Date(`${year + 1}-01-01T00:00:00Z`);

    const payslips = await prisma.payslip.findMany({
      where: { payrollRun: { period: { startsWith: String(year) }, status: { in: APPROVED_RUN_STATUSES } } },
      include: { employee: true },
    });
    const byEmp = new Map<number, (typeof payslips)[number]["employee"]>();
    for (const p of payslips) byEmp.set(p.employeeId, p.employee);
    const employeeIds = [...byEmp.keys()];

    const [claims, voidedSlips] = await Promise.all([
      prisma.claim.findMany({
        where: { employeeId: { in: employeeIds }, status: "paid", claimDate: { gte: start, lt: end } },
        include: { claimType: true },
      }),
      prisma.payslip.findMany({
        where: { employeeId: { in: employeeIds }, payrollRun: { period: { startsWith: String(year) }, status: "voided" } },
        select: { employeeId: true, employeeCpf: true, employerCpf: true },
      }),
    ]);

    const claimsByEmp = new Map<number, typeof claims>();
    for (const c of claims) claimsByEmp.set(c.employeeId, [...(claimsByEmp.get(c.employeeId) ?? []), c]);
    const excessCpfByEmp = new Map<number, number>();
    for (const v of voidedSlips) excessCpfByEmp.set(v.employeeId, (excessCpfByEmp.get(v.employeeId) ?? 0) + v.employeeCpf + v.employerCpf);

    const attachments = [];
    for (const [employeeId, emp] of byEmp) {
      const irasEmp = {
        employeeNo: emp.employeeNo,
        firstName: emp.firstName,
        lastName: emp.lastName,
        nric: emp.nric,
        nationality: emp.nationality,
        dateOfBirth: emp.dateOfBirth,
        workPassType: emp.workPassType,
      };
      const empClaims = claimsByEmp.get(employeeId) ?? [];
      const excessCpf = excessCpfByEmp.get(employeeId) ?? 0;
      attachments.push({
        employeeNo: emp.employeeNo,
        appendix8a:
          empClaims.length > 0
            ? buildAppendix8a(
                irasEmp,
                empClaims.map((c) => ({ description: c.claimType.name, amount: c.amount }))
              )
            : null,
        ir8s: excessCpf > 0 ? buildIr8s(irasEmp, excessCpf) : null,
      });
    }

    await audit(req.auth, "payroll.iras.ir8a.attachments", "PayrollRun", null, `Generated IR8A attachments for ${year}: ${attachments.length} employee(s)`);
    res.json({ year, attachments });
  })
);

// ---------------------------------------------------------------------------
// Bank statement reconciliation (item 6): upload CSV, match, report (HR only).
// ---------------------------------------------------------------------------

// Gated on run approval: reconciliation matches the bank statement against a
// run's net pay AFTER the money has actually moved (GIRO export itself requires
// an approved run), so matching against a still-draft/unreviewed run's figures
// would be reconciling against numbers that were never sent to the bank.
router.post(
  "/runs/:id/reconciliation",
  requireHR,
  ah(async (req: AuthRequest, res) => {
    const id = intParam(req.params.id);
    const csv = String(req.body?.csv ?? "");
    if (!csv.trim()) throw Object.assign(new Error("csv body field is required"), { status: 400 });
    const filename = req.body?.filename ? String(req.body.filename) : null;

    const run = await prisma.payrollRun.findUnique({
      where: { id },
      include: { payslips: { include: { employee: true } } },
    });
    if (!run) throw Object.assign(new Error("Not found"), { status: 404 });
    requireApprovedRun(run);

    const parsed = parseBankStatementCsv(csv);
    const report = matchAgainstPayslips(
      parsed,
      run.payslips.map((p) => ({
        employeeId: p.employeeId,
        employeeNo: p.employee.employeeNo,
        employeeName: `${p.employee.firstName} ${p.employee.lastName}`,
        netPay: p.netPay,
      }))
    );

    const stmt = await prisma.bankStatement.create({
      data: {
        payrollRunId: run.id,
        filename,
        lines: {
          create: report.results.map((r) => ({
            rawLine: r.rawLine,
            amount: r.amount,
            reference: r.reference,
            matchedEmployeeId: r.matchedEmployeeId,
            matchedAmount: r.matchedAmount,
            status: r.status,
          })),
        },
      },
      include: { lines: true },
    });
    await audit(req.auth, "payroll.reconciliation", "PayrollRun", run.id, `Reconciled bank statement: ${report.summary.matched} matched, ${report.summary.unmatched} unmatched, ${report.summary.amountMismatch} mismatch`);
    res.status(201).json({ bankStatementId: stmt.id, ...report });
  })
);

// GET /runs/:id/reconciliation — the latest reconciliation for a run (HR only:
// exposes net-pay/bank data across every employee in the run).
router.get(
  "/runs/:id/reconciliation",
  requireHR,
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const stmt = await prisma.bankStatement.findFirst({
      where: { payrollRunId: id },
      orderBy: { uploadedAt: "desc" },
      include: { lines: true },
    });
    if (!stmt) return res.json(null);
    const summary = {
      matched: stmt.lines.filter((l) => l.status === "matched").length,
      unmatched: stmt.lines.filter((l) => l.status === "unmatched").length,
      amountMismatch: stmt.lines.filter((l) => l.status === "amount-mismatch").length,
      total: stmt.lines.length,
    };
    res.json({ bankStatementId: stmt.id, uploadedAt: stmt.uploadedAt, filename: stmt.filename, results: stmt.lines, summary });
  })
);

// ---------------------------------------------------------------------------
// CPF summary (existing).
// ---------------------------------------------------------------------------

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
