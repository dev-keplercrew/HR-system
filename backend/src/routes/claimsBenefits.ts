// Claims & Benefits route module — employee claim submission, manager approvals
// and per-employee annual benefit balances. Mounted at /api/claims.
import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../prisma.js";
import { authenticate, type AuthRequest } from "../middleware/auth.js";
import { requireManager, isManagerRole as isManager } from "../middleware/rbac.js";
import { ah, intParam } from "../http.js";
import { audit } from "../services/audit.js";

const router = Router();
router.use(authenticate);

// Statuses that count against an annual cap (money committed or paid out).
const CONSUMING_STATUSES = ["approved", "paid"];

// GET /types — all claim types (used to populate the submission form).
router.get(
  "/types",
  ah(async (_req, res) => {
    const types = await prisma.claimType.findMany({ orderBy: { name: "asc" } });
    res.json(types);
  })
);

// GET /?scope=mine|all&status= — list claims.
//   mine (default): the caller's own claims.
//   all: every claim (manager/hr/admin only, else 403).
router.get(
  "/",
  ah(async (req: AuthRequest, res: Response) => {
    const scope = String(req.query.scope ?? "mine");
    const status = req.query.status != null ? String(req.query.status) : undefined;

    const where: { employeeId?: number; status?: string } = {};
    if (status) where.status = status;

    if (scope === "all") {
      if (!isManager(req)) throw Object.assign(new Error("Insufficient permissions"), { status: 403 });
    } else {
      if (req.auth?.employeeId == null) return res.json([]);
      where.employeeId = req.auth.employeeId;
    }

    const claims = await prisma.claim.findMany({
      where,
      include: { employee: true, claimType: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(claims);
  })
);

// POST / — submit a new claim for the caller (status pending).
router.post(
  "/",
  ah(async (req: AuthRequest, res: Response) => {
    if (req.auth?.employeeId == null) {
      throw Object.assign(new Error("No employee profile linked to this account"), { status: 400 });
    }

    const claimTypeId = intParam(String(req.body?.claimTypeId ?? ""), "claimTypeId");
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw Object.assign(new Error("amount must be a positive number"), { status: 400 });
    }
    const description = req.body?.description != null ? String(req.body.description).trim() : null;

    const claimType = await prisma.claimType.findUnique({ where: { id: claimTypeId } });
    if (!claimType) throw Object.assign(new Error("Invalid claim type"), { status: 400 });

    const rawDate = req.body?.claimDate;
    const claimDate = rawDate ? new Date(String(rawDate)) : new Date();
    if (isNaN(claimDate.getTime())) {
      throw Object.assign(new Error("Invalid claimDate"), { status: 400 });
    }

    const claim = await prisma.claim.create({
      data: {
        employeeId: req.auth.employeeId,
        claimTypeId,
        amount,
        claimDate,
        description,
        status: "pending",
      },
      include: { employee: true, claimType: true },
    });

    await audit(
      req.auth,
      "claim.submit",
      "Claim",
      claim.id,
      `Submitted ${claimType.name} claim of ${amount}`
    );

    res.status(201).json(claim);
  })
);

// POST /:id/approve — manager approves a pending claim.
router.post(
  "/:id/approve",
  requireManager,
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const existing = await prisma.claim.findUnique({ where: { id }, include: { employee: true } });
    if (!existing) throw Object.assign(new Error("Not found"), { status: 404 });
    if (req.auth?.role === "manager" && existing.employee.managerId !== req.auth.employeeId) {
      throw Object.assign(new Error("You can only decide claims for your own direct reports"), { status: 403 });
    }
    if (existing.status !== "pending") {
      throw Object.assign(new Error("Only pending claims can be approved"), { status: 400 });
    }

    const claim = await prisma.claim.update({
      where: { id },
      data: {
        status: "approved",
        approverId: req.auth?.employeeId ?? null,
        decidedAt: new Date(),
      },
      include: { employee: true, claimType: true },
    });

    await audit(req.auth, "claim.approve", "Claim", claim.id, `Approved claim ${claim.id}`);
    res.json(claim);
  })
);

// POST /:id/reject — manager rejects a pending claim.
router.post(
  "/:id/reject",
  requireManager,
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const existing = await prisma.claim.findUnique({ where: { id }, include: { employee: true } });
    if (!existing) throw Object.assign(new Error("Not found"), { status: 404 });
    if (req.auth?.role === "manager" && existing.employee.managerId !== req.auth.employeeId) {
      throw Object.assign(new Error("You can only decide claims for your own direct reports"), { status: 403 });
    }
    if (existing.status !== "pending") {
      throw Object.assign(new Error("Only pending claims can be rejected"), { status: 400 });
    }

    const claim = await prisma.claim.update({
      where: { id },
      data: {
        status: "rejected",
        approverId: req.auth?.employeeId ?? null,
        decidedAt: new Date(),
      },
      include: { employee: true, claimType: true },
    });

    await audit(req.auth, "claim.reject", "Claim", claim.id, `Rejected claim ${claim.id}`);
    res.json(claim);
  })
);

// GET /balances?scope=mine&employeeId= — annual benefit balance per claim type
// for one employee (cap, used this year, remaining).
router.get(
  "/balances",
  ah(async (req: AuthRequest, res: Response) => {
    const scope = String(req.query.scope ?? "mine");

    let employeeId: number | null;
    if (scope === "mine") {
      employeeId = req.auth?.employeeId ?? null;
    } else {
      if (!isManager(req)) throw Object.assign(new Error("Insufficient permissions"), { status: 403 });
      const q = req.query.employeeId;
      employeeId = q != null ? intParam(String(q), "employeeId") : (req.auth?.employeeId ?? null);
    }

    if (employeeId == null) return res.json([]);

    const types = await prisma.claimType.findMany({ orderBy: { name: "asc" } });

    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const yearEnd = new Date(new Date().getFullYear() + 1, 0, 1);

    const balances = await Promise.all(
      types.map(async (t) => {
        const agg = await prisma.claim.aggregate({
          _sum: { amount: true },
          where: {
            employeeId: employeeId as number,
            claimTypeId: t.id,
            status: { in: CONSUMING_STATUSES },
            claimDate: { gte: yearStart, lt: yearEnd },
          },
        });
        const cap = t.annualCap;
        const used = agg._sum.amount ?? 0;
        return {
          claimType: { id: t.id, name: t.name, code: t.code },
          cap,
          used,
          remaining: Math.max(0, cap - used),
        };
      })
    );

    res.json(balances);
  })
);

export default router;
