// Reporting & Analytics route module.
//
// Read-only aggregation across the HRIS data model plus a whitelist-driven
// ad-hoc report builder with an Excel (xlsx) export. All aggregation is done in
// application code from safe, non-sensitive columns; the ad-hoc builder rejects
// any field not on the per-source whitelist.
import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../prisma.js";
import { authenticate, type AuthRequest } from "../middleware/auth.js";
import { requireHR } from "../middleware/rbac.js";
import { ah } from "../http.js";
import * as XLSX from "xlsx";

const router = Router();
router.use(authenticate);

// Employees considered "active" for headcount analytics.
const ACTIVE_STATUSES = ["active", "probation", "on-leave"];

// ---------------------------------------------------------------------------
// Ad-hoc report whitelist. Only these columns may ever be selected/exported.
// Each field maps to a resolver that reads it from a fetched record.
// ---------------------------------------------------------------------------
type Source = "employees" | "payroll" | "leave" | "claims";

interface FieldDef {
  key: string;
  label: string;
  get: (row: any) => unknown;
}

const SOURCES: Record<Source, { label: string; fields: FieldDef[] }> = {
  employees: {
    label: "Employees",
    fields: [
      { key: "employeeNo", label: "Employee No", get: (e) => e.employeeNo },
      { key: "firstName", label: "First Name", get: (e) => e.firstName },
      { key: "lastName", label: "Last Name", get: (e) => e.lastName },
      { key: "jobTitle", label: "Job Title", get: (e) => e.jobTitle ?? "" },
      { key: "status", label: "Status", get: (e) => e.status },
      { key: "employmentType", label: "Employment Type", get: (e) => e.employmentType },
      { key: "payrollGroup", label: "Payroll Group", get: (e) => e.payrollGroup },
      { key: "basicSalary", label: "Basic Salary", get: (e) => e.basicSalary },
      { key: "department", label: "Department", get: (e) => e.department?.name ?? "" },
    ],
  },
  payroll: {
    label: "Payroll",
    fields: [
      { key: "period", label: "Period", get: (p) => p.payrollRun?.period ?? "" },
      { key: "payrollGroup", label: "Payroll Group", get: (p) => p.payrollRun?.payrollGroup ?? "" },
      { key: "employeeNo", label: "Employee No", get: (p) => p.employee?.employeeNo ?? "" },
      { key: "grossPay", label: "Gross Pay", get: (p) => p.grossPay },
      { key: "netPay", label: "Net Pay", get: (p) => p.netPay },
      { key: "employeeCpf", label: "Employee CPF", get: (p) => p.employeeCpf },
      { key: "employerCpf", label: "Employer CPF", get: (p) => p.employerCpf },
    ],
  },
  leave: {
    label: "Leave",
    fields: [
      { key: "employeeNo", label: "Employee No", get: (b) => b.employee?.employeeNo ?? "" },
      { key: "leaveType", label: "Leave Type", get: (b) => b.leaveType?.name ?? "" },
      { key: "year", label: "Year", get: (b) => b.year },
      { key: "entitled", label: "Entitled", get: (b) => b.entitled },
      { key: "taken", label: "Taken", get: (b) => b.taken },
      { key: "pending", label: "Pending", get: (b) => b.pending },
    ],
  },
  claims: {
    label: "Claims",
    fields: [
      { key: "employeeNo", label: "Employee No", get: (c) => c.employee?.employeeNo ?? "" },
      { key: "claimType", label: "Claim Type", get: (c) => c.claimType?.name ?? "" },
      { key: "amount", label: "Amount", get: (c) => c.amount },
      { key: "status", label: "Status", get: (c) => c.status },
    ],
  },
};

interface AdhocFilters {
  status?: string;
  department?: string;
  payrollGroup?: string;
}

// Fetch raw records for a source, applying the (optional) supported filters.
async function fetchSourceRows(source: Source, filters: AdhocFilters): Promise<any[]> {
  switch (source) {
    case "employees": {
      const where: Record<string, unknown> = {};
      if (filters.status) where.status = filters.status;
      if (filters.payrollGroup) where.payrollGroup = filters.payrollGroup;
      if (filters.department) where.department = { name: filters.department };
      return prisma.employee.findMany({
        where,
        include: { department: true },
        orderBy: { employeeNo: "asc" },
      });
    }
    case "payroll": {
      const runWhere: Record<string, unknown> = {};
      if (filters.payrollGroup) runWhere.payrollGroup = filters.payrollGroup;
      return prisma.payslip.findMany({
        where: Object.keys(runWhere).length ? { payrollRun: runWhere } : {},
        include: { payrollRun: true, employee: true },
        orderBy: { id: "desc" },
      });
    }
    case "leave": {
      const empWhere: Record<string, unknown> = {};
      if (filters.status) empWhere.status = filters.status;
      if (filters.department) empWhere.department = { name: filters.department };
      if (filters.payrollGroup) empWhere.payrollGroup = filters.payrollGroup;
      return prisma.leaveBalance.findMany({
        where: Object.keys(empWhere).length ? { employee: empWhere } : {},
        include: { employee: true, leaveType: true },
        orderBy: { id: "asc" },
      });
    }
    case "claims": {
      const empWhere: Record<string, unknown> = {};
      if (filters.department) empWhere.department = { name: filters.department };
      if (filters.payrollGroup) empWhere.payrollGroup = filters.payrollGroup;
      const where: Record<string, unknown> = {};
      if (filters.status) where.status = filters.status;
      if (Object.keys(empWhere).length) where.employee = empWhere;
      return prisma.claim.findMany({
        where,
        include: { employee: true, claimType: true },
        orderBy: { id: "desc" },
      });
    }
  }
}

