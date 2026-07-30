// Payroll — HR/admin console for running CPF/IRAS/GIRO payroll (demo simulation).
import { useState } from "react";
import { api, download } from "../api/client";
import { useApi } from "../lib/useApi";
import {
  PageHeader,
  Section,
  StatCard,
  Button,
  Field,
  Input,
  Select,
  DataTable,
  StatusBadge,
  Badge,
  Async,
  Modal,
  type Column,
} from "../components/ui";
import { sgd, fmtDate } from "../lib/format";

interface PayrollRun {
  id: number;
  period: string;
  payrollGroup: string;
  status: string;
  runDate: string;
  totalGross: number;
  totalNet: number;
  totalCpf: number;
}

interface Payslip {
  id: number;
  basicPay: number;
  allowances: number;
  ordinaryWage: number;
  additionalWage: number;
  grossPay: number;
  owCpf: number;
  awCpf: number;
  cpfAgeBandLabel: string;
  sdlAmount: number;
  employeeCpf: number;
  employerCpf: number;
  netPay: number;
  employee?: { id: number; employeeNo: string; firstName: string; lastName: string };
}

interface RunDetail extends PayrollRun {
  payslips: Payslip[];
}

interface CpfSummary {
  totalEmployeeCpf: number;
  totalEmployerCpf: number;
  totalCpf: number;
  latestPeriod: string | null;
}

interface BankFormat {
  id: number;
  bankKey: string;
  label: string;
  isDefault: boolean;
}

const GROUPS = ["general", "executive", "management", "hourly"];

// Run lifecycle stages in order. `voided` is a terminal off-pipeline state and
// is rendered distinctly (see RunLifecycle) rather than as a pipeline step.
const LIFECYCLE: { key: string; label: string }[] = [
  { key: "draft", label: "Draft" },
  { key: "reviewed", label: "Reviewed" },
  { key: "approved", label: "Approved" },
  { key: "finalised", label: "Finalised" },
];

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function periodYear(period: string): string {
  return period.slice(0, 4);
}

