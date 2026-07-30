// Smoke test proving the HTTP harness exercises a REAL request through the real
// Express app + real Prisma-backed dev DB — a genuine 200-vs-403 distinction, not
// a mock. If this passes, every downstream authorization test can rely on it.
import { describe, it, expect } from "vitest";
import { client, authHeader } from "./httpTestHarness.js";

describe("httpTestHarness (foundation)", () => {
  it("lets HR through GET /api/payroll/runs with a real request → 200", async () => {
    const res = await client().get("/api/payroll/runs").set(authHeader("hr", 2));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("blocks the employee role on the same endpoint → 403", async () => {
    const res = await client().get("/api/payroll/runs").set(authHeader("employee", 4));
    expect(res.status).toBe(403);
  });

  it("rejects an unauthenticated request → 401", async () => {
    const res = await client().get("/api/payroll/runs");
    expect(res.status).toBe(401);
  });
});
