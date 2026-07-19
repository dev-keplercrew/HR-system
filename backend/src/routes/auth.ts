// Auth routes: login, current-user (me), and logout (client-side token drop).
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { prisma } from "../prisma.js";
import { signToken, authenticate, type AuthRequest, type Role } from "../middleware/auth.js";
import { audit } from "../services/audit.js";
import { ah } from "../http.js";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Throttle credential-guessing: 10 attempts per email+IP per 15 minutes.
// Keyed on email (not just IP) so one attacker can't exhaust a shared
// office/NAT IP's budget for every other user, and vice versa.
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : "";
    return `${req.ip}:${email}`;
  },
  message: { error: "Too many login attempts. Please try again later." },
});

function displayName(role: string, emp: { firstName: string; lastName: string } | null, email: string) {
  if (emp) return `${emp.firstName} ${emp.lastName}`;
  return email.split("@")[0];
}

router.post(
  "/login",
  loginRateLimit,
  ah(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Email and password are required" });
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { employee: true },
    });
    if (!user || !user.active) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role as Role,
      employeeId: user.employee?.id ?? null,
      name: displayName(user.role, user.employee, user.email),
    };
    const token = signToken(payload);
    await audit(payload, "login", "User", user.id);
    res.json({ token, user: { id: user.id, ...payload } });
  })
);

router.get(
  "/me",
  authenticate,
  ah(async (req: AuthRequest, res) => {
    const a = req.auth!;
    res.json({
      id: a.userId,
      userId: a.userId,
      email: a.email,
      role: a.role,
      employeeId: a.employeeId,
      name: a.name,
    });
  })
);

router.post("/logout", authenticate, (_req, res) => {
  // Stateless JWT — logout is handled client-side by dropping the token.
  res.json({ ok: true });
});

export default router;
