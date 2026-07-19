// Dashboard — role-aware overview. Aggregates are computed client-side from the
// module list endpoints so the page degrades gracefully if any section fails.
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { useApi } from "../lib/useApi";
import { PageHeader, StatCard, Section, StatusBadge, DataTable, Async, Badge } from "../components/ui";
import { sgd, fmtDate } from "../lib/format";

export default function Dashboard() {
  const { user, hasRole } = useAuth();
  const isStaff = hasRole("admin", "hr", "manager");

  const employees = useApi<any[]>(() => api.get("/employees"), []);
  const leave = useApi<any[]>(() => api.get("/leave/requests?scope=all"), [isStaff]);
  const runs = useApi<any[]>(() => api.get("/payroll/runs"), []);
  const alerts = useApi<any[]>(() => (isStaff ? api.get("/workflow/alerts") : Promise.resolve([])), [isStaff]);

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user?.name?.split(" ")[0] ?? ""}`}
        subtitle="Here's what's happening across Meridian HR today."
      />

      {/* Stat row */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Async state={employees}>
          {(emps) => (
            <StatCard
              label="Headcount"
              value={emps.filter((e) => !["resigned", "terminated"].includes(e.status)).length}
              sub={`${emps.length} total records`}
              tone="teal"
            />
          )}
        </Async>
        <Async state={leave}>
          {(reqs) => (
            <StatCard
              label="Pending Leave"
              value={reqs.filter((r) => r.status === "pending").length}
              sub="Awaiting approval"
              tone="warn"
            />
          )}
        </Async>
        <Async state={runs}>
          {(list) => (
            <StatCard
              label="Latest Payroll"
              value={list[0] ? sgd(list[0].totalNet) : "—"}
              sub={list[0] ? `${list[0].period} · ${list[0].payrollGroup}` : "No runs yet"}
              tone="good"
            />
          )}
        </Async>
        {isStaff ? (
          <Async state={alerts}>
            {(list) => (
              <StatCard
                label="Open Alerts"
                value={list.filter((a) => !a.read).length}
                sub="Probation · contracts · passes"
                tone="bad"
              />
            )}
          </Async>
        ) : (
          <StatCard label="My Space" value="Open" sub="View your ESS portal" tone="neutral" />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Pending leave */}
        <div className="lg:col-span-2">
          <Section
            title="Recent Leave Requests"
            actions={
              <Link to="/leave/approve" className="text-xs font-medium text-teal-dark hover:underline">
                View all →
              </Link>
            }
          >
            <Async state={leave}>
              {(reqs) => (
                <DataTable
                  data={reqs.slice(0, 6)}
                  rowKey={(r) => r.id}
                  empty="No leave requests"
                  columns={[
                    { key: "emp", header: "Employee", render: (r) => r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : "—" },
                    { key: "type", header: "Type", render: (r) => r.leaveType?.name ?? "—" },
                    { key: "dates", header: "Dates", render: (r) => `${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}` },
                    { key: "days", header: "Days", render: (r) => <span className="num">{r.days}</span> },
                    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
                  ]}
                />
              )}
            </Async>
          </Section>
        </div>

        {/* Alerts / quick links */}
        <div className="space-y-6">
          {isStaff && (
            <Section title="Workflow Alerts">
              <Async state={alerts}>
                {(list) =>
                  list.length ? (
                    <ul className="space-y-3">
                      {list.slice(0, 5).map((a) => (
                        <li key={a.id} className="flex items-start gap-3">
                          <Badge tone={a.severity === "critical" ? "bad" : a.severity === "warning" ? "warn" : "neutral"}>
                            {a.severity}
                          </Badge>
                          <div>
                            <p className="text-sm font-medium text-ink">{a.title}</p>
                            <p className="text-xs text-ink-muted">{a.message}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="py-4 text-center text-sm text-ink-muted">No open alerts 🎉</p>
                  )
                }
              </Async>
            </Section>
          )}
          <Section title="Quick Actions">
            <div className="grid grid-cols-2 gap-2">
              {[
                { to: "/leave/apply", label: "Apply Leave" },
                { to: "/claims", label: "Submit Claim" },
                { to: "/payslips", label: "Payslips" },
                { to: "/ess", label: "My Space" },
                ...(hasRole("admin", "hr") ? [{ to: "/payroll", label: "Run Payroll" }, { to: "/reports", label: "Reports" }] : []),
              ].map((q) => (
                <Link
                  key={q.to}
                  to={q.to}
                  className="rounded-lg border border-line bg-surface px-3 py-3 text-center text-sm font-medium text-ink-soft hover:border-teal hover:text-teal-dark"
                >
                  {q.label}
                </Link>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
