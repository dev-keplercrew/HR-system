// Employee Database routes — the core HR record and its sub-entities
// (employment history, documents, emergency contacts, qualifications).
// Mounted at /api/employees by app.ts. Every handler runs behind `authenticate`.
import { Router } from "express";
import { prisma } from "../prisma.js";
import { authenticate, type AuthRequest } from "../middleware/auth.js";
import { requireHR, requireAdmin } from "../middleware/rbac.js";
import { ah, intParam } from "../http.js";
import { audit } from "../services/audit.js";

const router = Router();
router.use(authenticate);

// ---- helpers --------------------------------------------------------------

function notFound(message = "Not found") {
  return Object.assign(new Error(message), { status: 404 });
}
function badRequest(message: string) {
  return Object.assign(new Error(message), { status: 400 });
}

// Coerce an incoming date string (or Date) to a Date, or null/undefined through.
function toDate(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(v as string);
  if (isNaN(d.getTime())) throw badRequest("Invalid date value");
  return d;
}

// Scalar Employee fields that clients may set on create/update. Relations are
// wired via *Id foreign keys; unknown keys are ignored.
const STRING_FIELDS = [
  "employeeNo", "firstName", "lastName", "email", "phone", "gender",
  "maritalStatus", "nationality", "nric", "address", "jobTitle",
  "employmentType", "payrollGroup", "status", "workPassType",
  "bankName", "bankAccount", "photoUrl",
] as const;
const DATE_FIELDS = [
  "dateOfBirth", "joinDate", "confirmationDate", "probationEndDate",
  "contractEndDate", "workPassExpiry",
] as const;

// Build a Prisma data object from a request body, keeping only known fields.
function employeeData(body: Record<string, any>, { partial }: { partial: boolean }) {
  const data: Record<string, any> = {};
  for (const k of STRING_FIELDS) {
    if (body[k] !== undefined) data[k] = body[k];
  }
  for (const k of DATE_FIELDS) {
    if (body[k] !== undefined) data[k] = toDate(body[k]);
  }
  if (body.basicSalary !== undefined && body.basicSalary !== null && body.basicSalary !== "") {
    const n = Number(body.basicSalary);
    if (isNaN(n) || n < 0) throw badRequest("basicSalary must be a non-negative number");
    data.basicSalary = n;
  }
  if (body.departmentId !== undefined) {
    data.departmentId =
      body.departmentId === null || body.departmentId === "" ? null : intParam(String(body.departmentId), "departmentId");
  }
  if (body.managerId !== undefined) {
    data.managerId =
      body.managerId === null || body.managerId === "" ? null : intParam(String(body.managerId), "managerId");
  }
  // On create, don't send an explicit `undefined` joinDate; let the DB default apply.
  if (partial === false && data.joinDate === undefined) delete data.joinDate;
  return data;
}

const fullInclude = {
  department: true,
  manager: true,
  employmentHistory: { orderBy: { startDate: "desc" as const } },
  documents: { orderBy: { uploadedAt: "desc" as const } },
  emergencyContacts: true,
  qualifications: { orderBy: { obtainedDate: "desc" as const } },
};

// Directory-safe projection for non-privileged callers — omits basicSalary,
// bankName, bankAccount, nric, address, dateOfBirth and other PII/payroll
// fields. Mirrors the `employeeSelect` pattern already used by admin.ts.
const directorySelect = {
  id: true,
  employeeNo: true,
  firstName: true,
  lastName: true,
  jobTitle: true,
  employmentType: true,
  status: true,
  photoUrl: true,
  departmentId: true,
  department: true,
} as const;

// ---- collection -----------------------------------------------------------

// GET / — employee directory. HR/admin get the full record (incl.
// salary/bank/NRIC) for everyone; a manager gets the full record only for
// their own direct reports, and the directory-safe projection for the rest
// of the company; every other role gets the directory-safe projection only.
router.get(
  "/",
  ah(async (req: AuthRequest, res) => {
    const role = req.auth?.role;
    if (role === "admin" || role === "hr") {
      const employees = await prisma.employee.findMany({
        include: { department: true },
        orderBy: { employeeNo: "asc" },
      });
      return res.json(employees);
    }
    if (role === "manager" && req.auth?.employeeId != null) {
      const [reports, everyone] = await Promise.all([
        prisma.employee.findMany({
          where: { managerId: req.auth.employeeId },
          include: { department: true },
          orderBy: { employeeNo: "asc" },
        }),
        prisma.employee.findMany({
          select: directorySelect,
          orderBy: { employeeNo: "asc" },
        }),
      ]);
      const reportIds = new Set(reports.map((r) => r.id));
      const merged = [...reports, ...everyone.filter((e) => !reportIds.has(e.id))];
      merged.sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));
      return res.json(merged);
    }
    const employees = await prisma.employee.findMany({
      select: directorySelect,
      orderBy: { employeeNo: "asc" },
    });
    res.json(employees);
  })
);

