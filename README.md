# Meridian HR — HR Information System (HRIS)

A complete, working full-stack **HR Information System** for a Singapore-based
organisation (~350 headcount), covering all nine RFP line items as functional
modules plus the vendor-proposal narrative for the process/commercial items.

> ⚠️ **Statutory-calculation disclaimer.** The CPF / IRAS / GIRO functionality is
> implemented as a **demo simulation** using published CPF contribution rate
> tables (2025). It is **not** a CPF Board / IRAS certified payroll engine and the
> GIRO export is a representative CSV, **not** a bank-certified file. Do not use
> for actual statutory filing without proper certification.

---

## 1. Tech stack

| Layer | Choice |
|-------|--------|
| Backend | Node.js + TypeScript + Express |
| ORM / DB | Prisma ORM over SQLite (schema written Postgres-portable) |
| Auth | JWT (bearer) + bcrypt password hashing + role table (RBAC) |
| Frontend | React + Vite + TypeScript + TailwindCSS (responsive — serves both "Web & Mobile" ESS) |
| Tests | Vitest (backend units) + React Testing Library (frontend smoke) |

SQLite is used so the app runs and self-tests with **zero external infrastructure**.
The Prisma schema uses `String` for enumerated fields (documented in comments) so it
ports to PostgreSQL by swapping the datasource `provider` and converting those fields
to native enums.

---

## 2. Quick start

Prerequisites: Node.js ≥ 18 (developed on Node 20).

```bash
# from the repository root
npm install                 # installs backend + frontend workspaces

# one-time backend DB setup + demo seed
npm run db:setup            # prisma generate + db push (creates backend/prisma/dev.db)
npm run seed                # loads representative demo data across all 9 modules

# run backend (:4000) and frontend (:5173) together
npm run dev
```

Then open **http://localhost:5173** and sign in with a demo account.

### Demo accounts (password: `password123`)

| Role | Email | Sees |
|------|-------|------|
| Admin | `admin@meridian.sg` | Everything incl. Security & Governance |
| HR | `hr@meridian.sg` | All HR modules, payroll, reports |
| Manager | `manager@meridian.sg` | Team approvals, reviews, recruitment |
| Employee | `employee@meridian.sg` | Self-service (My Space), own records |

The Login screen also has one-click buttons for each demo role.

### Other scripts

```bash
npm run build       # type-check + production build of both projects
npm run test        # backend Vitest + frontend Vitest
npm run typecheck   # tsc --noEmit on both projects
```

Per-package scripts live in `backend/package.json` and `frontend/package.json`
(e.g. `npm run dev --workspace backend`).

---

## 3. Module coverage (RFP items 1–6)

| # | RFP module | Where |
|---|------------|-------|
| 1 | **Core HR** — Employee DB, Payroll (CPF/IRAS/GIRO), Leave, Claims & Benefits, ESS (Web & Mobile), Reporting & Analytics, Workflow Automation, Security & Governance | `employees`, `payroll`, `leave`, `claimsBenefits`, `reports`, `workflow`, `admin` routes + matching pages |
| 2 | **Performance Management** — confirmation check-in, goals, mid/year-end review, rating workflow, department ranking, history | `performance` route + Goals / Reviews / History pages |
| 3 | **Employee Lifecycle** — onboarding/offboarding workflows, auto multi-department task assignment, exit clearance, asset issuance/return | `lifecycle` route + Onboarding / Offboarding pages |
| 4 | **Recruitment** — requisition workflow, vacancy posting, candidate DB, interview scheduling/evaluation, offer management | `recruitment` route + Requisitions / Candidate Pipeline pages |
| 5 | **Learning / Training** — training records, certification tracking, mandatory renewal reminders, learning history | `learning` route + Learning page (wired into workflow alerts) |
| 6 | **Time & Attendance** — shift rostering, attendance clock-in/out, overtime calculation & approval | `attendance` route + Time & Attendance page |

**Architecture.** The backend is a set of Express route modules mounted centrally in
`backend/src/app.ts`, each backed by the shared Prisma client (`backend/src/prisma.ts`),
JWT auth (`middleware/auth.ts`) and RBAC (`middleware/rbac.ts`). Statutory logic lives in
dedicated services (`services/payrollCalc.ts`, `services/girExport.ts`,
`services/alerts.ts`, `services/leaveCalc.ts`) that are independently unit-tested. The
frontend is a single React SPA with a shared design system (`frontend/src/components/`),
a typed API client (`frontend/src/api/client.ts`), an auth context, and role-guarded
routes registered centrally in `frontend/src/App.tsx`. 24 pages in total.

