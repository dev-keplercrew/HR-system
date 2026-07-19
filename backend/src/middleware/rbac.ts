// Role-based access control middleware.
// `requireRole('admin','hr')` returns a guard that 403s if req.auth.role is not allowed.
// Assumes `authenticate` ran earlier in the chain (so req.auth is populated).
import type { Response, NextFunction } from "express";
import type { AuthRequest, Role } from "./auth.js";

export function requireRole(...roles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: "Authentication required" });
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

// Convenience guards.
export const requireHR = requireRole("admin", "hr");
export const requireManager = requireRole("admin", "hr", "manager");
export const requireAdmin = requireRole("admin");

// Predicate form of requireManager, for handlers that branch on role instead
// of hard-403ing (e.g. returning a narrower projection to non-managers).
export function isManagerRole(req: AuthRequest): boolean {
  return req.auth?.role === "admin" || req.auth?.role === "hr" || req.auth?.role === "manager";
}
