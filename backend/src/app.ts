// Express application wiring.
// Route modules are mounted centrally HERE (the single integration point per the
// seam contract). Each module exports a default Router and never mounts itself.
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";

import authRoutes from "./routes/auth.js";
import employeesRoutes from "./routes/employees.js";
import payrollRoutes from "./routes/payroll.js";
import leaveRoutes from "./routes/leave.js";
import claimsBenefitsRoutes from "./routes/claimsBenefits.js";
import reportsRoutes from "./routes/reports.js";
import workflowRoutes from "./routes/workflow.js";
import performanceRoutes from "./routes/performance.js";
import lifecycleRoutes from "./routes/lifecycle.js";
import recruitmentRoutes from "./routes/recruitment.js";
import learningRoutes from "./routes/learning.js";
import timeAttendanceRoutes from "./routes/timeAttendance.js";
import adminRoutes from "./routes/admin.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

  // --- Central route mounts (seam-contract single owner) ---
  app.use("/api/auth", authRoutes);
  app.use("/api/employees", employeesRoutes);
  app.use("/api/payroll", payrollRoutes);
  app.use("/api/leave", leaveRoutes);
  app.use("/api/claims", claimsBenefitsRoutes);
  app.use("/api/reports", reportsRoutes);
  app.use("/api/workflow", workflowRoutes);
  app.use("/api/performance", performanceRoutes);
  app.use("/api/lifecycle", lifecycleRoutes);
  app.use("/api/recruitment", recruitmentRoutes);
  app.use("/api/learning", learningRoutes);
  app.use("/api/attendance", timeAttendanceRoutes);
  app.use("/api/admin", adminRoutes);

  // 404 for unknown API routes
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  // Central error handler
  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || "Internal server error" });
  });

  return app;
}
