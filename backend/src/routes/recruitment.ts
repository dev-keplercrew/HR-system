// Recruitment route module — the Recruitment vertical slice.
// Managers/HR raise manpower requisitions and drive them through an approval
// workflow (draft → approved → posted → closed); candidates are captured against
// a requisition and moved through a hiring pipeline (applied → screening →
// interview → offer → hired / rejected) with scheduled interviews and
// evaluations. Mounted at /api/recruitment by app.ts.
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
function notFound(message = "Not found") {
  return Object.assign(new Error(message), { status: 404 });
}

// Read a required, non-empty string field from a request body or throw a 400.
function reqString(body: Record<string, unknown>, name: string): string {
  const v = body[name];
  if (v == null || String(v).trim() === "") throw badRequest(`${name} is required`);
  return String(v).trim();
}

// Read an optional string field (returns null when absent/blank).
function optString(body: Record<string, unknown>, name: string): string | null {
  const v = body[name];
  if (v == null || String(v).trim() === "") return null;
  return String(v).trim();
}

// Coerce an incoming date-ish value to a valid Date or throw a 400.
function parseDate(v: unknown, name: string): Date {
  if (v == null || String(v) === "") throw badRequest(`${name} is required`);
  const d = new Date(v as string);
  if (isNaN(d.getTime())) throw badRequest(`Invalid ${name}`);
  return d;
}

const CANDIDATE_STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected"];
const INTERVIEW_STATUSES = ["scheduled", "completed", "cancelled"];

const candidateInclude = {
  requisition: true,
  interviews: { orderBy: { round: "asc" } },
} as const;

// ---- requisitions ---------------------------------------------------------

// GET /requisitions — all requisitions with a candidate count, newest first.
router.get(
  "/requisitions",
  ah(async (_req: AuthRequest, res: Response) => {
    const requisitions = await prisma.requisition.findMany({
      include: { _count: { select: { candidates: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(requisitions);
  })
);

// POST /requisitions — raise a new manpower requisition (manager/HR/admin).
router.post(
  "/requisitions",
  requireManager,
  ah(async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = reqString(body, "title");
    const department = reqString(body, "department");
    const headcountRaw = Number(body.headcount);
    if (!Number.isInteger(headcountRaw) || headcountRaw <= 0) {
      throw badRequest("headcount must be a positive integer");
    }
    const justification = optString(body, "justification");

    const created = await prisma.requisition.create({
      data: {
        title,
        department,
        headcount: headcountRaw,
        justification,
        status: "draft",
      },
    });

    await audit(req.auth, "recruitment.requisition.create", "Requisition", created.id, `${title} (${department})`);
    res.status(201).json(created);
  })
);

// Advance a requisition through a workflow transition, guarding valid states.
async function transitionRequisition(
  req: AuthRequest,
  res: Response,
  next: string,
  allowedFrom: string[],
  action: string,
  extra: Record<string, unknown> = {}
) {
  const id = intParam(req.params.id);
  const requisition = await prisma.requisition.findUnique({ where: { id } });
  if (!requisition) throw notFound("Requisition not found");
  if (!allowedFrom.includes(requisition.status)) {
    throw badRequest(`Cannot ${action} a requisition that is ${requisition.status}`);
  }
  const updated = await prisma.requisition.update({
    where: { id },
    data: { status: next, ...extra },
  });
  await audit(req.auth, `recruitment.requisition.${action}`, "Requisition", id);
  res.json(updated);
}

// POST /requisitions/:id/approve — approve a draft requisition (manager/HR/admin).
router.post(
  "/requisitions/:id/approve",
  requireManager,
  ah((req: AuthRequest, res: Response) =>
    transitionRequisition(req, res, "approved", ["draft"], "approve", {
      approverId: req.auth?.employeeId ?? null,
    })
  )
);

// POST /requisitions/:id/post — publish an approved requisition (manager/HR/admin).
router.post(
  "/requisitions/:id/post",
  requireManager,
  ah((req: AuthRequest, res: Response) =>
    transitionRequisition(req, res, "posted", ["approved"], "post")
  )
);

// POST /requisitions/:id/close — close a requisition at any live stage.
router.post(
  "/requisitions/:id/close",
  requireManager,
  ah((req: AuthRequest, res: Response) =>
    transitionRequisition(req, res, "closed", ["draft", "approved", "posted"], "close")
  )
);

// ---- candidates -----------------------------------------------------------

// GET /candidates?requisitionId=&stage= — candidates with requisition +
// interviews, newest first, optionally filtered by requisition and/or stage.
router.get(
  "/candidates",
  ah(async (req: AuthRequest, res: Response) => {
    const where: { requisitionId?: number; stage?: string } = {};
    if (req.query.requisitionId != null && String(req.query.requisitionId) !== "") {
      where.requisitionId = intParam(String(req.query.requisitionId), "requisitionId");
    }
    if (req.query.stage != null && String(req.query.stage) !== "") {
      where.stage = String(req.query.stage);
    }
    const candidates = await prisma.candidate.findMany({
      where,
      include: candidateInclude,
      orderBy: { createdAt: "desc" },
    });
    res.json(candidates);
  })
);

// POST /candidates — capture a new candidate (manager/HR/admin).
router.post(
  "/candidates",
  requireManager,
  ah(async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = reqString(body, "name");
    const email = reqString(body, "email");
    const phone = optString(body, "phone");
    const source = optString(body, "source");

    let requisitionId: number | null = null;
    if (body.requisitionId != null && String(body.requisitionId) !== "") {
      requisitionId = intParam(String(body.requisitionId), "requisitionId");
      const requisition = await prisma.requisition.findUnique({ where: { id: requisitionId } });
      if (!requisition) throw badRequest("Unknown requisition");
    }

    const created = await prisma.candidate.create({
      data: { requisitionId, name, email, phone, source, stage: "applied" },
      include: candidateInclude,
    });

    await audit(req.auth, "recruitment.candidate.create", "Candidate", created.id, name);
    res.status(201).json(created);
  })
);

// PUT /candidates/:id — move a candidate to a new pipeline stage (manager/HR/admin).
router.put(
  "/candidates/:id",
  requireManager,
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const stage = reqString(body, "stage");
    if (!CANDIDATE_STAGES.includes(stage)) throw badRequest("Invalid stage");

    const candidate = await prisma.candidate.findUnique({ where: { id } });
    if (!candidate) throw notFound("Candidate not found");

    const updated = await prisma.candidate.update({
      where: { id },
      data: { stage },
      include: candidateInclude,
    });

    await audit(req.auth, "recruitment.candidate.stage", "Candidate", id, `${candidate.stage} → ${stage}`);
    res.json(updated);
  })
);

// POST /candidates/:id/interviews — schedule an interview round (manager/HR/admin).
// Scheduling for an early-stage candidate advances them into the interview stage.
router.post(
  "/candidates/:id/interviews",
  requireManager,
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const candidate = await prisma.candidate.findUnique({ where: { id } });
    if (!candidate) throw notFound("Candidate not found");

    const body = (req.body ?? {}) as Record<string, unknown>;
    const roundRaw = body.round != null && String(body.round) !== "" ? Number(body.round) : 1;
    if (!Number.isInteger(roundRaw) || roundRaw <= 0) throw badRequest("round must be a positive integer");
    const scheduledAt = parseDate(body.scheduledAt, "scheduledAt");
    const interviewer = optString(body, "interviewer");

    const created = await prisma.interview.create({
      data: {
        candidateId: id,
        round: roundRaw,
        scheduledAt,
        interviewer,
        status: "scheduled",
      },
    });

    // Nudge an applied/screening candidate forward into the interview stage.
    if (candidate.stage === "applied" || candidate.stage === "screening") {
      await prisma.candidate.update({ where: { id }, data: { stage: "interview" } });
    }

    await audit(req.auth, "recruitment.interview.schedule", "Interview", created.id, `Round ${roundRaw}`);
    res.status(201).json(created);
  })
);

