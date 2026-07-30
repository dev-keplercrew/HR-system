// Employee Lifecycle routes — onboarding & offboarding checklists plus company
// asset issue/return tracking. Mounted at /api/lifecycle by app.ts. Every handler
// runs behind `authenticate`; mutations are further gated by role guards.
//
// This models the RFP workflow examples, e.g. "New Hire Created → notify IT,
// Hiring Manager" (the onboarding checklist auto-fans work out to departments).
import { Router } from "express";
import { prisma } from "../prisma.js";
import { authenticate, type AuthRequest } from "../middleware/auth.js";
import { requireHR, requireManager } from "../middleware/rbac.js";
import { ah, intParam } from "../http.js";
import { audit } from "../services/audit.js";
import { buildIr21 } from "../services/irasExport.js";

const router = Router();
router.use(authenticate);

// ---- helpers --------------------------------------------------------------

function notFound(message = "Not found") {
  return Object.assign(new Error(message), { status: 404 });
}
function badRequest(message: string) {
  return Object.assign(new Error(message), { status: 400 });
}

const TASK_STATUSES = ["pending", "in-progress", "done"] as const;
const ASSET_CATEGORIES = ["hardware", "access-card", "phone", "other"] as const;

// Standard checklist templates. Each entry becomes one task row for the employee.
const ONBOARDING_TEMPLATE = [
  { title: "Provision laptop & accounts", department: "IT" },
  { title: "Grant building access card", department: "Facilities" },
  { title: "Assign onboarding buddy", department: "Hiring Manager" },
  { title: "Complete HR documentation", department: "HR" },
  { title: "Add to payroll", department: "HR" },
  { title: "Security & systems access", department: "IT" },
] as const;

const OFFBOARDING_TEMPLATE = [
  { title: "Return company assets", department: "IT" },
  { title: "Revoke system access", department: "IT" },
  { title: "Final payroll & clearance", department: "HR" },
  { title: "Exit interview", department: "HR" },
  { title: "Handover documentation", department: "Hiring Manager" },
] as const;

const taskInclude = { employee: { include: { department: true } } } as const;

// Read the target employeeId from a request body, requiring a valid positive int.
function requireEmployeeId(body: Record<string, any>): number {
  if (body.employeeId === undefined || body.employeeId === null || body.employeeId === "") {
    throw badRequest("employeeId is required");
  }
  return intParam(String(body.employeeId), "employeeId");
}

async function ensureEmployee(id: number) {
  const emp = await prisma.employee.findUnique({ where: { id } });
  if (!emp) throw notFound("Employee not found");
  return emp;
}

function plusDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function validStatus(body: Record<string, any>): (typeof TASK_STATUSES)[number] {
  const status = body.status;
  if (!TASK_STATUSES.includes(status)) {
    throw badRequest(`status must be one of ${TASK_STATUSES.join(", ")}`);
  }
  return status;
}

// ---- onboarding -----------------------------------------------------------

// GET /onboarding?employeeId= — all onboarding tasks (optionally scoped to one
// employee), ordered by creation for stable checklist rendering.
router.get(
  "/onboarding",
  ah(async (req: AuthRequest, res) => {
    const where =
      req.query.employeeId != null && req.query.employeeId !== ""
        ? { employeeId: intParam(String(req.query.employeeId), "employeeId") }
        : {};
    const tasks = await prisma.onboardingTask.findMany({
      where,
      include: taskInclude,
      orderBy: { createdAt: "asc" },
    });
    res.json(tasks);
  })
);

// POST /onboarding { employeeId } — auto-generate the standard onboarding
// checklist. Idempotent: if the employee already has tasks, returns them.
router.post(
  "/onboarding",
  requireHR,
  ah(async (req: AuthRequest, res) => {
    const employeeId = requireEmployeeId((req.body ?? {}) as Record<string, any>);
    await ensureEmployee(employeeId);

    const existing = await prisma.onboardingTask.findMany({
      where: { employeeId },
      include: taskInclude,
      orderBy: { createdAt: "asc" },
    });
    if (existing.length > 0) {
      return res.json(existing);
    }

    const dueDate = plusDays(7);
    await prisma.onboardingTask.createMany({
      data: ONBOARDING_TEMPLATE.map((t) => ({
        employeeId,
        title: t.title,
        department: t.department,
        status: "pending",
        dueDate,
      })),
    });
    await audit(req.auth, "create", "OnboardingChecklist", employeeId);

    const tasks = await prisma.onboardingTask.findMany({
      where: { employeeId },
      include: taskInclude,
      orderBy: { createdAt: "asc" },
    });
    res.status(201).json(tasks);
  })
);

