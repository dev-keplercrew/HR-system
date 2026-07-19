// JWT authentication middleware.
// Exposes `authenticate` (verifies the Bearer token, attaches req.auth) and the
// `AuthRequest` type + `signToken` helper used by the auth route.
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export type Role = "admin" | "hr" | "manager" | "employee";

export interface AuthPayload {
  userId: number;
  email: string;
  role: Role;
  employeeId: number | null;
  name: string;
}

export interface AuthRequest extends Request {
  auth?: AuthPayload;
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.tokenTtl });
}

// Verify the Authorization: Bearer <token> header and attach req.auth.
export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret) as AuthPayload;
    req.auth = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