// PUT /interviews/:id — record an interview outcome / evaluation (manager/HR/admin).
router.put(
  "/interviews/:id",
  requireManager,
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const interview = await prisma.interview.findUnique({ where: { id } });
    if (!interview) throw notFound("Interview not found");

    const body = (req.body ?? {}) as Record<string, unknown>;
    const data: { score?: number | null; feedback?: string | null; status?: string } = {};

    if ("score" in body) {
      if (body.score == null || String(body.score) === "") {
        data.score = null;
      } else {
        const score = Number(body.score);
        if (!Number.isInteger(score) || score < 1 || score > 5) {
          throw badRequest("score must be an integer from 1 to 5");
        }
        data.score = score;
      }
    }
    if ("feedback" in body) data.feedback = optString(body, "feedback");
    if ("status" in body && body.status != null && String(body.status) !== "") {
      const status = String(body.status);
      if (!INTERVIEW_STATUSES.includes(status)) throw badRequest("Invalid status");
      data.status = status;
    }

    const updated = await prisma.interview.update({ where: { id }, data });

    await audit(req.auth, "recruitment.interview.update", "Interview", id);
    res.json(updated);
  })
);

// POST /candidates/:id/offer — extend an offer to a candidate (manager/HR/admin).
router.post(
  "/candidates/:id/offer",
  requireManager,
  ah(async (req: AuthRequest, res: Response) => {
    const id = intParam(req.params.id);
    const candidate = await prisma.candidate.findUnique({ where: { id } });
    if (!candidate) throw notFound("Candidate not found");

    const updated = await prisma.candidate.update({
      where: { id },
      data: { stage: "offer" },
      include: candidateInclude,
    });

    await audit(req.auth, "recruitment.candidate.offer", "Candidate", id, candidate.name);
    res.json(updated);
  })
);

export default router;
