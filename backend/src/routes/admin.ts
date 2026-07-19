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