**Workflow Automation.** `services/alerts.ts` scans employees and certifications for
upcoming **probation confirmations, contract expiries, work-pass expiries and
certification renewals** within a 45-day window and materialises in-app alerts routed to
the relevant role. (A real deployment would additionally fan these to email/SMS — see the
support model below.)

**Reporting & Analytics.** Standard reports (headcount, payroll summary, leave summary)
plus an ad-hoc **report builder** restricted to a whitelisted field set (no raw query
strings — injection-safe) with **Excel (.xlsx) export**.

**Security & Governance.** Role-based access control on every route (admin / hr / manager
/ employee), bcrypt-hashed credentials, and an audit log of mutations, surfaced in the
Admin console.

---

## 4. Vendor Proposal Response (RFP items 7, 8, 9)

The following are **process / commercial** requirements answered as narrative — they are
not application code. Figures are proposed industry-standard defaults for this engagement.

### Item 7 — Data Migration & HRIS Implementation

**Migration scope**
- **In scope:** current active + recently-separated employee master data (profiles,
  employment terms, departments/managers), current-year leave balances and transactions,
  claim types and open claims, payroll master data (salary, CPF/bank details, payroll
  group), certifications and asset register.
- **Historical-data limitation:** we recommend migrating **up to 2 years** of transactional
  history (payslips, leave, claims) and **current balances only** for older periods.
  Migrating unbounded historical payroll is high-risk (source-format drift, statutory-rate
  changes per year) and is quoted separately if required; older records are retained in the
  legacy system as read-only archive.

**Implementation timeline (indicative, ~350 headcount)**

| Phase | Duration | Activities |
|-------|----------|-----------|
| 1. Discovery & design | Weeks 1–3 | Requirements sign-off, data mapping, config workshops |
| 2. Configuration | Weeks 3–6 | Module setup, RBAC roles, payroll/leave/claim policies |
| 3. Data migration | Weeks 5–8 | Extract → transform → load, 2 validation cycles |
| 4. UAT | Weeks 8–10 | Customer acceptance testing, defect resolution |
| 5. **Parallel payroll run** | **2 full monthly cycles** | Run new + legacy payroll in parallel, reconcile to the cent |
| 6. Go-live & hypercare | Week 12+ | Cutover, 4 weeks of intensive post-go-live support |

**Recommended parallel payroll run period:** **two consecutive monthly payroll cycles**
reconciled against the incumbent system before the legacy payroll is retired. This is the
standard safeguard for CPF/IRAS-affecting changes.

**User training:** role-based train-the-trainer sessions (Admin/HR power users), plus
self-service quick-guides and recorded walkthroughs for line managers and employees.

**Post-go-live support:** 4 weeks of hypercare (daily check-ins, priority defect SLA),
transitioning into the standard support model below.

### Item 8 — Vendor Support & Service Levels

**Support model:** a named **dedicated account manager** plus a tiered support desk
(L1 triage → L2 application → L3 engineering), local business-hours coverage (SGT) with
an on-call path for payroll-critical incidents.

**Response & resolution SLA (payroll-related issues prioritised)**

| Severity | Example | Response | Target resolution / workaround |
|----------|---------|----------|-------------------------------|
| P1 — Critical | Payroll run blocked, CPF/GIRO file cannot be produced on a pay-run day | **1 hour** | 4 business hours |
| P2 — High | Incorrect CPF/leave/claim calculation affecting multiple staff | 4 business hours | 1 business day |
| P3 — Medium | Single-record error, non-blocking defect | 1 business day | 3 business days |
| P4 — Low | Cosmetic / enhancement request | 2 business days | Next scheduled release |

**Escalation process for payroll incidents**
1. **L1 Support Desk** logs and triages within the response SLA.
2. Unresolved P1/P2 escalate to **L2 Application Support** immediately.
3. If still unresolved within half the resolution target, the **Account Manager +
   Engineering Lead** are engaged and the customer is notified of an action plan.
