// Payslips — the signed-in employee's own payslips (any role), with a detailed
// payslip breakdown modal. CPF figures are a demo simulation.
import { useState } from "react";
import { api } from "../api/client";
import { useApi } from "../lib/useApi";
import {
  PageHeader,
  Section,
  DataTable,
  Async,
  Modal,
  Badge,
  EmptyState,
  type Column,
} from "../components/ui";
import { sgd, fmtDate } from "../lib/format";

interface Payslip {
  id: number;
  basicPay: number;
  allowances: number;
  grossPay: number;
  employeeCpf: number;
  employerCpf: number;
  netPay: number;
  createdAt: string;
  payrollRun?: { id: number; period: string; payrollGroup: string; status: string; runDate: string };
  employee?: { id: number; employeeNo: string; firstName: string; lastName: string };
}

export default function Payslips() {
  const payslips = useApi<Payslip[]>(() => api.get("/payroll/payslips?scope=mine"), []);
  const [selected, setSelected] = useState<Payslip | null>(null);

  const columns: Column<Payslip>[] = [
    { key: "period", header: "Period", render: (p) => <span className="font-medium text-ink">{p.payrollRun?.period ?? "—"}</span> },
    { key: "group", header: "Group", render: (p) => <span className="capitalize text-ink-soft">{p.payrollRun?.payrollGroup ?? "—"}</span> },
    { key: "gross", header: "Gross", className: "text-right", render: (p) => <span className="num">{sgd(p.grossPay)}</span> },
    { key: "cpf", header: "Employee CPF", className: "text-right", render: (p) => <span className="num">{sgd(p.employeeCpf)}</span> },
    { key: "net", header: "Net Pay", className: "text-right", render: (p) => <span className="num font-semibold">{sgd(p.netPay)}</span> },
  ];

  return (
    <div>
      <PageHeader title="My Payslips" subtitle="Your monthly pay statements and CPF breakdown." />

      <div className="mb-4 rounded-lg border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-ink-soft">
        <span className="font-semibold text-ink">⚠ Demo simulation.</span> CPF/IRAS/GIRO figures are a demo
        simulation, not a certified statutory integration.
      </div>

      <Section title="Pay Statements">
        <Async state={payslips}>
          {(list) =>
            list.length ? (
              <DataTable
                data={list}
                rowKey={(p) => p.id}
                empty="No payslips yet"
                columns={columns}
                onRowClick={(p) => setSelected(p)}
              />
            ) : (
              <EmptyState title="No payslips yet" message="Your payslips will appear here once payroll has been run." />
            )
          }
        </Async>
      </Section>

      <Modal open={selected != null} onClose={() => setSelected(null)} title="Payslip">
        {selected && <PayslipDetail p={selected} />}
      </Modal>
    </div>
  );
}

function PayslipDetail({ p }: { p: Payslip }) {
  const name = p.employee ? `${p.employee.firstName} ${p.employee.lastName}` : "—";
  return (
    <div>
      {/* Header block, styled like a real payslip masthead */}
      <div className="mb-5 flex items-start justify-between border-b border-line pb-4">
        <div>
          <p className="text-lg font-semibold text-ink">{name}</p>
          <p className="text-sm text-ink-muted">{p.employee?.employeeNo ?? "—"}</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-ink-muted">Pay Period</p>
          <p className="text-base font-semibold text-ink">{p.payrollRun?.period ?? "—"}</p>
          <p className="mt-1 text-xs text-ink-muted">{fmtDate(p.payrollRun?.runDate ?? p.createdAt)}</p>
        </div>
      </div>

      <dl className="space-y-1 text-sm">
        <Line label="Basic Pay" value={p.basicPay} />
        <Line label="Allowances" value={p.allowances} />
        <Line label="Gross Pay" value={p.grossPay} strong divider />
        <Line label="Employee CPF" value={-p.employeeCpf} negative />
        <Line label="Net Pay" value={p.netPay} strong divider highlight />
      </dl>

      <div className="mt-5 rounded-lg bg-canvas px-4 py-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-ink-muted">Employer CPF (paid by company)</span>
          <span className="num text-ink-soft">{sgd(p.employerCpf)}</span>
        </div>
      </div>

      <p className="mt-4 flex items-center gap-2 text-xs text-ink-muted">
        <Badge tone="warn">Demo</Badge>
        CPF/IRAS/GIRO figures are a demo simulation, not a certified statutory integration.
      </p>
    </div>
  );
}

function Line({
  label,
  value,
  strong,
  divider,
  highlight,
  negative,
}: {
  label: string;
  value: number;
  strong?: boolean;
  divider?: boolean;
  highlight?: boolean;
  negative?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-2 ${divider ? "border-t border-line" : ""} ${
        highlight ? "mt-1 rounded-lg bg-teal-soft px-3" : ""
      }`}
    >
      <dt className={strong ? "font-semibold text-ink" : "text-ink-soft"}>{label}</dt>
      <dd
        className={`num ${strong ? "font-semibold" : ""} ${
          highlight ? "text-teal-dark" : negative ? "text-ink-soft" : "text-ink"
        }`}
      >
        {sgd(value)}
      </dd>
    </div>
  );
}
