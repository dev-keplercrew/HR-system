// Security & Governance admin route module — user administration + audit trail.
//
// Admin-only surface: manage application users (create, change role, activate/
// deactivate) and read the append-only audit log. Password hashes are never
// returned to the client. Every mutation is audited.
import { Router } from "express";
import type { Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma.js";
import { authenticate, type AuthRequest } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/rbac.js";
import { ah, intParam } from "../http.js";
import { audit } from "../services/audit.js";

const router = Router();
router.use(authenticate);

const ROLES = ["admin", "hr", "manager", "employee"];

// Shape sent to the client — passwordHash is deliberately omitted.
function publicUser(u: {
  id: number;
  email: string;
  role: string;
  active: boolean;
  createdAt: Date;
  employee?: { id: number; firstName: string; lastName: string; employeeNo: string } | null;
}) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    active: u.active,
    createdAt: u.createdAt,
    employee: u.employee ?? null,
  };
}

const employeeSelect = { id: true, firstName: true, lastName: true, employeeNo: true } as const;

// GET /users — all users (no password hashes) with any linked employee.
router.get(
  "/users",
  requireAdmin,
  ah(async (_req, res) => {
    const users = await prisma.user.findMany({
      include: { employee: { select: employeeSelect } },
      orderBy: { createdAt: "desc" },
    });
    res.json(users.map(publicUser));
  })
);

// POST /users { email, password, role, employeeId? } — create a login.
router.post(
  "/users",
  requireAdmin,
  ah(async (req: AuthRequest, res: Response) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const role = String(req.body?.role ?? "").trim();
    const employeeIdRaw = req.body?.employeeId;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw Object.assign(new Error("A valid email is required"), { status: 400 });
    }
    if (password.length < 6) {
      throw Object.assign(new Error("Password must be at least 6 characters"), { status: 400 });
    }
    if (!ROLES.includes(role)) {
      throw Object.assign(new Error("Invalid role"), { status: 400 });
    }

    let employeeId: number | null = null;
    if (employeeIdRaw != null && String(employeeIdRaw) !== "") {
      employeeId = intParam(String(employeeIdRaw), "employeeId");
      const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
      if (!emp) throw Object.assign(new Error("Employee not found"), { status: 400 });
      if (emp.userId != null) {
        throw Object.assign(new Error("That employee is already linked to a user"), { status: 409 });
      }
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw Object.assign(new Error("A user with that email already exists"), { status: 409 });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role,
        ...(employeeId != null ? { employee: { connect: { id: employeeId } } } : {}),
      },
      include: { employee: { select: employeeSelect } },
    });

    await audit(req.auth, "admin.user.create", "User", user.id, `Created ${role} user ${email}`);
    res.status(201).json(publicUser(user));
  })
);

// PATCH /users/:id { role?, active? } — update role and/or activation.
router.patch(
  "/users/:id",
  requireAdmin,
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw Object.assign(new Error("Not found"), { status: 404 });

    const data: { role?: string; active?: boolean } = {};
    const changes: string[] = [];

    if (req.body?.role !== undefined) {
      const role = String(req.body.role);
      if (!ROLES.includes(role)) throw Object.assign(new Error("Invalid role"), { status: 400 });
      data.role = role;
      changes.push(`role→${role}`);
    }
    if (req.body?.active !== undefined) {
      const active = Boolean(req.body.active);
      data.active = active;
      changes.push(active ? "activated" : "deactivated");
    }

    if (Object.keys(data).length === 0) {
      throw Object.assign(new Error("Nothing to update"), { status: 400 });
    }

    const user = await prisma.user.update({
      where: { id },
      data,
      include: { employee: { select: employeeSelect } },
    });

    await audit(req.auth, "admin.user.update", "User", id, `Updated ${existing.email}: ${changes.join(", ")}`);
    res.json(publicUser(user));
  })
);

// ---------------------------------------------------------------------------
// Statutory configuration (admin-editable rates/ceilings/levy-bands/bank-formats
// and the employer CSN) — so a 2026 rate revision is a data change, not a code
// change. Every mutation is audited. All endpoints are admin-only.
// ---------------------------------------------------------------------------

