// Performance Management route module — goals, reviews, ranking, history.
// Mounted at /api/performance by app.ts. Every handler runs behind `authenticate`.
import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../prisma.js";
import { authenticate, type AuthRequest } from "../middleware/auth.js";
import { requireManager } from "../middleware/rbac.js";
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

const employeeSelect = {
  id: true,
  firstName: true,
  lastName: true,
  employeeNo: true,
  departmentId: true,
  department: { select: { name: true } },
} as const;

function isManager(req: AuthRequest): boolean {
  const role = req.auth?.role;
  return role === "admin" || role === "hr" || role === "manager";
}

// Ids of employees managed (directly) by the given manager employeeId.
async function managedEmployeeIds(managerEmployeeId: number): Promise<number[]> {
  const reports = await prisma.employee.findMany({
    where: { managerId: managerEmployeeId },
    select: { id: true },
  });
  return reports.map((r) => r.id);
}

// Authorize a write against a specific employee's goal/review: the owner may
// always act on their own; admin/hr are unrestricted; a manager is restricted
// to their own direct reports (not company-wide, unlike the role-only isManager()).
async function assertCanActOn(req: AuthRequest, targetId: number): Promise<void> {
  if (req.auth?.employeeId === targetId) return;
  const role = req.auth?.role;
  if (role === "admin" || role === "hr") return;
  if (role === "manager" && req.auth?.employeeId != null) {
    const ids = await managedEmployeeIds(req.auth.employeeId);
    if (ids.includes(targetId)) return;
  }
  throw forbidden();
}