export default function Payroll() {
  const runs = useApi<PayrollRun[]>(() => api.get("/payroll/runs"), []);
  const cpf = useApi<CpfSummary>(() => api.get("/payroll/cpf-summary"), []);
  const bankFormats = useApi<BankFormat[]>(() => api.get("/payroll/bank-formats"), []);

  const [period, setPeriod] = useState(currentPeriod());
  const [payrollGroup, setPayrollGroup] = useState("general");
  const [bankFormat, setBankFormat] = useState("");
  const [running, setRunning] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const detail = useApi<RunDetail | null>(
    () => (selectedId != null ? api.get(`/payroll/runs/${selectedId}`) : Promise.resolve(null)),
    [selectedId]
  );

  // Lifecycle transition state (shared across the detail action buttons).
  const [transitioning, setTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [rollbackFor, setRollbackFor] = useState<number | null>(null);
  const [rollbackReason, setRollbackReason] = useState("");

  // Resolve the selected bank format (falling back to the default) so the
  // create request always carries a bankKey once formats have loaded.
  function resolveBankKey(): string | undefined {
    const list = bankFormats.data ?? [];
    if (bankFormat) return bankFormat;
    const def = list.find((b) => b.isDefault) ?? list[0];
    return def?.bankKey;
  }

  async function runPayroll(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setRunning(true);
    try {
      const run = await api.post<RunDetail>("/payroll/runs", {
        period,
        payrollGroup,
        bankFormat: resolveBankKey(),
      });
      runs.reload();
      cpf.reload();
      setSelectedId(run.id);
    } catch (err: any) {
      setFormError(err?.message ?? "Failed to run payroll");
    } finally {
      setRunning(false);
    }
  }

  async function transition(id: number, action: string, body?: unknown) {
    setTransitionError(null);
    setTransitioning(true);
    try {
      await api.post(`/payroll/runs/${id}/${action}`, body ?? {});
      runs.reload();
      cpf.reload();
      detail.reload();
    } catch (err: any) {
      setTransitionError(err?.message ?? "Transition failed");
    } finally {
      setTransitioning(false);
    }
  }

  async function submitRollback() {
    if (rollbackFor == null) return;
    const reason = rollbackReason.trim();
    if (!reason) return;
    await transition(rollbackFor, "rollback", { reason });
    setRollbackFor(null);
    setRollbackReason("");
  }

  const runColumns: Column<PayrollRun>[] = [
    { key: "period", header: "Period", render: (r) => <span className="font-medium text-ink">{r.period}</span> },
    { key: "group", header: "Group", render: (r) => <span className="capitalize">{r.payrollGroup}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "gross", header: "Gross", className: "text-right", render: (r) => <span className="num">{sgd(r.totalGross)}</span> },
    { key: "net", header: "Net", className: "text-right", render: (r) => <span className="num font-semibold">{sgd(r.totalNet)}</span> },
    { key: "cpf", header: "Total CPF", className: "text-right", render: (r) => <span className="num">{sgd(r.totalCpf)}</span> },
    {
      key: "action",
      header: "",
      className: "text-right",
      render: (r) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedId(r.id);
          }}
        >
          View
        </Button>
      ),
    },
  ];

  const payslipColumns: Column<Payslip>[] = [
    {
      key: "emp",
      header: "Employee",
      render: (p) =>
        p.employee ? (
          <span>
            <span className="font-medium text-ink">
              {p.employee.firstName} {p.employee.lastName}
            </span>
            <span className="ml-2 text-xs text-ink-muted">{p.employee.employeeNo}</span>
          </span>
        ) : (
          "—"
        ),
    },
    { key: "ow", header: "Ordinary Wage", className: "text-right", render: (p) => <span className="num">{sgd(p.ordinaryWage)}</span> },
    { key: "aw", header: "Additional Wage", className: "text-right", render: (p) => <span className="num">{sgd(p.additionalWage)}</span> },
    {
      key: "band",
      header: "CPF Band",
      render: (p) => (p.cpfAgeBandLabel ? <Badge tone="neutral">{p.cpfAgeBandLabel}</Badge> : <span className="text-ink-muted">—</span>),
    },
    { key: "gross", header: "Gross", className: "text-right", render: (p) => <span className="num">{sgd(p.grossPay)}</span> },
    { key: "empCpf", header: "Employee CPF", className: "text-right", render: (p) => <span className="num">{sgd(p.employeeCpf)}</span> },
    { key: "erCpf", header: "Employer CPF", className: "text-right", render: (p) => <span className="num">{sgd(p.employerCpf)}</span> },
    { key: "net", header: "Net Pay", className: "text-right", render: (p) => <span className="num font-semibold">{sgd(p.netPay)}</span> },
  ];

  return (
    <div>
      <PageHeader title="Payroll" subtitle="Run monthly payroll and export CPF / IRAS / GIRO figures." />

      <div className="mb-4 rounded-lg border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-ink-soft">
        <span className="font-semibold text-ink">⚠ Demo simulation.</span> CPF/IRAS/GIRO figures are a demo
        simulation, not a certified statutory integration.
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Async state={runs}>
          {(list) => (
            <StatCard
              label="Latest Run Net"
              value={list[0] ? sgd(list[0].totalNet) : "—"}
              sub={list[0] ? `${list[0].period} · ${list[0].payrollGroup}` : "No runs yet"}
              tone="good"
            />
          )}
        </Async>
        <Async state={cpf}>
          {(c) => (
            <StatCard label="Total CPF (all runs)" value={sgd(c.totalCpf)} sub={c.latestPeriod ? `Latest ${c.latestPeriod}` : "—"} tone="teal" />
          )}
        </Async>
        <Async state={cpf}>
          {(c) => <StatCard label="Employee CPF" value={sgd(c.totalEmployeeCpf)} sub="Member contributions" tone="neutral" />}
        </Async>
        <Async state={cpf}>
          {(c) => <StatCard label="Employer CPF" value={sgd(c.totalEmployerCpf)} sub="Company contributions" tone="warn" />}
        </Async>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <Section title="Run Payroll">
            <form onSubmit={runPayroll} className="space-y-4">
              <Field label="Period" hint="Pay month in YYYY-MM format">
                <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2025-07" pattern="\d{4}-\d{2}" required />
              </Field>
              <Field label="Payroll Group">
                <Select value={payrollGroup} onChange={(e) => setPayrollGroup(e.target.value)}>
                  {GROUPS.map((g) => (
                    <option key={g} value={g} className="capitalize">
                      {g.charAt(0).toUpperCase() + g.slice(1)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Bank Format" hint="GIRO file layout for this run">
                <Async state={bankFormats}>
                  {(formats) => {
                    const def = formats.find((b) => b.isDefault) ?? formats[0];
                    return (
                      <Select value={bankFormat || def?.bankKey || ""} onChange={(e) => setBankFormat(e.target.value)}>
                        {formats.map((b) => (
                          <option key={b.id} value={b.bankKey}>
                            {b.label}
                            {b.isDefault ? " (default)" : ""}
                          </option>
                        ))}
                      </Select>
                    );
                  }}
                </Async>
              </Field>
              {formError && <p className="text-sm font-medium text-bad">{formError}</p>}
              <Button type="submit" disabled={running} className="w-full">
                {running ? "Running…" : "Run Payroll"}
              </Button>
            </form>
          </Section>
        </div>

        <div className="lg:col-span-2">
          <Section title="Payroll Runs">
            <Async state={runs}>
              {(list) => (
                <DataTable
                  data={list}
                  rowKey={(r) => r.id}
                  empty="No payroll runs yet — run one to get started."
                  columns={runColumns}
                  onRowClick={(r) => setSelectedId(r.id)}
                />
              )}
            </Async>
          </Section>
        </div>
      </div>

      {selectedId != null && (
        <Async state={detail}>
          {(run) =>
            run ? (
              <Section
                title={`Payslips · ${run.period} · ${run.payrollGroup}`}
                actions={
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-ink-muted">
                      Run {fmtDate(run.runDate)} · Net <span className="num">{sgd(run.totalNet)}</span>
                    </span>
                    {(run.status === "approved" || run.status === "finalised") && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => download(`/payroll/runs/${run.id}/giro`, `giro-${run.period}.csv`)}
                        >
                          Download GIRO
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => download(`/payroll/runs/${run.id}/cpf-submission`, `cpf-ezpay-${run.period}.txt`)}
                        >
                          CPF e-Submission
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            download(`/payroll/iras/ir8a?year=${periodYear(run.period)}`, `ir8a-${periodYear(run.period)}.csv`)
                          }
                        >
                          IRAS IR8A
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => download(`/payroll/runs/${run.id}/payslips.zip`, `payslips-${run.period}.zip`)}
                        >
                          Download payslips (ZIP)
                        </Button>
                      </>
                    )}
                  </div>
                }
              >
                <RunLifecycle
                  run={run}
                  busy={transitioning}
                  error={transitionError}
                  onTransition={(action) => transition(run.id, action)}
                  onRollback={() => {
                    setTransitionError(null);
                    setRollbackReason("");
                    setRollbackFor(run.id);
                  }}
                />
                <DataTable data={run.payslips} rowKey={(p) => p.id} empty="No payslips in this run" columns={payslipColumns} />
              </Section>
            ) : (
              <></>
            )
          }
        </Async>
      )}

      <Modal
        open={rollbackFor != null}
        onClose={() => setRollbackFor(null)}
        title="Roll back payroll run"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRollbackFor(null)} disabled={transitioning}>
              Cancel
            </Button>
            <Button variant="danger" onClick={submitRollback} disabled={transitioning || !rollbackReason.trim()}>
              {transitioning ? "Rolling back…" : "Roll back"}
            </Button>
          </>
        }
      >
        <p className="mb-4 text-sm text-ink-soft">
          Rolling back voids this run and reverses its CPF/GIRO figures. Give a short reason for the audit trail.
        </p>
        <Field label="Reason">
          <Input
            value={rollbackReason}
            onChange={(e) => setRollbackReason(e.target.value)}
            placeholder="e.g. Wrong pay period selected"
            autoFocus
          />
        </Field>
        {transitionError && <p className="mt-3 text-sm font-medium text-bad">{transitionError}</p>}
      </Modal>
    </div>
  );
}

