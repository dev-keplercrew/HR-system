-- Migration: sg_payroll_gaps (Singapore statutory payroll gap-list completion)
--
-- DOCUMENTATION ARTIFACT ONLY. This project applies schema changes with
-- `prisma db push` (see the db:setup script), not `prisma migrate`, and has no
-- prior migration history. This file records the additive CREATE TABLE / ALTER
-- TABLE ADD COLUMN statements corresponding to the schema.prisma diff so the
-- change is reviewable and Postgres-portable. It is NOT executed by migrate.
-- All changes are additive (new nullable columns / defaulted columns / new
-- tables), so existing seeded demo data is preserved. Regenerated via
-- `prisma migrate diff --from-schema-datamodel <main> --to-schema-datamodel
-- prisma/schema.prisma --script` after fix-loop 2 (CpfRateBand,
-- Payslip.owSubjectToCpf) and fix-loop 3 (PayrollRun.dedupeKey — a DB-level
-- unique constraint closing the TOCTOU race in the duplicate-run guard).
--

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN "ethnicGroup" TEXT;

-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN "approvedAt" DATETIME;
ALTER TABLE "PayrollRun" ADD COLUMN "bankFormat" TEXT;
ALTER TABLE "PayrollRun" ADD COLUMN "dedupeKey" TEXT;
ALTER TABLE "PayrollRun" ADD COLUMN "finalisedAt" DATETIME;
ALTER TABLE "PayrollRun" ADD COLUMN "reviewedAt" DATETIME;
ALTER TABLE "PayrollRun" ADD COLUMN "voidReason" TEXT;
ALTER TABLE "PayrollRun" ADD COLUMN "voidedAt" DATETIME;

-- CreateTable
CREATE TABLE "YtdCpfWage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employeeId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "totalOwSubjectToCpf" REAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "YtdCpfWage_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StatutoryConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cpfOwCeiling" REAL NOT NULL DEFAULT 7400,
    "awCeilingAnnual" REAL NOT NULL DEFAULT 102000,
    "sdlRate" REAL NOT NULL DEFAULT 0.0025,
    "sdlWageCap" REAL NOT NULL DEFAULT 4500,
    "sdlMinAmount" REAL NOT NULL DEFAULT 2,
    "sdlMaxAmount" REAL NOT NULL DEFAULT 11.25,
    "employerCsn" TEXT NOT NULL DEFAULT '123456789A-PTE-01',
    "defaultBankFormat" TEXT NOT NULL DEFAULT 'generic',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SelfHelpFundRate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ethnicGroup" TEXT NOT NULL,
    "wageLower" REAL NOT NULL DEFAULT 0,
    "wageUpper" REAL NOT NULL DEFAULT 0,
    "amount" REAL NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "FwlRateConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "workPassType" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'basic',
    "monthlyRate" REAL NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "CpfRateBand" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ageUpper" INTEGER,
    "employeeRate" REAL NOT NULL DEFAULT 0,
    "employerRate" REAL NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "BankFormatConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bankKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "BankStatement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "payrollRunId" INTEGER,
    "filename" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankStatement_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bankStatementId" INTEGER NOT NULL,
    "rawLine" TEXT NOT NULL,
    "amount" REAL NOT NULL DEFAULT 0,
    "reference" TEXT,
    "matchedEmployeeId" INTEGER,
    "matchedAmount" REAL,
    "status" TEXT NOT NULL DEFAULT 'unmatched',
    CONSTRAINT "BankStatementLine_bankStatementId_fkey" FOREIGN KEY ("bankStatementId") REFERENCES "BankStatement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PayslipAdjustment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "payslipId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayslipAdjustment_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Payslip" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "payrollRunId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "basicPay" REAL NOT NULL DEFAULT 0,
    "allowances" REAL NOT NULL DEFAULT 0,
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
INSERT INTO "new_Payslip" ("allowances", "basicPay", "createdAt", "employeeCpf", "employeeId", "employerCpf", "grossPay", "id", "netPay", "payrollRunId") SELECT "allowances", "basicPay", "createdAt", "employeeCpf", "employeeId", "employerCpf", "grossPay", "id", "netPay", "payrollRunId" FROM "Payslip";
DROP TABLE "Payslip";
ALTER TABLE "new_Payslip" RENAME TO "Payslip";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "YtdCpfWage_employeeId_year_key" ON "YtdCpfWage"("employeeId", "year");

-- CreateIndex
CREATE INDEX "SelfHelpFundRate_ethnicGroup_idx" ON "SelfHelpFundRate"("ethnicGroup");

-- CreateIndex
CREATE UNIQUE INDEX "FwlRateConfig_workPassType_tier_key" ON "FwlRateConfig"("workPassType", "tier");

-- CreateIndex
CREATE INDEX "CpfRateBand_sortOrder_idx" ON "CpfRateBand"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "BankFormatConfig_bankKey_key" ON "BankFormatConfig"("bankKey");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_dedupeKey_key" ON "PayrollRun"("dedupeKey");
