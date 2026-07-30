-- Migration: add_working_time_config
--
-- DOCUMENTATION ARTIFACT ONLY. This project applies schema changes with
-- `prisma db push` (see the db:setup script), not `prisma migrate`. This file
-- records the additive ALTER TABLE statements moving the proration/OT
-- working-days and working-hours-per-month constants out of routes/payroll.ts
-- and into the admin-editable StatutoryConfig table (closing the
-- "WORKING_DAYS_PER_MONTH / WORKING_HOURS_PER_MONTH remain hardcoded route
-- constants" architecture-review nit). Both new columns carry the same
-- defaults the hardcoded constants used (22 days, 176 hours), so existing
-- seeded demo data and computed payslips are unaffected.
--

-- AlterTable
ALTER TABLE "StatutoryConfig" ADD COLUMN "workingDaysPerMonth" REAL NOT NULL DEFAULT 22;
ALTER TABLE "StatutoryConfig" ADD COLUMN "workingHoursPerMonth" REAL NOT NULL DEFAULT 176;
