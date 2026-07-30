-- Migration: add_allowance_component_and_ot_config
--
-- DOCUMENTATION ARTIFACT ONLY. This project applies schema changes with
-- `prisma db push` (see the db:setup script), not `prisma migrate`. This file
-- records the additive CREATE TABLE / ALTER TABLE ADD COLUMN statements for:
-- itemised allowance components (closing the "allowances (itemised)"
-- MOM-requirement gap) and admin-configurable OT cap/multiplier (closing the
-- "OT hardcoded, no admin-config path" gap). All changes are additive (new
-- nullable/defaulted columns, one new table), so existing seeded demo data is
-- preserved.
--

-- AlterTable
ALTER TABLE "StatutoryConfig" ADD COLUMN "otCapHoursPerMonth" REAL NOT NULL DEFAULT 72;
ALTER TABLE "StatutoryConfig" ADD COLUMN "otMultiplier" REAL NOT NULL DEFAULT 1.5;

-- CreateTable
CREATE TABLE "AllowanceComponent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "label" TEXT NOT NULL,
    "percentageOfBasic" REAL NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);

-- RedefineTables (SQLite: add nullable column to Payslip)
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Payslip" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "payrollRunId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "basicPay" REAL NOT NULL DEFAULT 0,
    "allowances" REAL NOT NULL DEFAULT 0,
    "allowanceBreakdown" TEXT,
    "grossPay" REAL NOT NULL DEFAULT 0,
    "employeeCpf" REAL NOT NULL DEFAULT 0,
    "employerCpf" REAL NOT NULL DEFAULT 0,
    "netPay" REAL NOT NULL DEFAULT 0,
    "ordinaryWage" REAL NOT NULL DEFAULT 0,
    "additionalWage" REAL NOT NULL DEFAULT 0,
    "owSubjectToCpf" REAL NOT NULL DEFAULT 0,
    "owCpf" REAL NOT NULL DEFAULT 0,
    "awCpf" REAL NOT NULL DEFAULT 0,
    "cpfAgeBandLabel" TEXT,
    "sdlAmount" REAL NOT NULL DEFAULT 0,
    "fwlAmount" REAL NOT NULL DEFAULT 0,
    "selfHelpFundDeductions" TEXT,
    "otHours" REAL NOT NULL DEFAULT 0,
    "otPay" REAL NOT NULL DEFAULT 0,
    "unpaidLeaveDays" REAL NOT NULL DEFAULT 0,
    "unpaidLeaveDeduction" REAL NOT NULL DEFAULT 0,
    "backpayAmount" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payslip_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Payslip" ("id","payrollRunId","employeeId","basicPay","allowances","grossPay","employeeCpf","employerCpf","netPay","ordinaryWage","additionalWage","owSubjectToCpf","owCpf","awCpf","cpfAgeBandLabel","sdlAmount","fwlAmount","selfHelpFundDeductions","otHours","otPay","unpaidLeaveDays","unpaidLeaveDeduction","backpayAmount","createdAt")
SELECT "id","payrollRunId","employeeId","basicPay","allowances","grossPay","employeeCpf","employerCpf","netPay","ordinaryWage","additionalWage","owSubjectToCpf","owCpf","awCpf","cpfAgeBandLabel","sdlAmount","fwlAmount","selfHelpFundDeductions","otHours","otPay","unpaidLeaveDays","unpaidLeaveDeduction","backpayAmount","createdAt" FROM "Payslip";
DROP TABLE "Payslip";
ALTER TABLE "new_Payslip" RENAME TO "Payslip";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