function clampInt(v: unknown, name: string, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw badRequest(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

// ---- goals ----------------------------------------------------------------

// GET /goals?scope=mine|team&employeeId= — Goal[] newest first.
router.get(
  "/goals",
  ah(async (req: AuthRequest, res: Response) => {
    const scope = String(req.query.scope ?? "mine");
    const employeeIdQuery = req.query.employeeId;

    let where: { employeeId?: number | { in: number[] } } = {};

    if (employeeIdQuery != null) {
      const targetId = intParam(String(employeeIdQuery), "employeeId");
      // Employees may only read their own goals; managers/HR/admin may read any.
      if (!isManager(req) && req.auth?.employeeId !== targetId) throw forbidden();
      where = { employeeId: targetId };
    } else if (scope === "team") {
      const me = req.auth?.employeeId;
      if (me == null) return res.json([]);
      where = { employeeId: { in: await managedEmployeeIds(me) } };
    } else {
      // scope=mine (default)
      const me = req.auth?.employeeId;
      if (me == null) return res.json([]);
      where = { employeeId: me };
    }

    const goals = await prisma.goal.findMany({
      where,
      include: { employee: { select: employeeSelect } },
      orderBy: { createdAt: "desc" },
    });
    res.json(goals);
  })
);

// POST /goals { title, description, weight, cycle, employeeId? }
router.post(
  "/goals",
  ah(async (req: AuthRequest, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const title = String(b.title ?? "").trim();
    if (!title) throw badRequest("title is required");
    const cycle = String(b.cycle ?? "").trim();
    if (!cycle) throw badRequest("cycle is required");

    const targetId =
      b.employeeId != null && b.employeeId !== ""
        ? intParam(String(b.employeeId), "employeeId")
        : req.auth?.employeeId;
    if (targetId == null) throw badRequest("No employee to attach goal to");

    // Setting a goal for someone else requires managing them (or admin/hr).
    await assertCanActOn(req, targetId);

    const weight =
      b.weight == null || b.weight === "" ? 0 : clampInt(b.weight, "weight", 0, 100);

    const goal = await prisma.goal.create({
      data: {
        employeeId: targetId,
        cycle,
        title,
        description: b.description != null ? String(b.description) : null,
        weight,
        progress: 0,
        status: "active",
      },
      include: { employee: { select: employeeSelect } },
    });
    await audit(req.auth, "performance.goal.create", "Goal", goal.id, `Set goal "${title}"`);
    res.status(201).json(goal);
  })
);

// PUT /goals/:id { progress?, status?, title?, description?, weight? }
router.put(
  "/goals/:id",
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const existing = await prisma.goal.findUnique({ where: { id } });
    if (!existing) throw notFound("Goal not found");
    // Owner, admin/hr, or the employee's own manager may update.
    await assertCanActOn(req, existing.employeeId);

    const b = (req.body ?? {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {};

    if (b.progress !== undefined) data.progress = clampInt(b.progress, "progress", 0, 100);
    if (b.weight !== undefined) data.weight = clampInt(b.weight, "weight", 0, 100);
    if (b.status !== undefined) {
      const status = String(b.status);
      if (!["active", "achieved", "missed"].includes(status)) throw badRequest("Invalid status");
      data.status = status;
    }
    if (b.title !== undefined) {
      const title = String(b.title).trim();
      if (!title) throw badRequest("title cannot be empty");
      data.title = title;
    }
    if (b.description !== undefined) data.description = b.description != null ? String(b.description) : null;

    const goal = await prisma.goal.update({
      where: { id },
      data,
      include: { employee: { select: employeeSelect } },
    });
    await audit(req.auth, "performance.goal.update", "Goal", id);
    res.json(goal);
  })
);

// ---- reviews --------------------------------------------------------------

// GET /reviews?scope=mine|team|all&employeeId= — PerformanceReview[] newest first.
router.get(
  "/reviews",
  ah(async (req: AuthRequest, res: Response) => {
    const scope = String(req.query.scope ?? "mine");
    const employeeIdQuery = req.query.employeeId;

    let where: { employeeId?: number | { in: number[] } } = {};

    if (employeeIdQuery != null) {
      const targetId = intParam(String(employeeIdQuery), "employeeId");
      if (!isManager(req) && req.auth?.employeeId !== targetId) throw forbidden();
      where = { employeeId: targetId };
    } else if (scope === "all") {
      if (!isManager(req)) throw forbidden();
      where = {};
    } else if (scope === "team") {
      const me = req.auth?.employeeId;
      if (me == null) return res.json([]);
      where = { employeeId: { in: await managedEmployeeIds(me) } };
    } else {
      // scope=mine (default)
      const me = req.auth?.employeeId;
      if (me == null) return res.json([]);
      where = { employeeId: me };
    }

    const reviews = await prisma.performanceReview.findMany({
      where,
      include: { employee: { select: employeeSelect } },
      orderBy: { createdAt: "desc" },
    });
    res.json(reviews);
  })
);

// POST /reviews { employeeId, cycle, stage } (requireManager)
router.post(
  "/reviews",
  requireManager,
  ah(async (req: AuthRequest, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (b.employeeId == null || b.employeeId === "") throw badRequest("employeeId is required");
    const employeeId = intParam(String(b.employeeId), "employeeId");
    const cycle = String(b.cycle ?? "").trim();
    if (!cycle) throw badRequest("cycle is required");
    const stage = String(b.stage ?? "confirmation");
    if (!["confirmation", "mid-year", "year-end"].includes(stage)) throw badRequest("Invalid stage");

    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw notFound("Employee not found");

    const review = await prisma.performanceReview.create({
      data: {
        employeeId,
        cycle,
        stage,
        status: "draft",
        reviewerId: req.auth?.employeeId ?? null,
      },
      include: { employee: { select: employeeSelect } },
    });
    await audit(
      req.auth,
      "performance.review.create",
      "PerformanceReview",
      review.id,
      `Opened ${stage} review for ${cycle}`
    );
    res.status(201).json(review);
  })
);

// PUT /reviews/:id { rating?, comments?, stage?, status? } (requireManager)
router.put(
  "/reviews/:id",
  requireManager,
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const existing = await prisma.performanceReview.findUnique({ where: { id } });
    if (!existing) throw notFound("Review not found");
    // requireManager only gates by role — still require the caller to
    // actually manage this employee (or be admin/hr) before allowing a write.
    await assertCanActOn(req, existing.employeeId);

    const b = (req.body ?? {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {};

    if (b.rating !== undefined) {
      data.rating = b.rating === null || b.rating === "" ? null : clampInt(b.rating, "rating", 1, 5);
    }
    if (b.comments !== undefined) data.comments = b.comments != null ? String(b.comments) : null;
    if (b.stage !== undefined) {
      const stage = String(b.stage);
      if (!["confirmation", "mid-year", "year-end"].includes(stage)) throw badRequest("Invalid stage");
      data.stage = stage;
    }
    if (b.status !== undefined) {
      const status = String(b.status);
      if (!["draft", "submitted", "finalised"].includes(status)) throw badRequest("Invalid status");
      data.status = status;
    }

    const review = await prisma.performanceReview.update({
      where: { id },
      data,
      include: { employee: { select: employeeSelect } },
    });
    await audit(req.auth, "performance.review.update", "PerformanceReview", id);
    res.json(review);
  })
);

// ---- ranking --------------------------------------------------------------

// GET /ranking?department= (requireManager)
// Per employee: average finalised rating, sorted desc.
router.get(
  "/ranking",
  requireManager,
  ah(async (req: AuthRequest, res: Response) => {
    const departmentName = req.query.department != null ? String(req.query.department).trim() : "";

    const employees = await prisma.employee.findMany({
      where: departmentName ? { department: { name: departmentName } } : {},
      select: employeeSelect,
    });
    const employeeIds = employees.map((e) => e.id);

    // Average of finalised ratings (rating not null) grouped by employee.
    const grouped = await prisma.performanceReview.groupBy({
      by: ["employeeId"],
      where: {
        status: "finalised",
        rating: { not: null },
        employeeId: { in: employeeIds },
      },
      _avg: { rating: true },
      _count: { rating: true },
    });
    const statsByEmployee = new Map(grouped.map((g) => [g.employeeId, g]));

    const ranking = employees
      .map((e) => {
        const stats = statsByEmployee.get(e.id);
        const avgRating = stats?._avg.rating ?? null;
        return {
          employeeId: e.id,
          name: `${e.firstName} ${e.lastName}`,
          department: e.department?.name ?? null,
          avgRating: avgRating != null ? Math.round(avgRating * 10) / 10 : null,
          reviewCount: stats?._count.rating ?? 0,
        };
      })
      .filter((r) => r.reviewCount > 0)
      .sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0));

    res.json(ranking);
  })
);

// ---- history --------------------------------------------------------------

// GET /history/:employeeId — { reviews, goals } (owner or requireManager).
router.get(
  "/history/:employeeId",
  ah(async (req: AuthRequest, res: Response) => {
    const employeeId = intParam(req.params.employeeId, "employeeId");
    if (!isManager(req) && req.auth?.employeeId !== employeeId) throw forbidden();

    const [reviews, goals] = await Promise.all([
      prisma.performanceReview.findMany({
        where: { employeeId },
        include: { employee: { select: employeeSelect } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.goal.findMany({
        where: { employeeId },
        include: { employee: { select: employeeSelect } },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    res.json({ reviews, goals });
  })
);

export default router;
