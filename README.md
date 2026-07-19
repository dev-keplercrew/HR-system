# Meridian HR — HR Information System (HRIS)

A complete, working full-stack **HR Information System** for a Singapore-based
organisation (~350 headcount), covering all nine RFP line items as functional
modules plus the vendor-proposal narrative for the process/commercial items.

> 🤖 **Generated end-to-end by [Kepler Crew (AIDC)](https://keplercrew.com)** — an
> autonomous AI development crew. A single RFP prompt in, this reviewed, tested,
> deployed application out. No human wrote or edited the application code.

## Generation provenance (Apex deep run)

| | |
|---|---|
| **Cycle** | `apex_20260718_172231_c09d22` · phase plan `deep` (17 phases) |
| **Pipeline** | P0 Guard → L2 Understand → Preanalysis → P1 Plan → P2 Enhance → P3 Execute → P3.5 Intent → P4 Review → P5 Validate → P6 QA → P7 Final QA → Ship → Loss → Learn → Backward → Fulfill → Reflect |
| **Models** | Claude — opus (guard), sonnet (plan/build/review/QA), haiku (fulfil/learn) |
| **Build shape** | 25-step plan · parallel execution (11 sub-agent builders in P3) |
| **Verification** | `tsc --noEmit` clean (both tiers) · vitest **15/15 backend + 3/3 frontend** · production build ✓ · 3 security fix-loops in P6 |
| **Final loss** | **0.2052** (threshold 0.7) — dominated by the pre-ship security audit's findings ledger |
| **Wall time** | ≈ 3 h (single run, including an infra interruption + artifact-based resume) |
| **Output** | 30 Prisma models · 13 Express route modules · 24 React pages · seeded demo data |

**Live demo**: <https://meridian-hr-b599bc.happyhill-8a730adf.centralindia.azurecontainerapps.io>
— sign in with `admin@meridian.sg` / `password123` (also `hr@`, `manager@`,
`employee@meridian.sg`, same password).

> ℹ️ **Branding note.** This is a **product demonstration** prepared for a
> Singapore Red Cross presentation; the in-app branding is demo theming only.
> This project is **not affiliated with, endorsed by, or an official system of
> the Singapore Red Cross** or the Red Cross movement.

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

## 5. Testing

```bash
npm run test
```

- **Backend (Vitest):** CPF contribution correctness against hand-computed values,
  CPF wage-ceiling cap, age-banded rates, no-CPF for foreign work-pass holders,
  RBAC allow/deny/unauthenticated, leave-balance maths, and GIRO export format.
- **Frontend (Vitest + RTL):** Login renders, demo-account shortcuts, and protected-route
  redirect when unauthenticated.

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
