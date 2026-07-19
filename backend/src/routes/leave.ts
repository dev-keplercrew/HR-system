// Leave Management route module — the Leave vertical slice.
// Employees apply for leave and cancel their own pending requests; managers/HR
// approve or reject. Leave balances (entitled / taken / pending) are kept in
// step with each state transition. Mounted at /api/leave by app.ts.
import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../prisma.js";
import { authenticate, type AuthRequest } from "../middleware/auth.js";
import { requireManager, isManagerRole } from "../middleware/rbac.js";
import { ah, intParam } from "../http.js";
import { audit } from "../services/audit.js";
import { leaveDays, availableDays } from "../services/leaveCalc.js";

const router = Router();
router.use(authenticate);

// ---- helpers --------------------------------------------------------------

function badRequest(message: string) {
  return Object.assign(new Error(message), { status: 400 });
}
function forbidden(message = "Insufficient permissions") {
  return Object.assign(new Error(message), { status: 403 });
}
function notFound(message = "Not found") {
  return Object.assign(new Error(message), { status: 404 });
}

// Coerce an incoming date string to a valid Date or throw a 400.
function parseDate(v: unknown, name: string): Date {
  if (v === undefined || v === null || v === "") throw badRequest(`${name} is required`);
  const d = new Date(v as string);
  if (isNaN(d.getTime())) throw badRequest(`Invalid ${name}`);
  return d;
}

// Find (or lazily create) the current-year balance row for an employee + type.
// Entitlement seeds from the leave type's annual quota when first created.
async function ensureBalance(employeeId: number, leaveTypeId: number) {
  const year = new Date().getFullYear();
  const existing = await prisma.leaveBalance.findUnique({
    where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
  });
  if (existing) return existing;
  const leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
  return prisma.leaveBalance.create({
    data: {
      employeeId,
      leaveTypeId,
      year,
      entitled: leaveType?.annualQuota ?? 0,
      taken: 0,
      pending: 0,
    },
  });
}

// Resolve the balance row that a given request draws from (created in the
// request's own year), returning null if it no longer exists.
function balanceForRequest(employeeId: number, leaveTypeId: number, when: Date) {
  const year = new Date(when).getFullYear();
  return prisma.leaveBalance.findUnique({
    where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
  });
}

const requestInclude = { employee: true, leaveType: true } as const;

// ---- leave types ----------------------------------------------------------

// GET /types — all configured leave types.
router.get(
  "/types",
  ah(async (_req: AuthRequest, res: Response) => {
    const types = await prisma.leaveType.findMany({ orderBy: { name: "asc" } });
    res.json(types);
  })
);

// ---- requests -------------------------------------------------------------

// GET /requests?scope=mine|team|all&status= — list requests in scope.
router.get(
  "/requests",
  ah(async (req: AuthRequest, res: Response) => {
    const scope = String(req.query.scope ?? "mine");
    const status = req.query.status ? String(req.query.status) : undefined;

    const where: { employeeId?: number | { in: number[] }; status?: string } = {};
    if (status && status !== "all") where.status = status;

    if (scope === "all") {
      if (!isManagerRole(req)) throw forbidden();
      // no employee filter — every request
    } else if (scope === "team") {
      const managerId = req.auth?.employeeId;
      if (managerId == null) {
        return res.json([]);
      }
      const reports = await prisma.employee.findMany({
        where: { managerId },
        select: { id: true },
      });
      where.employeeId = { in: reports.map((e) => e.id) };
    } else {
      // scope=mine (default)
      if (req.auth?.employeeId == null) return res.json([]);
      where.employeeId = req.auth.employeeId;
    }

    const requests = await prisma.leaveRequest.findMany({
      where,
      include: requestInclude,
      orderBy: { createdAt: "desc" },
    });
    res.json(requests);
  })
);

// POST /requests — apply for leave (any authenticated employee).
router.post(
  "/requests",
  ah(async (req: AuthRequest, res: Response) => {
    const employeeId = req.auth?.employeeId;
    if (employeeId == null) throw badRequest("No employee record linked to this account");

    const body = (req.body ?? {}) as Record<string, unknown>;
    const leaveTypeId = intParam(String(body.leaveTypeId ?? ""), "leaveTypeId");
    const startDate = parseDate(body.startDate, "startDate");
    const endDate = parseDate(body.endDate, "endDate");
    if (endDate.getTime() < startDate.getTime()) {
      throw badRequest("endDate must be on or after startDate");
    }
    const reason =
      body.reason != null && String(body.reason).trim() !== "" ? String(body.reason) : null;

    const leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
    if (!leaveType) throw badRequest("Unknown leave type");

    const days = leaveDays(startDate, endDate);

    // Reject up front if the request would exceed the employee's remaining
    // entitlement for this leave type this year.
    const balance = await ensureBalance(employeeId, leaveTypeId);
    const available = availableDays(balance);
    if (days > available) {
      throw badRequest(
        `Requested ${days} day(s) exceeds available balance of ${available} day(s) for ${leaveType.name}`
      );
    }

    const created = await prisma.leaveRequest.create({
      data: {
        employeeId,
        leaveTypeId,
        startDate,
        endDate,
        days,
        reason,
        status: "pending",
      },
      include: requestInclude,
    });

    // Reserve the days against this year's balance (atomic — avoids losing
    // concurrent updates from a read-then-write).
    await prisma.leaveBalance.update({
      where: { id: balance.id },
      data: { pending: { increment: days } },
    });

    await audit(req.auth, "leave.apply", "LeaveRequest", created.id, `${days} day(s) ${leaveType.name}`);
    res.status(201).json(created);
  })
);