// GET /me — the caller's own employee record.
router.get(
  "/me",
  ah(async (req: AuthRequest, res) => {
    const empId = req.auth?.employeeId;
    if (empId == null) throw notFound("No employee record linked to this account");
    const employee = await prisma.employee.findUnique({
      where: { id: empId },
      include: { department: true, manager: true },
    });
    if (!employee) throw notFound("Employee not found");
    res.json(employee);
  })
);

// GET /meta/departments — department list for filters + selects.
router.get(
  "/meta/departments",
  ah(async (_req: AuthRequest, res) => {
    const departments = await prisma.department.findMany({ orderBy: { name: "asc" } });
    res.json(departments);
  })
);

// GET /:id — full employee profile. Employees may only read their own record;
// a manager may only read their own record or a direct report's.
router.get(
  "/:id",
  ah(async (req: AuthRequest, res) => {
    const id = intParam(req.params.id);
    const role = req.auth?.role;
    if (role === "employee" && req.auth?.employeeId !== id) {
      throw Object.assign(new Error("Insufficient permissions"), { status: 403 });
    }
    const employee = await prisma.employee.findUnique({
      where: { id },
      include: fullInclude,
    });
    if (!employee) throw notFound("Employee not found");
    if (role === "manager" && req.auth?.employeeId !== id && employee.managerId !== req.auth?.employeeId) {
      throw Object.assign(new Error("Insufficient permissions"), { status: 403 });
    }
    res.json(employee);
  })
);

// POST / — create employee (HR/admin).
router.post(
  "/",
  requireHR,
  ah(async (req: AuthRequest, res) => {
    const body = (req.body ?? {}) as Record<string, any>;
    for (const k of ["employeeNo", "firstName", "lastName", "email"] as const) {
      if (!body[k] || String(body[k]).trim() === "") throw badRequest(`${k} is required`);
    }
    const data = employeeData(body, { partial: false });
    const created = await prisma.employee.create({ data: data as any, include: { department: true } });
    await audit(req.auth, "create", "Employee", created.id);
    res.status(201).json(created);
  })
);

// PUT /:id — update employee (HR/admin).
router.put(
  "/:id",
  requireHR,
  ah(async (req: AuthRequest, res) => {
    const id = intParam(req.params.id);
    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing) throw notFound("Employee not found");
    const data = employeeData((req.body ?? {}) as Record<string, any>, { partial: true });
    const updated = await prisma.employee.update({
      where: { id },
      data: data as any,
      include: fullInclude,
    });
    await audit(req.auth, "update", "Employee", id);
    res.json(updated);
  })
);

// DELETE /:id — remove employee (admin only).
router.delete(
  "/:id",
  requireAdmin,
  ah(async (req: AuthRequest, res) => {
    const id = intParam(req.params.id);
    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing) throw notFound("Employee not found");
    await prisma.employee.delete({ where: { id } });
    await audit(req.auth, "delete", "Employee", id);
    res.status(204).end();
  })
);

// ---- helper: ensure an employee exists (used by sub-entity routes) --------
async function ensureEmployee(id: number) {
  const emp = await prisma.employee.findUnique({ where: { id } });
  if (!emp) throw notFound("Employee not found");
  return emp;
}

// ---- employment history ---------------------------------------------------

router.post(
  "/:id/history",
  requireHR,
  ah(async (req: AuthRequest, res) => {
    const employeeId = intParam(req.params.id);
    await ensureEmployee(employeeId);
    const b = (req.body ?? {}) as Record<string, any>;
    if (!b.title || String(b.title).trim() === "") throw badRequest("title is required");
    if (!b.startDate) throw badRequest("startDate is required");
    const row = await prisma.employmentHistory.create({
      data: {
        employeeId,
        title: b.title,
        department: b.department ?? null,
        startDate: toDate(b.startDate) as Date,
        endDate: (toDate(b.endDate) as Date | null) ?? null,
        note: b.note ?? null,
      },
    });
    await audit(req.auth, "create", "EmploymentHistory", row.id);
    res.status(201).json(row);
  })
);

