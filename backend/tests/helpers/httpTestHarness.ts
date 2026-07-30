// HTTP-level test harness — the shared authorization-testing foundation.
//
// WHY THIS EXISTS: the prior cycle's 0.2052 loss was a systemic authorization bug
// (role-only gates instead of role+ownership checks) that survived P3/P4 because
// the repo had ZERO real-HTTP-request test coverage — every existing test is a
// pure-function or mocked-middleware unit test. This harness lets every new
// authorization-sensitive test issue a REAL request through createApp() with a
// REAL Prisma-backed (seeded) DB and a REAL signed JWT.
//
// MANDATE: every authorization-sensitive test (lifecycle, payslip PDF/ZIP, IRAS,
// CPF submission, reconciliation, admin config) MUST use this harness — a real
// request through createApp() — NOT a re-mocked middleware or an extracted-pure-
// function test. A pure-function test proves the CALCULATION is right; only a
// real request proves the ROUTE HANDLER actually runs the role/ownership check
// before returning data, which is the exact gap class that caused the prior loss.
//
// Tests mint tokens directly via signToken() (tokenFor / authHeader) and NEVER
// call POST /login — so the login rate-limiter can never interfere between cases,
// and any role/employeeId combination (including a synthetic "rogue" identity) is
// one line away.
import request from "supertest";
import { createApp } from "../../src/app.js";
import { signToken, type AuthPayload, type Role } from "../../src/middleware/auth.js";

// A supertest agent bound to a fresh instance of the real Express app.
export function client() {
  return request(createApp());
}

// Build a valid AuthPayload for a role and mint a signed JWT for it. `employeeId`
// defaults to null (no linked employee); pass overrides to forge rogue identities.
export function tokenFor(role: Role, employeeId: number | null = null, overrides: Partial<AuthPayload> = {}): string {
  const payload: AuthPayload = {
    userId: overrides.userId ?? 9000,
    email: overrides.email ?? `${role}@test.local`,
    role,
    employeeId,
    name: overrides.name ?? `Test ${role}`,
    ...overrides,
  };
  return signToken(payload);
}

// Convenience: the Authorization header object for supertest's `.set(...)`.
export function authHeader(role: Role, employeeId: number | null = null, overrides: Partial<AuthPayload> = {}) {
  return { Authorization: `Bearer ${tokenFor(role, employeeId, overrides)}` };
}
