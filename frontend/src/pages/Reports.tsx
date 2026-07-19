// Reports & Analytics — read-only workforce, payroll and leave dashboards built
// from the /api/reports aggregation endpoints. Visuals use simple CSS bars
// (coloured div widths) so the page reads as real analytics, not a data dump.
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useApi } from "../lib/useApi";
import { useAuth } from "../context/AuthContext";
import {
  PageHeader,
  Section,
  StatCard,
  Badge,
  Button,
  DataTable,
  Async,
  EmptyState,
  type Column,
} from "../components/ui";
import { sgd, num, titleCase } from "../lib/format";

interface Headcount {
  total: number;
  active: number;
  byDepartment: { name: string; count: number }[];
  byStatus: { status: string; count: number }[];
  byType: { type: string; count: number }[];
}
interface PayrollSummary {
  latestPeriod: string | null;
  totalGross: number;
  totalNet: number;
  totalEmployeeCpf: number;
  totalEmployerCpf: number;
  byGroup: { payrollGroup: string; totalNet: number; count: number }[];
}
interface LeaveSummary {
  byType: { name: string; entitled: number; taken: number }[];
  pendingRequests: number;
}

const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "neutral" | "teal"> = {
  active: "good",
  probation: "warn",
  "on-leave": "warn",
  resigned: "bad",
  terminated: "bad",
};

// A single labelled bar. `pct` (0..100) drives the coloured fill width.
function Bar({
  label,
  value,
  pct,
  color = "bg-teal",
}: {
  label: string;
  value: React.ReactNode;
  pct: number;
  color?: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium text-ink-soft">{label}</span>
        <span className="num shrink-0 text-sm font-semibold text-ink">{value}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-canvas">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  );
}

export default function Reports() {
  const { hasRole } = useAuth();
  const isHR = hasRole("admin", "hr");

  const headcount = useApi<Headcount>(() => api.get("/reports/headcount"), []);
  const payroll = useApi<PayrollSummary>(() => api.get("/reports/payroll-summary"), []);
  const leave = useApi<LeaveSummary>(() => api.get("/reports/leave-summary"), []);

  return (
    <div>
      <PageHeader
        title="Reports & Analytics"
        subtitle="Workforce, payroll and leave insights across Meridian HR."
        actions={
          isHR ? (
            <Link to="/reports/builder">
              <Button size="sm">Report Builder →</Button>
            </Link>
          ) : undefined
        }
      />

      <div className="space-y-6">
        {/* ---- Headcount ---- */}
        <Section title="Headcount">
          <Async state={headcount}>
            {(hc) => {
              const maxDept = Math.max(1, ...hc.byDepartment.map((d) => d.count));
              return (
                <div className="grid gap-6 lg:grid-cols-3">
                  <div className="space-y-4 lg:col-span-1">
                    <StatCard
                      label="Active headcount"
                      value={num(hc.active)}
                      sub={`${num(hc.total)} total records`}
                      tone="teal"
                    />
                    <div className="card-pad">
                      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                        By status
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {hc.byStatus.length ? (
                          hc.byStatus.map((s) => (
                            <Badge key={s.status} tone={STATUS_TONE[s.status] ?? "neutral"}>
                              {titleCase(s.status)} · {num(s.count)}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-sm text-ink-muted">No data</span>
                        )}
                      </div>
                      {hc.byType.length > 0 && (
                        <>
                          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-ink-muted">
                            By employment type
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {hc.byType.map((t) => (
                              <Badge key={t.type} tone="neutral">
                                {titleCase(t.type)} · {num(t.count)}
                              </Badge>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="lg:col-span-2">
                    <p className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-muted">
                      By department
                    </p>
                    {hc.byDepartment.length ? (
                      <div className="space-y-3">
                        {hc.byDepartment.map((d) => (
                          <Bar
                            key={d.name}
                            label={d.name}
                            value={num(d.count)}
                            pct={(d.count / maxDept) * 100}
                            color="bg-teal"
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyState message="No departments to report" />
                    )}
                  </div>
                </div>
              );
            }}
          </Async>
        </Section>

        {/* ---- Payroll Summary ---- */}
        <Section
          title={
            payroll.data?.latestPeriod
              ? `Payroll Summary · ${payroll.data.latestPeriod}`
              : "Payroll Summary"
          }
        >
          <Async state={payroll}>
            {(ps) => {
              const groupColumns: Column<PayrollSummary["byGroup"][number]>[] = [
                { key: "payrollGroup", header: "Group", render: (r) => titleCase(r.payrollGroup) },
                {
                  key: "count",
                  header: "Employees",
                  className: "text-right",
                  render: (r) => <span className="num">{num(r.count)}</span>,
                },
                {
                  key: "totalNet",
                  header: "Total Net",
                  className: "text-right",
                  render: (r) => <span className="num font-semibold">{sgd(r.totalNet)}</span>,
                },
              ];
              return (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    <StatCard label="Total Gross" value={sgd(ps.totalGross)} tone="teal" />
                    <StatCard label="Total Net" value={sgd(ps.totalNet)} tone="good" />
                    <StatCard label="Employee CPF" value={sgd(ps.totalEmployeeCpf)} tone="warn" />
                    <StatCard label="Employer CPF" value={sgd(ps.totalEmployerCpf)} tone="neutral" />
                  </div>
                  <div>
                    <p className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-muted">
                      Net pay by payroll group
                    </p>
                    <DataTable
                      data={ps.byGroup}
                      rowKey={(r) => r.payrollGroup}
                      empty="No payroll runs yet"
                      columns={groupColumns}
                    />
                  </div>
                </div>
              );
            }}
          </Async>
        </Section>

        {/* ---- Leave Summary ---- */}
        <Section title="Leave Summary">
          <Async state={leave}>
            {(ls) => (
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="lg:col-span-1">
                  <StatCard
                    label="Pending requests"
                    value={num(ls.pendingRequests)}
                    sub="Awaiting approval"
                    tone="warn"
                  />
                </div>
                <div className="lg:col-span-2">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                      Utilisation by leave type
                    </p>
                    <div className="flex items-center gap-4 text-xs text-ink-muted">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-teal" /> Taken
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-canvas ring-1 ring-line" />{" "}
                        Entitled
                      </span>
                    </div>
                  </div>
                  {ls.byType.length ? (
                    <div className="space-y-4">
                      {ls.byType.map((t) => {
                        const pct = t.entitled > 0 ? (t.taken / t.entitled) * 100 : 0;
                        return (
                          <div key={t.name}>
                            <div className="mb-1 flex items-baseline justify-between gap-3">
                              <span className="truncate text-sm font-medium text-ink-soft">
                                {t.name}
                              </span>
                              <span className="num shrink-0 text-sm text-ink-muted">
                                {num(t.taken, 1)} / {num(t.entitled, 1)} days
                              </span>
                            </div>
                            <div className="h-2.5 w-full overflow-hidden rounded-full bg-canvas ring-1 ring-line">
                              <div
                                className="h-full rounded-full bg-teal transition-all"
                                style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyState message="No leave balances for the current year" />
                  )}
                </div>
              </div>
            )}
          </Async>
        </Section>
      </div>
    </div>
  );
}
