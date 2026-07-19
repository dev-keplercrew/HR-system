// Time & Attendance route module — the Time & Attendance vertical slice.
// Employees clock in/out and file overtime; managers/HR maintain the shift
// roster and approve or reject overtime requests. Mounted at /api/attendance.
import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../prisma.js";
import { authenticate, type AuthRequest } from "../middleware/auth.js";
import { requireManager, isManagerRole } from "../middleware/rbac.js";
import { ah, intParam } from "../http.js";
import { audit } from "../services/audit.js";

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

// Midnight (local) of "today" — the canonical date key for a day's attendance.
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Round to two decimal places.
const round2 = (n: number) => Math.round(n * 100) / 100;

const employeeInclude = { employee: true } as const;

// ---- shifts (roster) ------------------------------------------------------

// GET /shifts?scope=mine|all&employeeId= — shifts in scope, newest first.
router.get(
  "/shifts",
  ah(async (req: AuthRequest, res: Response) => {
    const scope = String(req.query.scope ?? "mine");
    const employeeIdQuery = req.query.employeeId;

    const where: { employeeId?: number } = {};
    if (scope === "mine") {
      if (req.auth?.employeeId == null) return res.json([]);
      where.employeeId = req.auth.employeeId;
    } else {
      // scope=all — only managers/HR/admin may see other employees' shifts.
      if (!isManagerRole(req)) throw forbidden();
      if (employeeIdQuery != null && String(employeeIdQuery) !== "") {
        where.employeeId = intParam(String(employeeIdQuery), "employeeId");
      }
      // else every shift
    }

    const shifts = await prisma.shift.findMany({
      where,
      include: employeeInclude,
      orderBy: { date: "desc" },
    });
    res.json(shifts);
  })
);

// POST /shifts — schedule a shift. Booking for oneself is always allowed;
// scheduling anybody else requires a manager/HR/admin role.
router.post(
  "/shifts",
  ah(async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const self = req.auth?.employeeId ?? null;

    let employeeId: number;
    if (body.employeeId != null && String(body.employeeId) !== "") {
      employeeId = intParam(String(body.employeeId), "employeeId");
      if (employeeId !== self && !isManagerRole(req)) {
        throw forbidden("Only managers can schedule shifts for others");
      }
    } else {
      if (self == null) throw badRequest("No employee record linked to this account");
      employeeId = self;
    }

    const date = parseDate(body.date, "date");
    const startTime = String(body.startTime ?? "").trim();
    const endTime = String(body.endTime ?? "").trim();
    if (!startTime) throw badRequest("startTime is required");
    if (!endTime) throw badRequest("endTime is required");
    const location =
      body.location != null && String(body.location).trim() !== "" ? String(body.location).trim() : null;

    const created = await prisma.shift.create({
      data: { employeeId, date, startTime, endTime, location },
      include: employeeInclude,
    });

    await audit(req.auth, "attendance.shift.create", "Shift", created.id, `${startTime}–${endTime}`);
    res.status(201).json(created);
  })
);

// ---- attendance records ---------------------------------------------------

// GET /records?scope=mine|all&employeeId= — attendance records, newest first.
router.get(
  "/records",
  ah(async (req: AuthRequest, res: Response) => {
    const scope = String(req.query.scope ?? "mine");
    const employeeIdQuery = req.query.employeeId;

    const where: { employeeId?: number } = {};
    if (scope === "all") {
      if (!isManagerRole(req)) throw forbidden();
      if (employeeIdQuery != null && String(employeeIdQuery) !== "") {
        where.employeeId = intParam(String(employeeIdQuery), "employeeId");
      }
      // else every record
    } else {
      // scope=mine (default)
      if (req.auth?.employeeId == null) return res.json([]);
      where.employeeId = req.auth.employeeId;
    }

    const records = await prisma.attendanceRecord.findMany({
      where,
      include: employeeInclude,
      orderBy: { date: "desc" },
    });
    res.json(records);
  })
);

