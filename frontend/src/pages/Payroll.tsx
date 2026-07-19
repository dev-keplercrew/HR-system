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
  Async,
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
  grossPay: number;
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

const GROUPS = ["general", "executive", "management", "hourly"];

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function Payroll() {
  const runs = useApi<PayrollRun[]>(() => api.get("/payroll/runs"), []);
  const cpf = useApi<CpfSummary>(() => api.get("/payroll/cpf-summary"), []);

  const [period, setPeriod] = useState(currentPeriod());
  const [payrollGroup, setPayrollGroup] = useState("general");
  const [running, setRunning] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const detail = useApi<RunDetail | null>(
    () => (selectedId != null ? api.get(`/payroll/runs/${selectedId}`) : Promise.resolve(null)),
    [selectedId]
  );

  async function runPayroll(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setRunning(true);
    try {
      const run = await api.post<RunDetail>("/payroll/runs", { period, payrollGroup });
      runs.reload();
      cpf.reload();
      setSelectedId(run.id);
    } catch (err: any) {
      setFormError(err?.message ?? "Failed to run payroll");
    } finally {
      setRunning(false);
    }
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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => download(`/payroll/runs/${run.id}/giro`, `giro-${run.period}.csv`)}
                    >
                      Download GIRO
                    </Button>
                  </div>
                }
              >
                <DataTable data={run.payslips} rowKey={(p) => p.id} empty="No payslips in this run" columns={payslipColumns} />
              </Section>
            ) : (
              <></>
            )
          }
        </Async>
      )}
    </div>
  );
}