async function ensureStatutoryConfig() {
  const existing = await prisma.statutoryConfig.findFirst();
  if (existing) return existing;
  return prisma.statutoryConfig.create({ data: {} });
}

// GET /statutory-config — the singleton statutory config row.
router.get(
  "/statutory-config",
  requireAdmin,
  ah(async (_req, res) => {
    res.json(await ensureStatutoryConfig());
  })
);

// PATCH /statutory-config — update any statutory ceiling/rate/CSN/default bank.
router.patch(
  "/statutory-config",
  requireAdmin,
  ah(async (req: AuthRequest, res: Response) => {
    const cfg = await ensureStatutoryConfig();
    const b = (req.body ?? {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    const changes: string[] = [];
    const numFields = [
      "cpfOwCeiling",
      "awCeilingAnnual",
      "sdlRate",
      "sdlWageCap",
      "sdlMinAmount",
      "sdlMaxAmount",
      "otCapHoursPerMonth",
      "otMultiplier",
      "workingDaysPerMonth",
      "workingHoursPerMonth",
    ] as const;
    for (const f of numFields) {
      if (b[f] !== undefined) {
        const n = Number(b[f]);
        if (!Number.isFinite(n) || n < 0) throw Object.assign(new Error(`${f} must be a non-negative number`), { status: 400 });
        data[f] = n;
        changes.push(`${f}→${n}`);
      }
    }
    if (b.employerCsn !== undefined) {
      data.employerCsn = String(b.employerCsn).trim();
      changes.push("employerCsn");
    }
    if (b.defaultBankFormat !== undefined) {
      const key = String(b.defaultBankFormat).trim();
      const known = await prisma.bankFormatConfig.findUnique({ where: { bankKey: key } });
      if (!known) throw Object.assign(new Error(`Unknown bank format: ${key}`), { status: 400 });
      data.defaultBankFormat = key;
      changes.push(`defaultBankFormat→${key}`);
    }
    if (Object.keys(data).length === 0) throw Object.assign(new Error("Nothing to update"), { status: 400 });
    const updated = await prisma.statutoryConfig.update({ where: { id: cfg.id }, data });
    await audit(req.auth, "admin.statutoryConfig.update", "StatutoryConfig", cfg.id, changes.join(", "));
    res.json(updated);
  })
);

// GET/POST/PATCH /self-help-fund-rates — banded CDAC/MBMF/SINDA/ECF contributions.
router.get(
  "/self-help-fund-rates",
  requireAdmin,
  ah(async (_req, res) => {
    res.json(await prisma.selfHelpFundRate.findMany({ orderBy: [{ ethnicGroup: "asc" }, { wageLower: "asc" }] }));
  })
);
router.post(
  "/self-help-fund-rates",
  requireAdmin,
  ah(async (req: AuthRequest, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const ethnicGroup = String(b.ethnicGroup ?? "").trim().toUpperCase();
    if (!["CDAC", "MBMF", "SINDA", "ECF"].includes(ethnicGroup)) {
      throw Object.assign(new Error("ethnicGroup must be one of CDAC, MBMF, SINDA, ECF"), { status: 400 });
    }
    const created = await prisma.selfHelpFundRate.create({
      data: {
        ethnicGroup,
        wageLower: Number(b.wageLower ?? 0),
        wageUpper: Number(b.wageUpper ?? 0),
        amount: Number(b.amount ?? 0),
      },
    });
    await audit(req.auth, "admin.selfHelpFundRate.create", "SelfHelpFundRate", created.id, `${ethnicGroup} band`);
    res.status(201).json(created);
  })
);
router.patch(
  "/self-help-fund-rates/:id",
  requireAdmin,
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const existing = await prisma.selfHelpFundRate.findUnique({ where: { id } });
    if (!existing) throw Object.assign(new Error("Not found"), { status: 404 });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const f of ["wageLower", "wageUpper", "amount"] as const) if (b[f] !== undefined) data[f] = Number(b[f]);
    if (Object.keys(data).length === 0) throw Object.assign(new Error("Nothing to update"), { status: 400 });
    const updated = await prisma.selfHelpFundRate.update({ where: { id }, data });
    await audit(req.auth, "admin.selfHelpFundRate.update", "SelfHelpFundRate", id, Object.keys(data).join(","));
    res.json(updated);
  })
);