// POST /requests/:id/approve — approve a pending request (manager/HR/admin).
router.post(
  "/requests/:id/approve",
  requireManager,
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const request = await prisma.leaveRequest.findUnique({ where: { id }, include: { employee: true } });
    if (!request) throw notFound("Leave request not found");
    if (req.auth?.role === "manager" && request.employee.managerId !== req.auth.employeeId) {
      throw forbidden("You can only decide leave requests for your own direct reports");
    }
    if (request.status !== "pending") throw badRequest("Only pending requests can be approved");

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: {
        status: "approved",
        approverId: req.auth?.employeeId ?? null,
        decidedAt: new Date(),
      },
      include: requestInclude,
    });

    // Move the reserved days from pending → taken (atomic — avoids losing
    // concurrent updates from a read-then-write).
    const balance = await balanceForRequest(request.employeeId, request.leaveTypeId, request.startDate);
    if (balance) {
      await prisma.leaveBalance.update({
        where: { id: balance.id },
        data: {
          pending: { decrement: request.days },
          taken: { increment: request.days },
        },
      });
    }

    await audit(req.auth, "leave.approve", "LeaveRequest", id);
    res.json(updated);
  })
);

// POST /requests/:id/reject — reject a pending request (manager/HR/admin).
router.post(
  "/requests/:id/reject",
  requireManager,
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const request = await prisma.leaveRequest.findUnique({ where: { id }, include: { employee: true } });
    if (!request) throw notFound("Leave request not found");
    if (req.auth?.role === "manager" && request.employee.managerId !== req.auth.employeeId) {
      throw forbidden("You can only decide leave requests for your own direct reports");
    }
    if (request.status !== "pending") throw badRequest("Only pending requests can be rejected");

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: {
        status: "rejected",
        approverId: req.auth?.employeeId ?? null,
        decidedAt: new Date(),
      },
      include: requestInclude,
    });

    // Release the reserved days back (atomic — avoids losing concurrent
    // updates from a read-then-write).
    const balance = await balanceForRequest(request.employeeId, request.leaveTypeId, request.startDate);
    if (balance) {
      await prisma.leaveBalance.update({
        where: { id: balance.id },
        data: { pending: { decrement: request.days } },
      });
    }

    await audit(req.auth, "leave.reject", "LeaveRequest", id);
    res.json(updated);
  })
);

// POST /requests/:id/cancel — withdraw one's own still-pending request.
router.post(
  "/requests/:id/cancel",
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const request = await prisma.leaveRequest.findUnique({ where: { id } });
    if (!request) throw notFound("Leave request not found");
    if (req.auth?.employeeId == null || request.employeeId !== req.auth.employeeId) {
      throw forbidden("You can only cancel your own leave requests");
    }
    if (request.status !== "pending") throw badRequest("Only pending requests can be cancelled");

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: { status: "cancelled", decidedAt: new Date() },
      include: requestInclude,
    });

    // Release the reserved days back (atomic — avoids losing concurrent
    // updates from a read-then-write).
    const balance = await balanceForRequest(request.employeeId, request.leaveTypeId, request.startDate);
    if (balance) {
      await prisma.leaveBalance.update({
        where: { id: balance.id },
        data: { pending: { decrement: request.days } },
      });
    }

    await audit(req.auth, "leave.cancel", "LeaveRequest", id);
    res.json(updated);
  })
);

// ---- balances -------------------------------------------------------------

// GET /balances?scope=mine&employeeId= — leave balances for the caller (mine)
// or, for managers/HR, a specified employee.
router.get(
  "/balances",
  ah(async (req: AuthRequest, res: Response) => {
    const employeeIdQuery = req.query.employeeId;

    let employeeId: number | null;
    if (employeeIdQuery != null && String(employeeIdQuery) !== "") {
      if (!isManagerRole(req)) throw forbidden();
      employeeId = intParam(String(employeeIdQuery), "employeeId");
    } else {
      // scope=mine (default): the caller's own balances.
      employeeId = req.auth?.employeeId ?? null;
    }

    if (employeeId == null) return res.json([]);

    const balances = await prisma.leaveBalance.findMany({
      where: { employeeId },
      include: { leaveType: true },
      orderBy: { leaveType: { name: "asc" } },
    });
    res.json(balances);
  })
);

export default router;