// Validate the request, resolve columns, and build the labelled rows for a
// whitelisted ad-hoc report. Throws 400 on any unknown source/field.
async function buildAdhoc(
  source: string,
  fields: string[],
  filters: AdhocFilters
): Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }> {
  const def = SOURCES[source as Source];
  if (!def) throw Object.assign(new Error("Unknown report source"), { status: 400 });
  if (!Array.isArray(fields) || fields.length === 0) {
    throw Object.assign(new Error("Select at least one field"), { status: 400 });
  }

  const selected: FieldDef[] = fields.map((key) => {
    const fd = def.fields.find((f) => f.key === key);
    if (!fd) throw Object.assign(new Error(`Unknown field: ${key}`), { status: 400 });
    return fd;
  });

  const records = await fetchSourceRows(source as Source, filters);
  const rows = records.map((rec) => {
    const row: Record<string, unknown> = {};
    for (const fd of selected) row[fd.key] = fd.get(rec);
    return row;
  });

  return { columns: selected.map((f) => ({ key: f.key, label: f.label })), rows };
}

// ---------------------------------------------------------------------------
// GET /headcount — workforce composition analytics.
// ---------------------------------------------------------------------------
router.get(
  "/headcount",
  requireHR,
  ah(async (_req, res) => {
    const employees = await prisma.employee.findMany({
      include: { department: true },
    });

    const total = employees.length;
    const active = employees.filter((e) => ACTIVE_STATUSES.includes(e.status)).length;

    const tally = (rows: string[]) => {
      const map = new Map<string, number>();
      for (const r of rows) map.set(r, (map.get(r) ?? 0) + 1);
      return map;
    };

    const deptMap = tally(employees.map((e) => e.department?.name ?? "Unassigned"));
    const byDepartment = [...deptMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const statusMap = tally(employees.map((e) => e.status));
    const byStatus = [...statusMap.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);

    const typeMap = tally(employees.map((e) => e.employmentType));
    const byType = [...typeMap.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    res.json({ total, active, byDepartment, byStatus, byType });
  })
);

// ---------------------------------------------------------------------------
// GET /payroll-summary — totals from the most recent payroll runs.
// ---------------------------------------------------------------------------
router.get(
  "/payroll-summary",
  requireHR,
  ah(async (_req, res) => {
    const latest = await prisma.payrollRun.findFirst({
      orderBy: { runDate: "desc" },
      select: { period: true },
    });
    const latestPeriod = latest?.period ?? null;

    // "Most recent runs" = all runs in the latest period (one per group).
    const runs = latestPeriod
      ? await prisma.payrollRun.findMany({ where: { period: latestPeriod } })
      : [];

    const runIds = runs.map((r) => r.id);
    const payslips = runIds.length
      ? await prisma.payslip.findMany({ where: { payrollRunId: { in: runIds } } })
      : [];

    const totalGross = runs.reduce((s, r) => s + r.totalGross, 0);
    const totalNet = runs.reduce((s, r) => s + r.totalNet, 0);
    const totalEmployeeCpf = payslips.reduce((s, p) => s + p.employeeCpf, 0);
    const totalEmployerCpf = payslips.reduce((s, p) => s + p.employerCpf, 0);

    const groupMap = new Map<string, { totalNet: number; count: number }>();
    for (const r of runs) {
      const g = groupMap.get(r.payrollGroup) ?? { totalNet: 0, count: 0 };
      g.totalNet += r.totalNet;
      groupMap.set(r.payrollGroup, g);
    }
    // Employee counts per group from payslips joined via run.
    for (const p of payslips) {
      const run = runs.find((r) => r.id === p.payrollRunId);
      if (!run) continue;
      const g = groupMap.get(run.payrollGroup);
      if (g) g.count += 1;
    }

    const byGroup = [...groupMap.entries()]
      .map(([payrollGroup, v]) => ({ payrollGroup, totalNet: v.totalNet, count: v.count }))
      .sort((a, b) => b.totalNet - a.totalNet);

    res.json({
      latestPeriod,
      totalGross,
      totalNet,
      totalEmployeeCpf,
      totalEmployerCpf,
      byGroup,
    });
  })
);

// ---------------------------------------------------------------------------
// GET /leave-summary — leave utilisation for the current year.
// ---------------------------------------------------------------------------
router.get(
  "/leave-summary",
  requireHR,
  ah(async (_req, res) => {
    const year = new Date().getFullYear();
    const balances = await prisma.leaveBalance.findMany({
      where: { year },
      include: { leaveType: true },
    });

    const map = new Map<string, { entitled: number; taken: number }>();
    for (const b of balances) {
      const name = b.leaveType?.name ?? "Other";
      const agg = map.get(name) ?? { entitled: 0, taken: 0 };
      agg.entitled += b.entitled;
      agg.taken += b.taken;
      map.set(name, agg);
    }
    const byType = [...map.entries()]
      .map(([name, v]) => ({ name, entitled: v.entitled, taken: v.taken }))
      .sort((a, b) => b.entitled - a.entitled);

    const pendingRequests = await prisma.leaveRequest.count({ where: { status: "pending" } });

    res.json({ byType, pendingRequests });
  })
);

// ---------------------------------------------------------------------------
// GET /fields — whitelist of report sources + selectable fields (HR only).
// ---------------------------------------------------------------------------
router.get(
  "/fields",
  requireHR,
  ah(async (_req, res) => {
    const sources = (Object.keys(SOURCES) as Source[]).map((key) => ({
      key,
      label: SOURCES[key].label,
      fields: SOURCES[key].fields.map((f) => ({ key: f.key, label: f.label })),
    }));
    res.json({ sources });
  })
);

// ---------------------------------------------------------------------------
// POST /adhoc — build a report from whitelisted fields (HR only).
// ---------------------------------------------------------------------------
router.post(
  "/adhoc",
  requireHR,
  ah(async (req: AuthRequest, res: Response) => {
    const source = String(req.body?.source ?? "");
    const fields = Array.isArray(req.body?.fields) ? (req.body.fields as string[]).map(String) : [];
    const filters: AdhocFilters = (req.body?.filters ?? {}) as AdhocFilters;
    const result = await buildAdhoc(source, fields, filters);
    res.json(result);
  })
);

// ---------------------------------------------------------------------------
// GET /adhoc/export — same rows as /adhoc, streamed as an .xlsx (HR only).
// The GET form (query params) lets the frozen download() helper fetch it.
// ---------------------------------------------------------------------------
router.get(
  "/adhoc/export",
  requireHR,
  ah(async (req: AuthRequest, res: Response) => {
    const source = String(req.query.source ?? "");
    const fields = String(req.query.fields ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let filters: AdhocFilters = {};
    if (req.query.filters) {
      try {
        filters = JSON.parse(String(req.query.filters)) as AdhocFilters;
      } catch {
        throw Object.assign(new Error("Invalid filters JSON"), { status: 400 });
      }
    }

    const { rows } = await buildAdhoc(source, fields, filters);

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, source);
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename=report-${source}.xlsx`);
    res.send(buf);
  })
);

// ---------------------------------------------------------------------------
// Saved reports (HR only).
// ---------------------------------------------------------------------------
router.get(
  "/saved",
  requireHR,
  ah(async (_req, res) => {
    const saved = await prisma.savedReport.findMany({ orderBy: { createdAt: "desc" } });
    res.json(saved);
  })
);

router.post(
  "/saved",
  requireHR,
  ah(async (req: AuthRequest, res: Response) => {
    const name = String(req.body?.name ?? "").trim();
    const source = String(req.body?.source ?? "").trim();
    const fields = Array.isArray(req.body?.fields) ? (req.body.fields as string[]).map(String) : [];
    const filters = (req.body?.filters ?? {}) as AdhocFilters;

    if (!name) throw Object.assign(new Error("Report name is required"), { status: 400 });
    if (!SOURCES[source as Source]) throw Object.assign(new Error("Unknown report source"), { status: 400 });
    // Validate every field against the source whitelist before persisting.
    for (const key of fields) {
      if (!SOURCES[source as Source].fields.some((f) => f.key === key)) {
        throw Object.assign(new Error(`Unknown field: ${key}`), { status: 400 });
      }
    }

    const created = await prisma.savedReport.create({
      data: {
        name,
        source,
        fields: JSON.stringify(fields),
        filters: JSON.stringify(filters),
      },
    });
    res.status(201).json(created);
  })
);

export default router;