// GET/POST/PATCH /cpf-rate-bands — CPF age-banded employee/employer contribution
// rates, ordered by sortOrder (so the 2026 rate revision is a data change).
router.get(
  "/cpf-rate-bands",
  requireAdmin,
  ah(async (_req, res) => {
    res.json(await prisma.cpfRateBand.findMany({ orderBy: { sortOrder: "asc" } }));
  })
);
router.post(
  "/cpf-rate-bands",
  requireAdmin,
  ah(async (req: AuthRequest, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const label = String(b.label ?? "").trim();
    if (!label) throw Object.assign(new Error("label is required"), { status: 400 });
    const created = await prisma.cpfRateBand.create({
      data: {
        ageUpper: b.ageUpper === undefined || b.ageUpper === null ? null : Number(b.ageUpper),
        employeeRate: Number(b.employeeRate ?? 0),
        employerRate: Number(b.employerRate ?? 0),
        label,
        sortOrder: Number(b.sortOrder ?? 0),
      },
    });
    await audit(req.auth, "admin.cpfRateBand.create", "CpfRateBand", created.id, `${label} band`);
    res.status(201).json(created);
  })
);
router.patch(
  "/cpf-rate-bands/:id",
  requireAdmin,
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const existing = await prisma.cpfRateBand.findUnique({ where: { id } });
    if (!existing) throw Object.assign(new Error("Not found"), { status: 404 });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (b.ageUpper !== undefined) data.ageUpper = b.ageUpper === null ? null : Number(b.ageUpper);
    for (const f of ["employeeRate", "employerRate", "sortOrder"] as const) if (b[f] !== undefined) data[f] = Number(b[f]);
    if (b.label !== undefined) data.label = String(b.label);
    if (Object.keys(data).length === 0) throw Object.assign(new Error("Nothing to update"), { status: 400 });
    const updated = await prisma.cpfRateBand.update({ where: { id }, data });
    await audit(req.auth, "admin.cpfRateBand.update", "CpfRateBand", id, Object.keys(data).join(","));
    res.json(updated);
  })
);

// GET/POST/PATCH /allowance-components — itemised allowance lines (e.g.
// Transport, Meal), each a percentage of prorated basic pay, ordered by
// sortOrder. An empty table falls back to a single legacy 10% "Allowance" line
// (see payrollCalc.allowanceBreakdown).
router.get(
  "/allowance-components",
  requireAdmin,
  ah(async (_req, res) => {
    res.json(await prisma.allowanceComponent.findMany({ orderBy: { sortOrder: "asc" } }));
  })
);
router.post(
  "/allowance-components",
  requireAdmin,
  ah(async (req: AuthRequest, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const label = String(b.label ?? "").trim();
    if (!label) throw Object.assign(new Error("label is required"), { status: 400 });
    const percentageOfBasic = Number(b.percentageOfBasic ?? 0);
    if (!Number.isFinite(percentageOfBasic) || percentageOfBasic < 0) {
      throw Object.assign(new Error("percentageOfBasic must be a non-negative number"), { status: 400 });
    }
    const created = await prisma.allowanceComponent.create({
      data: { label, percentageOfBasic, sortOrder: Number(b.sortOrder ?? 0) },
    });
    await audit(req.auth, "admin.allowanceComponent.create", "AllowanceComponent", created.id, `${label} (${percentageOfBasic})`);
    res.status(201).json(created);
  })
);
router.patch(
  "/allowance-components/:id",
  requireAdmin,
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const existing = await prisma.allowanceComponent.findUnique({ where: { id } });
    if (!existing) throw Object.assign(new Error("Not found"), { status: 404 });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (b.percentageOfBasic !== undefined) data.percentageOfBasic = Number(b.percentageOfBasic);
    if (b.sortOrder !== undefined) data.sortOrder = Number(b.sortOrder);
    if (b.label !== undefined) data.label = String(b.label);
    if (Object.keys(data).length === 0) throw Object.assign(new Error("Nothing to update"), { status: 400 });
    const updated = await prisma.allowanceComponent.update({ where: { id }, data });
    await audit(req.auth, "admin.allowanceComponent.update", "AllowanceComponent", id, Object.keys(data).join(","));
    res.json(updated);
  })
);

