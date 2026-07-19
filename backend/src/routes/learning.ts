// Learning & Development route module — the Learning/Training vertical slice.
// Employees track their own training records and certifications; managers/HR
// see the whole organisation and get renewal reminders for expiring (mandatory)
// certifications. Mounted at /api/learning by app.ts.
import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../prisma.js";
import { authenticate, type AuthRequest } from "../middleware/auth.js";
import { requireManager, requireHR, isManagerRole } from "../middleware/rbac.js";
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

const isHRRole = (req: AuthRequest) => req.auth?.role === "admin" || req.auth?.role === "hr";

// Coerce an incoming date string to a valid Date or throw a 400.
function parseDate(v: unknown, name: string): Date {
  if (v === undefined || v === null || v === "") throw badRequest(`${name} is required`);
  const d = new Date(v as string);
  if (isNaN(d.getTime())) throw badRequest(`Invalid ${name}`);
  return d;
}

// Optional date: undefined/empty → null, otherwise a validated Date.
function optionalDate(v: unknown, name: string): Date | null {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(v as string);
  if (isNaN(d.getTime())) throw badRequest(`Invalid ${name}`);
  return d;
}

const employeeSelect = {
  employee: { select: { firstName: true, lastName: true, employeeNo: true } },
} as const;

// Resolve the target employeeId for a list request and enforce scope rules.
// scope=mine → the caller's own record; scope=all → managers/HR only.
// An explicit employeeId (for staff) narrows an "all" listing to one employee.
function resolveListEmployee(req: AuthRequest): number | { in: number[] } | null | undefined {
  const scope = String(req.query.scope ?? "mine");
  const employeeIdQuery = req.query.employeeId;

  if (scope === "all") {
    if (!isManagerRole(req)) throw forbidden();
    if (employeeIdQuery != null && String(employeeIdQuery) !== "") {
      return intParam(String(employeeIdQuery), "employeeId");
    }
    return undefined; // no filter — the whole organisation
  }

  // scope=mine (default): the caller's own record only.
  return req.auth?.employeeId ?? null;
}

// ---- training records -----------------------------------------------------

// GET /records?scope=mine|all&employeeId= — list training records in scope.
router.get(
  "/records",
  ah(async (req: AuthRequest, res: Response) => {
    const target = resolveListEmployee(req);
    if (target === null) return res.json([]);

    const where = target === undefined ? {} : { employeeId: target };
    const records = await prisma.trainingRecord.findMany({
      where,
      include: employeeSelect,
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    });
    res.json(records);
  })
);

// POST /records — enrol in / log training. Any employee for themselves; HR to
// add a record for someone else.
router.post(
  "/records",
  ah(async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    let employeeId = req.auth?.employeeId ?? null;
    if (body.employeeId != null && String(body.employeeId) !== "") {
      const requested = intParam(String(body.employeeId), "employeeId");
      if (requested !== req.auth?.employeeId && !isHRRole(req)) {
        throw forbidden("Only HR can add training for other employees");
      }
      employeeId = requested;
    }
    if (employeeId == null) throw badRequest("No employee record linked to this account");

    const courseName = String(body.courseName ?? "").trim();
    if (!courseName) throw badRequest("courseName is required");
    const provider =
      body.provider != null && String(body.provider).trim() !== "" ? String(body.provider) : null;

    const hoursRaw = body.hours;
    const hours = hoursRaw == null || hoursRaw === "" ? 0 : Number(hoursRaw);
    if (!Number.isFinite(hours) || hours < 0) throw badRequest("Invalid hours");

    const allowed = ["enrolled", "in-progress", "completed"];
    const status = body.status != null && String(body.status) !== "" ? String(body.status) : "enrolled";
    if (!allowed.includes(status)) throw badRequest("Invalid status");

    const created = await prisma.trainingRecord.create({
      data: {
        employeeId,
        courseName,
        provider,
        hours,
        status,
        completedAt: status === "completed" ? new Date() : null,
      },
      include: employeeSelect,
    });

    await audit(req.auth, "learning.record.create", "TrainingRecord", created.id, courseName);
    res.status(201).json(created);
  })
);