// PATCH /onboarding/tasks/:id { status } — advance a single checklist item.
router.patch(
  "/onboarding/tasks/:id",
  requireManager,
  ah(async (req: AuthRequest, res) => {
    const id = intParam(req.params.id);
    const status = validStatus((req.body ?? {}) as Record<string, any>);
    const existing = await prisma.onboardingTask.findUnique({ where: { id } });
    if (!existing) throw notFound("Onboarding task not found");
    const updated = await prisma.onboardingTask.update({
      where: { id },
      data: { status },
      include: taskInclude,
    });
    await audit(req.auth, "update", "OnboardingTask", id, `status=${status}`);
    res.json(updated);
  })
);

// ---- offboarding ----------------------------------------------------------

// GET /offboarding?employeeId= — all offboarding tasks (optionally scoped).
router.get(
  "/offboarding",
  ah(async (req: AuthRequest, res) => {
    const where =
      req.query.employeeId != null && req.query.employeeId !== ""
        ? { employeeId: intParam(String(req.query.employeeId), "employeeId") }
        : {};
    const tasks = await prisma.offboardingTask.findMany({
      where,
      include: taskInclude,
      orderBy: { createdAt: "asc" },
    });
    res.json(tasks);
  })
);

// POST /offboarding { employeeId } — generate the exit-clearance checklist.
// Idempotent like onboarding.
router.post(
  "/offboarding",
  requireHR,
  ah(async (req: AuthRequest, res) => {
    const employeeId = requireEmployeeId((req.body ?? {}) as Record<string, any>);
    await ensureEmployee(employeeId);

    const existing = await prisma.offboardingTask.findMany({
      where: { employeeId },
      include: taskInclude,
      orderBy: { createdAt: "asc" },
    });
    if (existing.length > 0) {
      return res.json(existing);
    }

    const dueDate = plusDays(7);
    await prisma.offboardingTask.createMany({
      data: OFFBOARDING_TEMPLATE.map((t) => ({
        employeeId,
        title: t.title,
        department: t.department,
        status: "pending",
        dueDate,
      })),
    });
    await audit(req.auth, "create", "OffboardingChecklist", employeeId);

    const tasks = await prisma.offboardingTask.findMany({
      where: { employeeId },
      include: taskInclude,
      orderBy: { createdAt: "asc" },
    });
    res.status(201).json(tasks);
  })
);

// PATCH /offboarding/tasks/:id { status } — advance an exit-clearance item.
router.patch(
  "/offboarding/tasks/:id",
  requireManager,
  ah(async (req: AuthRequest, res) => {
    const id = intParam(req.params.id);
    const status = validStatus((req.body ?? {}) as Record<string, any>);
    const existing = await prisma.offboardingTask.findUnique({ where: { id } });
    if (!existing) throw notFound("Offboarding task not found");
    const updated = await prisma.offboardingTask.update({
      where: { id },
      data: { status },
      include: taskInclude,
    });
    await audit(req.auth, "update", "OffboardingTask", id, `status=${status}`);
    res.json(updated);
  })
);

