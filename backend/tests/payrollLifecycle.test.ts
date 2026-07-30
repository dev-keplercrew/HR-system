// HTTP-level tests for the payroll run lifecycle (item 7) and YTD OW accumulation
// (item 1), driven through the REAL Express app + seeded Prisma DB via the shared
// httpTestHarness. Self-cleaning so it is idempotent across repeated `npm test`.
import { describe, it, expect, beforeAll } from "vitest";
import { client, authHeader } from "./helpers/httpTestHarness.js";
import { prisma } from "../src/prisma.js";

const TEST_PERIODS = ["2098-01", "2098-02", "2099-01", "2099-02", "2099-03", "2099-04", "2099-05", "2099-06", "2099-07"];
const TEST_YEARS = [2098, 2099];

async function cleanup() {
  await prisma.payrollRun.deleteMany({ where: { period: { in: TEST_PERIODS } } });
  await prisma.ytdCpfWage.deleteMany({ where: { year: { in: TEST_YEARS } } });
}

let m009Id: number;
let hrUserId: number; // a REAL seeded user id so audit()'s AuditLog.userId FK is valid

beforeAll(async () => {
  await cleanup();
  const m009 = await prisma.employee.findUnique({ where: { employeeNo: "M009" } });
  m009Id = m009!.id;
  const hrUser = await prisma.user.findFirst({ where: { role: "hr" } });
  hrUserId = hrUser!.id;
});