4. P1 incidents trigger a **post-incident review** with root-cause analysis and preventive
   actions shared with the customer.

### Item 9 — Software Licence / Subscription

**Model:** annual (or monthly) **subscription per active employee**, tiered by headcount
band, inclusive of hosting, maintenance, statutory rate-table updates, and the standard
support SLA above. Optional modules (Performance, Lifecycle, Recruitment, Learning, Time &
Attendance) are priced as add-ons per the RFP's "Mandatory to Quote: No" line items;
Core HR + implementation + support are the mandatory quoted baseline. Data-migration and
training are one-time professional-services line items separate from the recurring
subscription.

---

## 4a. Singapore Payroll — 2026 Gap-List Completion

Follow-up delivery extending the existing payroll module against the client's
gap list. Everything below **builds on** the existing CPF/GIRO code (it does not
replace it) and every new statutory file carries the same
`⚠️ DEMO SIMULATION — NOT A CERTIFIED INTEGRATION` banner.

### Client-ask interpretation confirmations

- **"Below 50 20%"** → the published CPF employee rate of **20%** applies to the
  age band **≤ 55** (not 50). We **kept the correct ≤ 55 band at 20%/17%** and did
  **not** change it to 50. Instead the applied age band is now surfaced explicitly
  on every payslip and API response (`cpfAgeBandLabel`, e.g. `<=55`) so HR can see
  which band was used. See `backend/src/services/payrollCalc.ts` (`cpfAgeBandLabel`,
  `getCpfRates`).
- **"Irs"** → **IRAS** (income-tax returns). **"Jro"** → **GIRO** (bank credit
  files). **"Slip"** → itemised **payslip**. **"Reference timesoft app"** → we
  matched the **functional / statutory scope** of a mainstream SG payroll product
  (statutory completeness + file exports), not its visual design.

### The 8 delivered items

| # | Item | Implemented in |
|---|------|----------------|
| 1 | **Ordinary vs Additional Wage (OW/AW) split** — OW ceiling (7,400/mo) on OW only; AW ceiling = annual cap − YTD OW-subject-to-CPF, tracked per employee per year; OW/AW CPF returned separately | `services/payrollCalc.ts` (`calcCpfOwAw`, `buildPayslip`), `routes/payroll.ts` (`POST /runs` + `YtdCpfWage` accumulation in one transaction) |
| 2 | **Self-help funds + SDL + FWL** — CDAC/MBMF/SINDA/ECF (banded, opt-out via `Employee.ethnicGroup`); SDL 0.25% of first 4,500, min $2 / max $11.25, for **all** employees incl. foreign passes; FWL placeholder per pass type | `services/statutoryLevies.ts` + `SelfHelpFundRate` / `FwlRateConfig` / `StatutoryConfig` tables |
| 3 | **MOM-compliant itemised payslip** — every MOM-mandated line; downloadable **PDF** per payslip + **bulk ZIP** per run; ESS lets an employee download only their own (scope=mine) | `services/payslipPdf.ts`, `routes/payroll.ts` (`GET /payslips/:id/pdf`, `GET /runs/:id/payslips.zip`), `frontend/src/pages/Payslips.tsx` |
| 4 | **IRAS** — IR8A annual return, Appendix 8A + IR8S as optional attachments, IR21 (tax clearance for departing foreign staff, wired to Offboarding); AIS text/XML + human-readable CSV | `services/irasExport.ts`, `routes/payroll.ts` (`GET /iras/ir8a`, `GET /iras/ir8a/attachments`), `routes/lifecycle.ts` (`POST /offboarding/:id/ir21`) |
| 5 | **CPF e-Submission (CPF EZPay)** — monthly submission file with admin-configurable employer CSN; **validation gate** blocks generation and lists offending employees when NRIC/DOB/pass-type/nationality is missing | `services/cpfSubmission.ts`, `routes/payroll.ts` (`GET /runs/:id/cpf-submission`) |
| 6 | **Real bank GIRO formats + reconciliation** — pluggable adapter interface with **DBS IDEAL / OCBC Velocity / UOB fixed-width** adapters (generic kept as before); per-run bank selection; upload a bank statement CSV and match against payslip net pay (matched / unmatched / amount-mismatch) | `services/bankAdapters.ts`, `services/reconciliation.ts`, `routes/payroll.ts`, `frontend/src/pages/PayrollReconciliation.tsx` |
| 7 | **Payroll engine hardening** — pro-rated salary (working-day basis), unpaid-leave deduction (from the leave module), OT pay (1.5× hourly, capped at 72h/mo with a warning, sourced from time-attendance), backpay/ad-hoc lines, run lifecycle **draft → reviewed → approved → finalised** with exports blocked until approved, full audit trail, and non-destructive **rollback/void** | `services/payrollCalc.ts`, `routes/payroll.ts` |
| 8 | **Tests + proof** — golden-file tests for every generated format (CPF EZPay, IR8A AIS/CSV, each GIRO adapter); boundary tests (age 54/55/56/60/65/70, OW 7399/7400/7401, AW ceiling exhaustion, missing NRIC/DOB); real-HTTP authorization tests (role + IDOR); seed exercises every new path | `backend/tests/*.test.ts` (see §5) |