// POST /offboarding/:employeeId/ir21 — generate an IRAS IR21 tax-clearance record
// for a departing FOREIGN employee (item 4). Wired to the offboarding flow as an
// action, discoverable from the Offboarding page. HR-only.
router.post(
  "/offboarding/:employeeId/ir21",
  requireHR,
  ah(async (req: AuthRequest, res) => {
    const employeeId = intParam(req.params.employeeId, "employeeId");
    const emp = await ensureEmployee(employeeId);
    const clearanceDate = req.body?.clearanceDate ? new Date(String(req.body.clearanceDate)) : new Date();
    if (Number.isNaN(clearanceDate.getTime())) {
      throw badRequest(`clearanceDate '${req.body.clearanceDate}' is not a valid date`);
    }
    const ir21 = buildIr21(
      {
        employeeNo: emp.employeeNo,
        firstName: emp.firstName,
        lastName: emp.lastName,
        nric: emp.nric,
        nationality: emp.nationality,
        dateOfBirth: emp.dateOfBirth,
        workPassType: emp.workPassType,
      },
      clearanceDate
    );
    if (!ir21.applicable) {
      throw badRequest(
        `IR21 tax clearance applies only to departing foreign employees (EP/SP/WP). ${emp.employeeNo} has workPassType '${emp.workPassType ?? "none"}'.`
      );
    }
    await audit(req.auth, "lifecycle.ir21", "Employee", employeeId, `Generated IR21 tax clearance`);
    res.status(201).json(ir21);
  })
);

// ---- assets ---------------------------------------------------------------

const assetInclude = { employee: { include: { department: true } } } as const;

// GET /assets — full asset register, ordered by tag.
router.get(
  "/assets",
  ah(async (_req: AuthRequest, res) => {
    const assets = await prisma.asset.findMany({
      include: assetInclude,
      orderBy: { tag: "asc" },
    });
    res.json(assets);
  })
);

// POST /assets { tag, name, category } — register a new (available) asset.
router.post(
  "/assets",
  requireHR,
  ah(async (req: AuthRequest, res) => {
    const b = (req.body ?? {}) as Record<string, any>;
    for (const k of ["tag", "name"] as const) {
      if (!b[k] || String(b[k]).trim() === "") throw badRequest(`${k} is required`);
    }
    const category = b.category ?? "hardware";
    if (!ASSET_CATEGORIES.includes(category)) {
      throw badRequest(`category must be one of ${ASSET_CATEGORIES.join(", ")}`);
    }
    const dup = await prisma.asset.findUnique({ where: { tag: String(b.tag) } });
    if (dup) throw badRequest("An asset with this tag already exists");

    const created = await prisma.asset.create({
      data: {
        tag: String(b.tag).trim(),
        name: String(b.name).trim(),
        category,
        status: "available",
      },
      include: assetInclude,
    });
    await audit(req.auth, "create", "Asset", created.id);
    res.status(201).json(created);
  })
);

// POST /assets/:id/issue { employeeId } — assign an asset to an employee.
router.post(
  "/assets/:id/issue",
  requireHR,
  ah(async (req: AuthRequest, res) => {
    const id = intParam(req.params.id);
    const employeeId = requireEmployeeId((req.body ?? {}) as Record<string, any>);
    await ensureEmployee(employeeId);
    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset) throw notFound("Asset not found");

    const updated = await prisma.asset.update({
      where: { id },
      data: { status: "issued", employeeId, issuedDate: new Date(), returnedDate: null },
      include: assetInclude,
    });
    await audit(req.auth, "update", "Asset", id, `issued to employee ${employeeId}`);
    res.json(updated);
  })
);

// POST /assets/:id/return — mark an issued asset as returned (keeps the
// employeeId as the historical record of who held it).
router.post(
  "/assets/:id/return",
  requireHR,
  ah(async (req: AuthRequest, res) => {
    const id = intParam(req.params.id);
    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset) throw notFound("Asset not found");

    const updated = await prisma.asset.update({
      where: { id },
      data: { status: "returned", returnedDate: new Date() },
      include: assetInclude,
    });
    await audit(req.auth, "update", "Asset", id, "returned");
    res.json(updated);
  })
);

// ---- picker helper --------------------------------------------------------

// GET /employees-lite — slim employee list for the on/offboarding pickers.
router.get(
  "/employees-lite",
  ah(async (_req: AuthRequest, res) => {
    const employees = await prisma.employee.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeNo: true,
        status: true,
        jobTitle: true,
      },
      orderBy: { employeeNo: "asc" },
    });
    res.json(employees);
  })
);

export default router;