describe("payroll run lifecycle (item 7)", () => {
  it("creates a run in DRAFT status (not finalised)", async () => {
    const res = await client().post("/api/payroll/runs").set(authHeader("hr")).send({ period: "2099-01", payrollGroup: "management" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    expect(res.body.payslips.length).toBeGreaterThan(0);
    // New OW/AW fields are present on persisted payslips (backward-compatible add).
    expect(res.body.payslips[0]).toHaveProperty("ordinaryWage");
    expect(res.body.payslips[0]).toHaveProperty("cpfAgeBandLabel");
  });

  it("blocks a non-HR role (employee AND manager) from every transition → 403", async () => {
    const run = await client().post("/api/payroll/runs").set(authHeader("hr")).send({ period: "2099-02", payrollGroup: "management" });
    const id = run.body.id;
    for (const role of ["employee", "manager"] as const) {
      for (const action of ["review", "approve", "finalise", "rollback"]) {
        const res = await client().post(`/api/payroll/runs/${id}/${action}`).set(authHeader(role, 4));
        expect(res.status, `${role} ${action}`).toBe(403);
      }
    }
  });

  it("enforces the draft→reviewed→approved→finalised order (no skipping)", async () => {
    const run = await client().post("/api/payroll/runs").set(authHeader("hr")).send({ period: "2099-03", payrollGroup: "management" });
    const id = run.body.id;
    // Cannot approve straight from draft.
    const skip = await client().post(`/api/payroll/runs/${id}/approve`).set(authHeader("hr"));
    expect(skip.status).toBe(400);

    const review = await client().post(`/api/payroll/runs/${id}/review`).set(authHeader("hr"));
    expect(review.status).toBe(200);
    expect(review.body.status).toBe("reviewed");

    // Export blocked until approved.
    const earlyGiro = await client().get(`/api/payroll/runs/${id}/giro`).set(authHeader("hr"));
    expect(earlyGiro.status).toBe(400);

    const approve = await client().post(`/api/payroll/runs/${id}/approve`).set(authHeader("hr"));
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe("approved");
    expect(approve.body.approvedAt).toBeTruthy();

    // Now the GIRO export is available.
    const giro = await client().get(`/api/payroll/runs/${id}/giro`).set(authHeader("hr"));
    expect(giro.status).toBe(200);
    expect(giro.text).toContain("H,GIRO");

    const finalise = await client().post(`/api/payroll/runs/${id}/finalise`).set(authHeader("hr"));
    expect(finalise.status).toBe(200);
    expect(finalise.body.status).toBe("finalised");
  });

  it("rolls back an approved run to VOIDED without deleting payslip history + audits it", async () => {
    const run = await client().post("/api/payroll/runs").set(authHeader("hr")).send({ period: "2099-04", payrollGroup: "management" });
    const id = run.body.id;
    const m009Payslip = run.body.payslips.find((p: any) => p.employeeId === m009Id);
    expect(m009Payslip.owSubjectToCpf).toBeGreaterThan(0);
    const ytdBeforeRollback = await prisma.ytdCpfWage.findUnique({ where: { employeeId_year: { employeeId: m009Id, year: 2099 } } });

    await client().post(`/api/payroll/runs/${id}/review`).set(authHeader("hr"));
    await client().post(`/api/payroll/runs/${id}/approve`).set(authHeader("hr"));

    const auditBefore = await prisma.auditLog.count({ where: { action: "payroll.run.rollback" } });
    const rb = await client()
      .post(`/api/payroll/runs/${id}/rollback`)
      .set(authHeader("hr", null, { userId: hrUserId }))
      .send({ reason: "duplicate run" });
    expect(rb.status).toBe(200);
    expect(rb.body.status).toBe("voided");
    expect(rb.body.voidReason).toBe("duplicate run");

    // Payslips preserved (not deleted).
    const detail = await client().get(`/api/payroll/runs/${id}`).set(authHeader("hr"));
    expect(detail.body.payslips.length).toBeGreaterThan(0);

    // Reversal (item 7): rollback must decrement YTD OW-subject-to-CPF by exactly
    // what this run credited, so voiding doesn't permanently shrink the AW ceiling
    // for the rest of the calendar year.
    const ytdAfterRollback = await prisma.ytdCpfWage.findUnique({ where: { employeeId_year: { employeeId: m009Id, year: 2099 } } });
    expect(ytdAfterRollback?.totalOwSubjectToCpf).toBe((ytdBeforeRollback?.totalOwSubjectToCpf ?? 0) - m009Payslip.owSubjectToCpf);

    // A voided run's payslips.zip / reconciliation exports stay blocked (item 7 gate).
    const zipAfterVoid = await client().get(`/api/payroll/runs/${id}/payslips.zip`).set(authHeader("hr"));
    expect(zipAfterVoid.status).toBe(400);

    const auditAfter = await prisma.auditLog.count({ where: { action: "payroll.run.rollback" } });
    expect(auditAfter).toBe(auditBefore + 1);

    // A voided run doesn't block recreating the same period+payrollGroup.
    const rerun = await client().post("/api/payroll/runs").set(authHeader("hr")).send({ period: "2099-04", payrollGroup: "management" });
    expect(rerun.status).toBe(201);
  });

  it("BLOCKS a duplicate run for the same period+payrollGroup while a non-voided run exists", async () => {
    const first = await client().post("/api/payroll/runs").set(authHeader("hr")).send({ period: "2099-05", payrollGroup: "management" });
    expect(first.status).toBe(201);

    const dup = await client().post("/api/payroll/runs").set(authHeader("hr")).send({ period: "2099-05", payrollGroup: "management" });
    expect(dup.status).toBe(400);
    expect(dup.body.error).toContain("already exists");

    // A different payrollGroup for the same period is unaffected. Uses "hourly"
    // (not "executive") so it doesn't shadow the seeded executive run that other
    // test files locate via `orderBy: { id: "desc" }`.
    const otherGroup = await client().post("/api/payroll/runs").set(authHeader("hr")).send({ period: "2099-05", payrollGroup: "hourly" });
    expect(otherGroup.status).toBe(201);
  });

  it("closes the TOCTOU race: two genuinely CONCURRENT requests for the same period+payrollGroup never both succeed", async () => {
    // Fire both requests together (no await between them) so their findFirst
    // duplicate-checks can interleave before either commits its create — the
    // exact race an application-level findFirst-then-create guard cannot close
    // on its own. The DB-level PayrollRun.dedupeKey unique constraint is what
    // must reject the loser here.
    const [a, b] = await Promise.all([
      client().post("/api/payroll/runs").set(authHeader("hr")).send({ period: "2099-06", payrollGroup: "management" }),
      client().post("/api/payroll/runs").set(authHeader("hr")).send({ period: "2099-06", payrollGroup: "management" }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 400]);

    // Exactly one PayrollRun exists for this period+group — no double-create,
    // and (by extension) no double-credited YtdCpfWage.
    const runs = await prisma.payrollRun.findMany({ where: { period: "2099-06", payrollGroup: "management" } });
    expect(runs).toHaveLength(1);
  });

  it("closes the rollback TOCTOU race: two genuinely CONCURRENT rollbacks of the same run never both apply the YTD reversal", async () => {
    const run = await client().post("/api/payroll/runs").set(authHeader("hr")).send({ period: "2099-07", payrollGroup: "management" });
    const id = run.body.id;
    const m009Payslip = run.body.payslips.find((p: any) => p.employeeId === m009Id);
    const ytdBefore = await prisma.ytdCpfWage.findUnique({ where: { employeeId_year: { employeeId: m009Id, year: 2099 } } });

    await client().post(`/api/payroll/runs/${id}/review`).set(authHeader("hr"));
    await client().post(`/api/payroll/runs/${id}/approve`).set(authHeader("hr"));

    // Fire both rollback requests together (no await between them): both read
    // status="approved" before either commits, exercising the same interleaving
    // window the app-level pre-check (`run.status !== 'approved'`) cannot close
    // on its own. The transaction's status-guarded updateMany must let only one
    // through to the YTD-reversal loop.
    const [a, b] = await Promise.all([
      client().post(`/api/payroll/runs/${id}/rollback`).set(authHeader("hr", null, { userId: hrUserId })).send({ reason: "race A" }),
      client().post(`/api/payroll/runs/${id}/rollback`).set(authHeader("hr", null, { userId: hrUserId })).send({ reason: "race B" }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    // YTD OW was decremented exactly ONCE, not twice.
    const ytdAfter = await prisma.ytdCpfWage.findUnique({ where: { employeeId_year: { employeeId: m009Id, year: 2099 } } });
    expect(ytdAfter?.totalOwSubjectToCpf).toBe((ytdBefore?.totalOwSubjectToCpf ?? 0) - m009Payslip.owSubjectToCpf);
  });
});

describe("YTD OW accumulation across runs (item 1)", () => {
  it("accumulates each employee's YTD OW-subject-to-CPF transactionally across two runs", async () => {
    // Two management runs in year 2098 for the same employees.
    const r1 = await client().post("/api/payroll/runs").set(authHeader("hr")).send({ period: "2098-01", payrollGroup: "management" });
    const r2 = await client().post("/api/payroll/runs").set(authHeader("hr")).send({ period: "2098-02", payrollGroup: "management" });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    // M009 basic 9500 → OW capped at the 7400 ceiling; two runs → 14800 YTD.
    const ytd = await prisma.ytdCpfWage.findUnique({ where: { employeeId_year: { employeeId: m009Id, year: 2098 } } });
    expect(ytd?.totalOwSubjectToCpf).toBe(14800);
  });
});