### Configuration-driven by design

Every statutory rate, ceiling, levy band, bank format and the employer CSN lives
in **admin-editable tables** (`StatutoryConfig`, `SelfHelpFundRate`,
`FwlRateConfig`, `BankFormatConfig`, `CpfRateBand`), seeded with representative
defaults and editable via **admin-only** endpoints (`/api/admin/statutory-config`,
`/self-help-fund-rates`, `/fwl-rates`, `/bank-formats`, `/cpf-rate-bands`). A
**2026 rate revision is a data change, not a code change** — including the CPF
age-banded employee/employer contribution percentages themselves (not just the
OW/AW ceilings): `payrollCalc.ts`'s `getCpfRates`/`calcCpf`/`calcCpfOwAw`/
`buildPayslip` all accept an optional `cpfRateBands` override, and
`routes/payroll.ts` reads the live `CpfRateBand` table and passes it in on every
run. The numeric constants in `payrollCalc.ts` (`CPF_OW_CEILING`,
`AW_CEILING_ANNUAL`, `DEFAULT_CPF_RATE_BANDS`) and `statutoryLevies.ts`
(`DEFAULT_SDL_CONFIG`) are documented **fallback defaults** only, used only when
the corresponding table is empty; the routes always pass the live config values.

### Intentional behaviour change (backward compatibility)

