// Workflow-automation route module — the alert engine's HTTP surface.
//
// Exposes the frozen alerts engine (services/alerts.ts) to managers/HR/admin:
// regenerate the alert set, browse/filter alerts, mark them read, and view a
// roll-up summary consumed by the WorkflowAlerts dashboard.
import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../prisma.js";
import { authenticate, type AuthRequest } from "../middleware/auth.js";
import { requireManager } from "../middleware/rbac.js";
import { ah, intParam } from "../http.js";
import { audit } from "../services/audit.js";
import { regenerateAlerts } from "../services/alerts.js";

const router = Router();
router.use(authenticate);

const ALERT_TYPES = ["probation", "contract-expiry", "workpass-expiry", "cert-renewal"];
const ALERT_SEVERITIES = ["info", "warning", "critical"];

// POST /regenerate — recompute the whole Alert set from live employee/cert data.
router.post(
  "/regenerate",
  requireManager,
  ah(async (req: AuthRequest, res: Response) => {
    const generated = await regenerateAlerts();
    await audit(req.auth, "workflow.regenerate", "Alert", null, `Regenerated ${generated} alert(s)`);
    res.json({ generated });
  })
);

// GET /alerts?unread=&type=&severity= — filtered alert list, soonest-due first.
router.get(
  "/alerts",
  requireManager,
  ah(async (req: AuthRequest, res: Response) => {
    const where: {
      read?: boolean;
      type?: string;
      severity?: string;
    } = {};

    const unread = req.query.unread;
    if (unread === "true" || unread === "1") where.read = false;
    else if (unread === "false" || unread === "0") where.read = true;

    const type = req.query.type != null ? String(req.query.type) : "";
    if (type && ALERT_TYPES.includes(type)) where.type = type;

    const severity = req.query.severity != null ? String(req.query.severity) : "";
    if (severity && ALERT_SEVERITIES.includes(severity)) where.severity = severity;

    const alerts = await prisma.alert.findMany({
      where,
      include: {
        employee: { select: { firstName: true, lastName: true, employeeNo: true } },
      },
      orderBy: { dueDate: "asc" },
    });
    res.json(alerts);
  })
);

// GET /alerts/summary — counts for the dashboard stat row + breakdowns.
router.get(
  "/alerts/summary",
  requireManager,
  ah(async (_req, res) => {
    const [total, unread, byTypeRaw, bySeverityRaw] = await Promise.all([
      prisma.alert.count(),
      prisma.alert.count({ where: { read: false } }),
      prisma.alert.groupBy({ by: ["type"], _count: { _all: true } }),
      prisma.alert.groupBy({ by: ["severity"], _count: { _all: true } }),
    ]);

    res.json({
      total,
      unread,
      byType: byTypeRaw.map((r) => ({ type: r.type, count: r._count._all })),
      bySeverity: bySeverityRaw.map((r) => ({ severity: r.severity, count: r._count._all })),
    });
  })
);

// POST /alerts/:id/read — acknowledge a single alert.
router.post(
  "/alerts/:id/read",
  requireManager,
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const existing = await prisma.alert.findUnique({ where: { id } });
    if (!existing) throw Object.assign(new Error("Not found"), { status: 404 });

    const alert = await prisma.alert.update({
      where: { id },
      data: { read: true },
    });
    await audit(req.auth, "workflow.alert.read", "Alert", id, `Marked alert "${alert.title}" read`);
    res.json(alert);
  })
);

export default router;
