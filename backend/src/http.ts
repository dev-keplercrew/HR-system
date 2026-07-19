// Small helpers shared by every route module.
import type { Request, Response, NextFunction, RequestHandler } from "express";

// Wrap an async handler so thrown errors reach the central error middleware.
export function ah(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

// Parse a route :id param to a positive integer or throw a 400-friendly error.
export function intParam(value: string, name = "id"): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    const err = new Error(`Invalid ${name}`) as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  return n;
}