// PUT /records/:id — update status / completion / hours. Employees may update
// their own; HR may update anyone's.
router.put(
  "/records/:id",
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const record = await prisma.trainingRecord.findUnique({ where: { id } });
    if (!record) throw notFound("Training record not found");
    if (record.employeeId !== req.auth?.employeeId && !isHRRole(req)) {
      throw forbidden("You can only update your own training records");
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const data: { status?: string; completedAt?: Date | null; hours?: number } = {};

    if (body.status != null && String(body.status) !== "") {
      const status = String(body.status);
      const allowed = ["enrolled", "in-progress", "completed"];
      if (!allowed.includes(status)) throw badRequest("Invalid status");
      data.status = status;
      // Completing without an explicit completedAt stamps it now.
      if (status === "completed" && record.completedAt == null && body.completedAt == null) {
        data.completedAt = new Date();
      }
    }

    if (body.completedAt !== undefined) {
      data.completedAt = optionalDate(body.completedAt, "completedAt");
    }

    if (body.hours != null && String(body.hours) !== "") {
      const hours = Number(body.hours);
      if (!Number.isFinite(hours) || hours < 0) throw badRequest("Invalid hours");
      data.hours = hours;
    }

    const updated = await prisma.trainingRecord.update({
      where: { id },
      data,
      include: employeeSelect,
    });

    await audit(req.auth, "learning.record.update", "TrainingRecord", id);
    res.json(updated);
  })
);

// ---- certifications -------------------------------------------------------

// GET /certifications?scope=mine|all&employeeId= — list certifications in scope.
router.get(
  "/certifications",
  ah(async (req: AuthRequest, res: Response) => {
    const target = resolveListEmployee(req);
    if (target === null) return res.json([]);

    const where = target === undefined ? {} : { employeeId: target };
    const certs = await prisma.certification.findMany({
      where,
      include: employeeSelect,
      orderBy: { expiryDate: "asc" },
    });
    res.json(certs);
  })
);

// POST /certifications — record a certification. Any employee for themselves;
// HR to add for someone else.
router.post(
  "/certifications",
  ah(async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    let employeeId = req.auth?.employeeId ?? null;
    if (body.employeeId != null && String(body.employeeId) !== "") {
      const requested = intParam(String(body.employeeId), "employeeId");
      if (requested !== req.auth?.employeeId && !isHRRole(req)) {
        throw forbidden("Only HR can add certifications for other employees");
      }
      employeeId = requested;
    }
    if (employeeId == null) throw badRequest("No employee record linked to this account");

    const name = String(body.name ?? "").trim();
    if (!name) throw badRequest("name is required");
    const authority =
      body.authority != null && String(body.authority).trim() !== "" ? String(body.authority) : null;
    const issuedDate = optionalDate(body.issuedDate, "issuedDate");
    const expiryDate = optionalDate(body.expiryDate, "expiryDate");
    const mandatory = body.mandatory === true || String(body.mandatory) === "true";

    const created = await prisma.certification.create({
      data: { employeeId, name, authority, issuedDate, expiryDate, mandatory },
      include: employeeSelect,
    });

    await audit(req.auth, "learning.certification.create", "Certification", created.id, name);
    res.status(201).json(created);
  })
);

// DELETE /certifications/:id — remove a certification (HR only).
router.delete(
  "/certifications/:id",
  requireHR,
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const cert = await prisma.certification.findUnique({ where: { id } });
    if (!cert) throw notFound("Certification not found");

    await prisma.certification.delete({ where: { id } });
    await audit(req.auth, "learning.certification.delete", "Certification", id, cert.name);
    res.json({ ok: true });
  })
);

// GET /expiring — certifications expiring within 60 days (renewal reminders).
// Manager/HR/admin only — mirrors the workflow-alert pattern.
router.get(
  "/expiring",
  requireManager,
  ah(async (_req: AuthRequest, res: Response) => {
    const now = new Date();
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + 60);

    const certs = await prisma.certification.findMany({
      where: { expiryDate: { gte: now, lte: horizon } },
      include: employeeSelect,
      orderBy: { expiryDate: "asc" },
    });
    res.json(certs);
  })
);

export default router;