router.delete(
  "/:id/history/:hid",
  requireHR,
  ah(async (req: AuthRequest, res) => {
    const employeeId = intParam(req.params.id);
    const hid = intParam(req.params.hid, "hid");
    const row = await prisma.employmentHistory.findUnique({ where: { id: hid } });
    if (!row || row.employeeId !== employeeId) throw notFound("History entry not found");
    await prisma.employmentHistory.delete({ where: { id: hid } });
    await audit(req.auth, "delete", "EmploymentHistory", hid);
    res.status(204).end();
  })
);

// ---- documents ------------------------------------------------------------

router.post(
  "/:id/documents",
  requireHR,
  ah(async (req: AuthRequest, res) => {
    const employeeId = intParam(req.params.id);
    const emp = await ensureEmployee(employeeId);
    const b = (req.body ?? {}) as Record<string, any>;
    if (!b.name || String(b.name).trim() === "") throw badRequest("name is required");
    const category = b.category ?? "general";
    const filePath = b.filePath && String(b.filePath).trim() !== ""
      ? b.filePath
      : `/documents/${emp.employeeNo}/${b.name}`;
    const row = await prisma.document.create({
      data: { employeeId, name: b.name, category, filePath },
    });
    await audit(req.auth, "create", "Document", row.id);
    res.status(201).json(row);
  })
);

router.delete(
  "/:id/documents/:did",
  requireHR,
  ah(async (req: AuthRequest, res) => {
    const employeeId = intParam(req.params.id);
    const did = intParam(req.params.did, "did");
    const row = await prisma.document.findUnique({ where: { id: did } });
    if (!row || row.employeeId !== employeeId) throw notFound("Document not found");
    await prisma.document.delete({ where: { id: did } });
    await audit(req.auth, "delete", "Document", did);
    res.status(204).end();
  })
);

// ---- emergency contacts ---------------------------------------------------

router.post(
  "/:id/contacts",
  requireHR,
  ah(async (req: AuthRequest, res) => {
    const employeeId = intParam(req.params.id);
    await ensureEmployee(employeeId);
    const b = (req.body ?? {}) as Record<string, any>;
    for (const k of ["name", "relationship", "phone"] as const) {
      if (!b[k] || String(b[k]).trim() === "") throw badRequest(`${k} is required`);
    }
    const row = await prisma.emergencyContact.create({
      data: {
        employeeId,
        name: b.name,
        relationship: b.relationship,
        phone: b.phone,
        email: b.email ?? null,
      },
    });
    await audit(req.auth, "create", "EmergencyContact", row.id);
    res.status(201).json(row);
  })
);

router.delete(
  "/:id/contacts/:cid",
  requireHR,
  ah(async (req: AuthRequest, res) => {
    const employeeId = intParam(req.params.id);
    const cid = intParam(req.params.cid, "cid");
    const row = await prisma.emergencyContact.findUnique({ where: { id: cid } });
    if (!row || row.employeeId !== employeeId) throw notFound("Contact not found");
    await prisma.emergencyContact.delete({ where: { id: cid } });
    await audit(req.auth, "delete", "EmergencyContact", cid);
    res.status(204).end();
  })
);

// ---- qualifications -------------------------------------------------------

router.post(
  "/:id/qualifications",
  requireHR,
  ah(async (req: AuthRequest, res) => {
    const employeeId = intParam(req.params.id);
    await ensureEmployee(employeeId);
    const b = (req.body ?? {}) as Record<string, any>;
    if (!b.title || String(b.title).trim() === "") throw badRequest("title is required");
    const row = await prisma.qualification.create({
      data: {
        employeeId,
        title: b.title,
        institution: b.institution ?? null,
        type: b.type ?? "qualification",
        obtainedDate: (toDate(b.obtainedDate) as Date | null) ?? null,
        expiryDate: (toDate(b.expiryDate) as Date | null) ?? null,
      },
    });
    await audit(req.auth, "create", "Qualification", row.id);
    res.status(201).json(row);
  })
);

router.delete(
  "/:id/qualifications/:qid",
  requireHR,
  ah(async (req: AuthRequest, res) => {
    const employeeId = intParam(req.params.id);
    const qid = intParam(req.params.qid, "qid");
    const row = await prisma.qualification.findUnique({ where: { id: qid } });
    if (!row || row.employeeId !== employeeId) throw notFound("Qualification not found");
    await prisma.qualification.delete({ where: { id: qid } });
    await audit(req.auth, "delete", "Qualification", qid);
    res.status(204).end();
  })
);

export default router;