`POST /api/payroll/runs` now creates a run in **`draft`** status (previously it was
created already `finalised`). A run must be driven **draft → reviewed → approved →
finalised** before the GIRO/CPF/IRAS exports are available, per item 7's lifecycle.
The same approval gate also covers the bulk payslip ZIP and bank-statement
reconciliation endpoints (a bulk net-pay export or a reconciliation against
unreviewed figures shouldn't happen before a run is approved); the single
ESS payslip PDF download is unaffected — that route stays scoped to `own vs
HR` ownership regardless of run status, unrelated to the export gate. Voiding
an approved/finalised run via `/rollback` also reverses the YTD OW it credited,
so a rolled-back run doesn't permanently shrink the Additional Wage ceiling for
the rest of the calendar year. All existing response fields are preserved and
only new fields were added (`ordinaryWage`, `additionalWage`, `owSubjectToCpf`,
`owCpf`, `awCpf`, `cpfAgeBandLabel`, `sdlAmount`, `selfHelpFundDeductions`,
OT/leave/backpay fields); `buildGiroCsv`
remains exported unchanged as the `generic` bank adapter.

### What remains **simulated** vs **certified**

- **Not certified for filing.** The CPF EZPay, IRAS AIS (IR8A/8A/IR8S/IR21) and
  DBS/OCBC/UOB GIRO layouts are **representative DEMO SIMULATION field layouts**,
  documented per-file. No public certified spec was available; the layouts are
  clearly labelled and are **not** submission-ready to the CPF Board / IRAS / banks
  without real certification and bank testing.
- **NRIC is masked.** `Employee.nric` is stored **masked** (e.g. `S****123A`) by the
  existing privacy design, so the CPF/IRAS validation checks **presence** of the
  field only, not a real unmasked NRIC. This is a stated simulation limitation.
- **Rates are representative.** The seeded CPF bands, self-help fund bands, SDL and
  FWL rates are representative 2025-era values for demonstration; treat the admin
  config tables as the source of truth to update before any real use.
- **Appendix 8A / IR8S data sources are representative stand-ins, not real
  benefits-in-kind/excess-CPF tracking.** `GET /iras/ir8a/attachments` sources
  Appendix 8A benefit lines from the employee's **paid Claims** for the year
  (no separate benefits-in-kind data model exists in this demo) and IR8S excess
  CPF from **CPF paid on a since-voided run** (a genuinely real, already-tracked
  signal: CPF contributed then reversed at the YTD-wage level). Both are
  documented, reachable via the API and covered by tests — but neither is a
  certified IRAS benefits-in-kind or excess-CPF computation.

### DB migration

Schema changes are **additive only** (new nullable/defaulted columns + new tables)
and applied with `prisma db push` (this project's only-ever schema-apply method — it
has no prior migration history). A documentation-only DDL artifact is recorded at
`backend/prisma/migrations/20260729183615_sg_payroll_gaps/migration.sql`.

---

## 5. Testing

```bash
npm run test
```

- **Backend (Vitest) — 124 tests across 15 files.** Core CPF correctness, wage-ceiling
  cap, age-banded rates and no-CPF-for-foreign-passes; plus the 2026 gap-list:
  - **OW/AW split & age bands** (`payroll.test.ts`) — band edges 54/55/56/60/65/70,
    OW 7399/7400/7401, AW-ceiling exhaustion, proration, OT 72h cap, and a
    caller-supplied `owCeiling` above/below the 7400 default actually changing
    the computed CPF money (not just the reported subject-to-CPF figure).
  - **Statutory levies** (`statutoryLevies.test.ts`) — SDL floor/cap/mid-band, each
    self-help fund + opt-out.
  - **Golden-file format tests** — CPF EZPay (`cpfSubmission.test.ts`), IR8A AIS/CSV
    (`irasExport.test.ts`), each GIRO bank adapter (`bankAdapters.test.ts`),
    payslip PDF (`payslipPdf.test.ts`, incl. itemised-allowance-line rendering),
    reconciliation matcher (`reconciliation.test.ts`, incl. a quoted-comma CSV field).
    Includes pipe-delimiter injection guards on the IRAS AIS text and CPF EZPay
    formats, and a hand-written (non-circular) UOB fixed-width golden literal.
  - **Real-HTTP authorization tests** via a supertest harness against the live app +
    seeded DB (`helpers/httpTestHarness.ts`): run lifecycle + rollback + YTD
    accumulation, plus genuinely **concurrent** race tests proving (a) the
    DB-level `PayrollRun.dedupeKey` unique constraint (not just the app-level check)
    closes the duplicate-run TOCTOU window, and (b) a status-guarded transaction
    stops two simultaneous rollbacks of the same run from double-reversing YTD
    CPF wage (`payrollLifecycle.test.ts`); OT priced from the full basic salary
    even when proration also applies in the same period (`admin.test.ts`);
    CPF-submission validation gate, IRAS HR-only, **cross-employee payslip-PDF
    IDOR (403)**, reconciliation HR-only, and the IR8A optional Appendix 8A /
    IR8S attachments endpoint (`payrollExports.test.ts`); admin config
    admin-only (`admin.test.ts`). Every new HR-only endpoint asserts 403 for
    employee **and** manager.
- **Frontend (Vitest + RTL):** Login renders, demo-account shortcuts, and protected-route
  redirect when unauthenticated. Authoritative gate: `tsc` typecheck + production `vite build`.

---

## 6. Project layout

```
package.json                 # root workspace (dev/build/test/seed scripts)
backend/
  prisma/schema.prisma       # full data model (all 9 modules)
  prisma/seed.ts             # comprehensive demo seed
  src/prisma.ts              # shared Prisma client
  src/app.ts, index.ts       # Express app + central route mounts
  src/middleware/            # auth (JWT) + rbac
  src/services/              # payrollCalc, girExport, alerts, leaveCalc, audit
  src/routes/                # 13 route modules (auth + 12 domains)
  tests/                     # Vitest unit tests
frontend/
  src/components/            # design system (Layout, ui primitives, ProtectedRoute)
  src/context/AuthContext    # JWT/role context
  src/api/client.ts          # typed fetch wrapper
  src/lib/                   # formatters + useApi hook
  src/pages/                 # 24 pages
  src/App.tsx                # central route registry (role-guarded)
```