// POST /records/clock { type: 'in' | 'out' } — clock the caller in or out for
// today. Clocking out computes worked and overtime hours.
router.post(
  "/records/clock",
  ah(async (req: AuthRequest, res: Response) => {
    const employeeId = req.auth?.employeeId;
    if (employeeId == null) throw badRequest("No employee record linked to this account");

    const body = (req.body ?? {}) as Record<string, unknown>;
    const type = String(body.type ?? "");
    if (type !== "in" && type !== "out") throw badRequest("type must be 'in' or 'out'");

    const today = startOfToday();
    const now = new Date();

    const existing = await prisma.attendanceRecord.findFirst({
      where: { employeeId, date: today },
    });

    let record;
    if (type === "in") {
      if (existing) {
        record = await prisma.attendanceRecord.update({
          where: { id: existing.id },
          data: { clockIn: now },
          include: employeeInclude,
        });
      } else {
        record = await prisma.attendanceRecord.create({
          data: { employeeId, date: today, clockIn: now, scheduledHours: 8 },
          include: employeeInclude,
        });
      }
    } else {
      // type === "out"
      if (!existing || !existing.clockIn) {
        throw badRequest("You must clock in before clocking out");
      }
      const workedHours = round2(
        (now.getTime() - existing.clockIn.getTime()) / (1000 * 60 * 60)
      );
      const overtimeHours = round2(Math.max(0, workedHours - existing.scheduledHours));
      record = await prisma.attendanceRecord.update({
        where: { id: existing.id },
        data: { clockOut: now, workedHours, overtimeHours },
        include: employeeInclude,
      });
    }

    await audit(req.auth, `attendance.clock.${type}`, "AttendanceRecord", record.id);
    res.status(existing ? 200 : 201).json(record);
  })
);

// ---- overtime -------------------------------------------------------------

// GET /overtime?scope=mine|team|all&status= — overtime requests in scope.
router.get(
  "/overtime",
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
      if (managerId == null) return res.json([]);
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

    const requests = await prisma.overtimeRequest.findMany({
      where,
      include: employeeInclude,
      orderBy: { createdAt: "desc" },
    });
    res.json(requests);
  })
);

// POST /overtime { date, hours, reason } — file an overtime request for the caller.
router.post(
  "/overtime",
  ah(async (req: AuthRequest, res: Response) => {
    const employeeId = req.auth?.employeeId;
    if (employeeId == null) throw badRequest("No employee record linked to this account");

    const body = (req.body ?? {}) as Record<string, unknown>;
    const date = parseDate(body.date, "date");
    const hours = Number(body.hours);
    if (!Number.isFinite(hours) || hours <= 0) throw badRequest("hours must be a positive number");
    const reason =
      body.reason != null && String(body.reason).trim() !== "" ? String(body.reason).trim() : null;

    const created = await prisma.overtimeRequest.create({
      data: { employeeId, date, hours, reason, status: "pending" },
      include: employeeInclude,
    });

    await audit(req.auth, "attendance.overtime.request", "OvertimeRequest", created.id, `${hours}h`);
    res.status(201).json(created);
  })
);

// POST /overtime/:id/approve — approve a pending overtime request (manager/HR/admin).
router.post(
  "/overtime/:id/approve",
  requireManager,
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const request = await prisma.overtimeRequest.findUnique({ where: { id } });
    if (!request) throw notFound("Overtime request not found");
    if (request.status !== "pending") throw badRequest("Only pending requests can be approved");

    const updated = await prisma.overtimeRequest.update({
      where: { id },
      data: { status: "approved", approverId: req.auth?.employeeId ?? null },
      include: employeeInclude,
    });

    await audit(req.auth, "attendance.overtime.approve", "OvertimeRequest", id);
    res.json(updated);
  })
);

// POST /overtime/:id/reject — reject a pending overtime request (manager/HR/admin).
router.post(
  "/overtime/:id/reject",
  requireManager,
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const request = await prisma.overtimeRequest.findUnique({ where: { id } });
    if (!request) throw notFound("Overtime request not found");
    if (request.status !== "pending") throw badRequest("Only pending requests can be rejected");

    const updated = await prisma.overtimeRequest.update({
      where: { id },
      data: { status: "rejected", approverId: req.auth?.employeeId ?? null },
      include: employeeInclude,
    });

    await audit(req.auth, "attendance.overtime.reject", "OvertimeRequest", id);
    res.json(updated);
  })
);

export default router;
