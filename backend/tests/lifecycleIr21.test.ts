// HTTP-level tests for the IR21 tax-clearance action (item 4), wired to the
// existing Offboarding flow at POST /api/lifecycle/offboarding/:employeeId/ir21.
// Per httpTestHarness.ts's mandate: this route is authorization-sensitive and
// must be proven via a REAL request through createApp(), not just the pure
// buildIr21() unit test in irasExport.test.ts.
import { describe, it, expect } from "vitest";
import { client, authHeader } from "./helpers/httpTestHarness.js";
import { prisma } from "../src/prisma.js";

describe("IR21 tax clearance (item 4, offboarding)", () => {
  it("generates an IR21 record for a departing foreign (EP/SP/WP) employee", async () => {
    const m006 = await prisma.employee.findUnique({ where: { employeeNo: "M006" } }); // EP
    const res = await client()
      .post(`/api/lifecycle/offboarding/${m006!.id}/ir21`)
      .set(authHeader("hr"))
      .send({ clearanceDate: "2026-08-01" });
    expect(res.status).toBe(201);
    expect(res.body.applicable).toBe(true);
    expect(res.body.employee.employeeNo).toBe("M006");
  });

  it("BLOCKS (400) a citizen — IR21 only applies to departing foreign pass holders", async () => {
    const m004 = await prisma.employee.findUnique({ where: { employeeNo: "M004" } }); // citizen
    const res = await client().post(`/api/lifecycle/offboarding/${m004!.id}/ir21`).set(authHeader("hr"));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("departing foreign employees");
  });

  it("is HR-only — employee and manager get 403", async () => {
    const m006 = await prisma.employee.findUnique({ where: { employeeNo: "M006" } });
    for (const role of ["employee", "manager"] as const) {
      const res = await client().post(`/api/lifecycle/offboarding/${m006!.id}/ir21`).set(authHeader(role, 4));
      expect(res.status).toBe(403);
    }
  });

  it("rejects an unauthenticated request → 401", async () => {
    const m006 = await prisma.employee.findUnique({ where: { employeeNo: "M006" } });
    const res = await client().post(`/api/lifecycle/offboarding/${m006!.id}/ir21`);
    expect(res.status).toBe(401);
  });

  it("404s for a non-existent employee", async () => {
    const res = await client().post(`/api/lifecycle/offboarding/999999/ir21`).set(authHeader("hr"));
    expect(res.status).toBe(404);
  });

  it("rejects an invalid clearanceDate with 400, not an uncaught 500", async () => {
    const m006 = await prisma.employee.findUnique({ where: { employeeNo: "M006" } });
    const res = await client()
      .post(`/api/lifecycle/offboarding/${m006!.id}/ir21`)
      .set(authHeader("hr"))
      .send({ clearanceDate: "not-a-date" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("not a valid date");
  });
});
