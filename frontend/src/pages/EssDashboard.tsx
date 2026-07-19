// My Space (Employee Self-Service) — the signed-in employee's own profile,
// leave balances, latest payslip and claims, composed from per-module endpoints.
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { useApi } from "../lib/useApi";
import { PageHeader, Section, StatCard, DataTable, Async, StatusBadge, EmptyState } from "../components/ui";
import { sgd, fmtDate, titleCase } from "../lib/format";

export default function EssDashboard() {
  const { user } = useAuth();
  const hasEmp = user?.employeeId != null;

  const me = useApi<any>(() => (hasEmp ? api.get("/employees/me") : Promise.resolve(null)), [hasEmp]);
  const balances = useApi<any[]>(() => api.get("/leave/balances?scope=mine"), []);
  const payslips = useApi<any[]>(() => api.get("/payroll/payslips?scope=mine"), []);
  const claims = useApi<any[]>(() => api.get("/claims?scope=mine"), []);

  if (!hasEmp) {
    return (
      <div>
        <PageHeader title="My Space" />
        <EmptyState title="No employee profile linked" message="This account is not linked to an employee record." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="My Space" subtitle="Your personal HR self-service portal." />

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <Async state={me}>
            {(emp) =>
              emp ? (
                <div className="card-pad">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-soft text-lg font-semibold text-teal-dark">
                      {emp.firstName?.[0]}
                      {emp.lastName?.[0]}
                    </div>
                    <div>
                      <p className="font-semibold text-ink">{emp.firstName} {emp.lastName}</p>
                      <p className="text-sm text-ink-muted">{emp.jobTitle}</p>
                    </div>
                  </div>
                  <dl className="space-y-2 text-sm">
                    <Row label="Employee No" value={emp.employeeNo} />
                    <Row label="Department" value={emp.department?.name ?? "—"} />
                    <Row label="Status" value={<StatusBadge status={emp.status} />} />
                    <Row label="Join Date" value={fmtDate(emp.joinDate)} />
                    <Row label="Employment" value={titleCase(emp.employmentType)} />
                  </dl>
                  <Link to={`/employees/${emp.id}`} className="btn-ghost btn-sm mt-4 w-full">
                    View full profile
                  </Link>
                </div>
              ) : (
                <EmptyState message="Profile unavailable" />
              )
            }
          </Async>
        </div>

        <div className="lg:col-span-2">
          <Section title="Leave Balances">
            <Async state={balances}>
              {(list) => (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {list.length ? (
                    list.map((b) => (
                      <StatCard
                        key={b.id}
                        label={b.leaveType?.name ?? "Leave"}
                        value={Math.max(0, (b.entitled ?? 0) - (b.taken ?? 0) - (b.pending ?? 0))}
                        sub={`${b.taken ?? 0} taken · ${b.entitled ?? 0} total`}
                        tone="teal"
                      />
                    ))
                  ) : (
                    <p className="col-span-full py-4 text-sm text-ink-muted">No leave balances configured.</p>
                  )}
                </div>
              )}
            </Async>
            <div className="mt-4">
              <Link to="/leave/apply" className="btn-primary btn-sm">Apply for leave</Link>
            </div>
          </Section>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Recent Payslips" actions={<Link to="/payslips" className="text-xs font-medium text-teal-dark hover:underline">All payslips →</Link>}>
          <Async state={payslips}>
            {(list) => (
              <DataTable
                data={list.slice(0, 4)}
                rowKey={(p) => p.id}
                empty="No payslips yet"
                columns={[
                  { key: "period", header: "Period", render: (p) => p.payrollRun?.period ?? "—" },
                  { key: "gross", header: "Gross", render: (p) => <span className="num">{sgd(p.grossPay)}</span> },
                  { key: "cpf", header: "CPF", render: (p) => <span className="num">{sgd(p.employeeCpf)}</span> },
                  { key: "net", header: "Net", render: (p) => <span className="num font-semibold">{sgd(p.netPay)}</span> },
                ]}
              />
            )}
          </Async>
        </Section>

        <Section title="My Claims" actions={<Link to="/claims" className="text-xs font-medium text-teal-dark hover:underline">Submit →</Link>}>
          <Async state={claims}>
            {(list) => (
              <DataTable
                data={list.slice(0, 4)}
                rowKey={(c) => c.id}
                empty="No claims submitted"
                columns={[
                  { key: "type", header: "Type", render: (c) => c.claimType?.name ?? "—" },
                  { key: "amount", header: "Amount", render: (c) => <span className="num">{sgd(c.amount)}</span> },
                  { key: "date", header: "Date", render: (c) => fmtDate(c.claimDate) },
                  { key: "status", header: "Status", render: (c) => <StatusBadge status={c.status} /> },
                ]}
              />
            )}
          </Async>
        </Section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}