// GET/POST/PATCH /fwl-rates — Foreign Worker Levy rates per pass type / tier.
router.get(
  "/fwl-rates",
  requireAdmin,
  ah(async (_req, res) => {
    res.json(await prisma.fwlRateConfig.findMany({ orderBy: [{ workPassType: "asc" }, { tier: "asc" }] }));
  })
);
router.post(
  "/fwl-rates",
  requireAdmin,
  ah(async (req: AuthRequest, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const workPassType = String(b.workPassType ?? "").trim().toLowerCase();
    if (!["sp", "wp"].includes(workPassType)) throw Object.assign(new Error("workPassType must be sp or wp"), { status: 400 });
    const created = await prisma.fwlRateConfig.create({
      data: { workPassType, tier: String(b.tier ?? "basic"), monthlyRate: Number(b.monthlyRate ?? 0) },
    });
    await audit(req.auth, "admin.fwlRate.create", "FwlRateConfig", created.id, `${workPassType}/${created.tier}`);
    res.status(201).json(created);
  })
);
router.patch(
  "/fwl-rates/:id",
  requireAdmin,
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const existing = await prisma.fwlRateConfig.findUnique({ where: { id } });
    if (!existing) throw Object.assign(new Error("Not found"), { status: 404 });
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (b.monthlyRate === undefined) throw Object.assign(new Error("Nothing to update"), { status: 400 });
    const updated = await prisma.fwlRateConfig.update({ where: { id }, data: { monthlyRate: Number(b.monthlyRate) } });
    await audit(req.auth, "admin.fwlRate.update", "FwlRateConfig", id, `monthlyRate→${updated.monthlyRate}`);
    res.json(updated);
  })
);

// GET/PATCH /bank-formats — selectable GIRO bank adapters + default flag.
router.get(
  "/bank-formats",
  requireAdmin,
  ah(async (_req, res) => {
    res.json(await prisma.bankFormatConfig.findMany({ orderBy: { bankKey: "asc" } }));
  })
);
router.patch(
  "/bank-formats/:id",
  requireAdmin,
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const existing = await prisma.bankFormatConfig.findUnique({ where: { id } });
    if (!existing) throw Object.assign(new Error("Not found"), { status: 404 });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (b.label !== undefined) data.label = String(b.label);
    if (b.isDefault !== undefined) data.isDefault = Boolean(b.isDefault);
    if (Object.keys(data).length === 0) throw Object.assign(new Error("Nothing to update"), { status: 400 });
    // isDefault is the single source of truth for "the default GIRO bank":
    // flipping it on also clears every OTHER row's isDefault and mirrors the
    // choice into StatutoryConfig.defaultBankFormat (the field the server-side
    // fallback in routes/payroll.ts actually reads), so the UI's "default"
    // badge and the non-UI fallback never disagree.
    const updated = await prisma.$transaction(async (tx) => {
      if (data.isDefault === true) {
        await tx.bankFormatConfig.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
        const cfg = await tx.statutoryConfig.findFirst();
        if (cfg) await tx.statutoryConfig.update({ where: { id: cfg.id }, data: { defaultBankFormat: existing.bankKey } });
        else await tx.statutoryConfig.create({ data: { defaultBankFormat: existing.bankKey } });
      }
      return tx.bankFormatConfig.update({ where: { id }, data });
    });
    await audit(req.auth, "admin.bankFormat.update", "BankFormatConfig", id, Object.keys(data).join(","));
    res.json(updated);
  })
);

// GET /audit — latest 100 audit entries, newest first.
router.get(
  "/audit",
  requireAdmin,
  ah(async (_req, res) => {
    const logs = await prisma.auditLog.findMany({
      include: { user: { select: { email: true, role: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(logs);
  })
);

// GET /employees-lite — minimal employee list for the create-user picker.
router.get(
  "/employees-lite",
  requireAdmin,
  ah(async (_req, res) => {
    const employees = await prisma.employee.findMany({
      select: employeeSelect,
      orderBy: { employeeNo: "asc" },
    });
    res.json(employees);
  })
);

export default router;