// ---- Run lifecycle stepper + transition actions ---------------------------

function RunLifecycle({
  run,
  busy,
  error,
  onTransition,
  onRollback,
}: {
  run: PayrollRun;
  busy: boolean;
  error: string | null;
  onTransition: (action: string) => void;
  onRollback: () => void;
}) {
  const voided = run.status === "voided";
  const currentIdx = LIFECYCLE.findIndex((s) => s.key === run.status);

  // Next-step action available from the current status.
  const nextAction: { action: string; label: string } | null =
    run.status === "draft"
      ? { action: "review", label: "Submit for review" }
      : run.status === "reviewed"
      ? { action: "approve", label: "Approve" }
      : run.status === "approved"
      ? { action: "finalise", label: "Finalise" }
      : null;

  const canRollback = run.status === "approved" || run.status === "finalised";

  return (
    <div className="mb-5">
      <div className="flex flex-col gap-4 rounded-xl border border-line bg-canvas/60 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        {voided ? (
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-bad/10 text-sm font-semibold text-bad ring-1 ring-bad/30">
              ✕
            </span>
            <div>
              <p className="text-sm font-semibold text-bad">Voided</p>
              <p className="text-xs text-ink-muted">This run was rolled back and its figures reversed.</p>
            </div>
          </div>
        ) : (
          <ol className="flex flex-1 items-center">
            {LIFECYCLE.map((stage, i) => {
              const done = i < currentIdx;
              const active = i === currentIdx;
              return (
                <li key={stage.key} className="flex flex-1 items-center last:flex-none">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ring-1 " +
                        (active
                          ? "bg-teal text-white ring-teal"
                          : done
                          ? "bg-teal-soft text-teal-dark ring-teal-soft"
                          : "bg-surface text-ink-muted ring-line")
                      }
                    >
                      {done ? "✓" : i + 1}
                    </span>
                    <span
                      className={
                        "text-xs font-medium " +
                        (active ? "text-ink" : done ? "text-teal-dark" : "text-ink-muted")
                      }
                    >
                      {stage.label}
                    </span>
                  </div>
                  {i < LIFECYCLE.length - 1 && (
                    <span className={"mx-3 h-px flex-1 " + (i < currentIdx ? "bg-teal" : "bg-line")} />
                  )}
                </li>
              );
            })}
          </ol>
        )}

        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={run.status} />
          {nextAction && (
            <Button size="sm" disabled={busy} onClick={() => onTransition(nextAction.action)}>
              {busy ? "Working…" : nextAction.label}
            </Button>
          )}
          {canRollback && (
            <Button variant="danger" size="sm" disabled={busy} onClick={onRollback}>
              Roll back
            </Button>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-sm font-medium text-bad">{error}</p>}
    </div>
  );
}
