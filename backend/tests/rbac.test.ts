import { describe, it, expect, vi } from "vitest";
import type { Response } from "express";
import { requireRole } from "../src/middleware/rbac.js";
import type { AuthRequest } from "../src/middleware/auth.js";

function mockRes() {
  const res: Partial<Response> & { statusCode?: number; body?: any } = {};
  res.status = vi.fn().mockImplementation((c: number) => {
    res.statusCode = c;
    return res as Response;
  });
  res.json = vi.fn().mockImplementation((b: any) => {
    res.body = b;
    return res as Response;
  });
  return res as Response & { statusCode?: number; body?: any };
}

describe("RBAC middleware", () => {
  it("allows a permitted role through", () => {
    const guard = requireRole("admin", "hr");
    const req = { auth: { userId: 1, email: "hr@x", role: "hr", employeeId: 2, name: "HR" } } as AuthRequest;
    const res = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("403s a wrong role", () => {
    const guard = requireRole("admin", "hr");
    const req = { auth: { userId: 3, email: "e@x", role: "employee", employeeId: 4, name: "Emp" } } as AuthRequest;
    const res = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("401s when unauthenticated", () => {
    const guard = requireRole("admin");
    const req = {} as AuthRequest;
    const res = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
