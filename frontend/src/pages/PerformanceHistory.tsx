// History & Ranking — department performance ranking (staff only) and a
// per-employee history timeline of reviews and goals. Any role.
import { useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useApi } from "../lib/useApi";
import {
  PageHeader,
  Section,
  StatusBadge,
  Field,
  Select,
  DataTable,
  Async,
  EmptyState,
} from "../components/ui";
import { fmtDate, titleCase, num } from "../lib/format";

interface EmployeeLite {
  id: number;
  firstName: string;
  lastName: string;
  employeeNo: string;
  department?: { name: string } | null;
}

interface RankRow {
  employeeId: number;
  name: string;
  department: string | null;
  avgRating: number | null;
  reviewCount: number;
}

interface Review {
  id: number;
  cycle: string;
  stage: string;
  rating: number | null;
  comments: string | null;
  status: string;
  createdAt: string;
}

interface Goal {
  id: number;
  cycle: string;
  title: string;
  description: string | null;
  weight: number;
  progress: number;
  status: string;
}

interface History {
  reviews: Review[];
  goals: Goal[];
}

// Render a numeric rating (may be fractional) as filled/half stars.
function Stars({ rating }: { rating: number | null }) {
  if (rating == null) return <span className="text-ink-muted">—</span>;
  const full = Math.round(Math.max(0, Math.min(5, rating)));
  return (
    <span className="text-amber" title={`${rating} / 5`}>
      {"★".repeat(full)}
      <span className="text-line">{"★".repeat(5 - full)}</span>
    </span>
  );
}

export default function PerformanceHistory() {
  const { user, hasRole } = useAuth();
  const isStaff = hasRole("admin", "hr", "manager");

  return (
    <div>
      <PageHeader
        title="History & Ranking"
        subtitle="Department performance ranking and per-employee review history."
      />

      {isStaff && <RankingSection />}

      <HistoryViewer defaultEmployeeId={user?.employeeId ?? null} isStaff={isStaff} />
    </div>
  );
}

// ---- Department ranking (staff only) --------------------------------------

function RankingSection() {
  const departments = useApi<{ id: number; name: string }[]>(
    () => api.get("/employees/meta/departments"),
    []
  );
  const [department, setDepartment] = useState("");

  const ranking = useApi<RankRow[]>(
    () => api.get(`/performance/ranking${department ? `?department=${encodeURIComponent(department)}` : ""}`),
    [department]
  );

  return (
    <div className="mb-6">
      <Section
        title="Department Ranking"
        actions={
          <div className="w-56">
            <Async state={departments}>
              {(list) => (
                <Select value={department} onChange={(e) => setDepartment(e.target.value)}>
                  <option value="">All departments</option>
                  {list.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              )}
            </Async>
          </div>
        }
      >
        <Async state={ranking}>
          {(rows) =>
            rows.length ? (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="w-12">#</th>
                      <th>Employee</th>
                      <th>Department</th>
                      <th>Avg Rating</th>
                      <th className="text-right">Reviews</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.employeeId}>
                        <td className="w-12">
                          <span className={`num font-semibold ${i < 3 ? "text-teal-dark" : "text-ink-muted"}`}>
                            {i + 1}
                          </span>
                        </td>
                        <td>
                          <span className="font-medium text-ink">{r.name}</span>
                        </td>
                        <td>{r.department ?? "—"}</td>
                        <td>
                          <span className="flex items-center gap-2">
                            <Stars rating={r.avgRating} />
                            <span className="num text-xs text-ink-muted">
                              {r.avgRating != null ? num(r.avgRating, 1) : "—"}
                            </span>
                          </span>
                        </td>
                        <td className="text-right">
                          <span className="num">{r.reviewCount}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="No ranked employees"
                message="Ranking appears once reviews are finalised with a rating."
              />
            )
          }
        </Async>
      </Section>
    </div>
  );
}

// ---- Per-employee history viewer ------------------------------------------

function HistoryViewer({
  defaultEmployeeId,
  isStaff,
}: {
  defaultEmployeeId: number | null;
  isStaff: boolean;
}) {
  // Staff may pick any employee; a plain employee only ever sees their own.
  const employees = useApi<EmployeeLite[]>(
    () => (isStaff ? api.get("/employees") : Promise.resolve([])),
    [isStaff]
  );

  const [selectedId, setSelectedId] = useState<number | null>(defaultEmployeeId);

  const history = useApi<History | null>(
    () => (selectedId != null ? api.get(`/performance/history/${selectedId}`) : Promise.resolve(null)),
    [selectedId]
  );

  if (defaultEmployeeId == null && !isStaff) {
    return (
      <Section title="My History">
        <EmptyState
          title="No employee profile linked"
          message="This account is not linked to an employee record, so it has no history."
        />
      </Section>
    );
  }

  return (
    <Section
      title="Employee History"
      actions={
        isStaff ? (
          <div className="w-64">
            <Async state={employees}>
              {(list) => (
                <Select
                  value={selectedId != null ? String(selectedId) : ""}
                  onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Select an employee…</option>
                  {list.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.firstName} {emp.lastName} · {emp.employeeNo}
                    </option>
                  ))}
                </Select>
              )}
            </Async>
          </div>
        ) : undefined
      }
    >
      {selectedId == null ? (
        <EmptyState title="Pick an employee" message="Select an employee to view their review and goal history." />
      ) : (
        <Async state={history}>
          {(data) =>
            data ? (
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Review timeline */}
                <div>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Review Timeline
                  </h3>
                  {data.reviews.length ? (
                    <ol className="relative space-y-4 border-l border-line pl-5">
                      {data.reviews.map((r) => (
                        <li key={r.id} className="relative">
                          <span className="absolute -left-[1.45rem] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-teal" />
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-ink">
                              {titleCase(r.stage)} · <span className="num">{r.cycle}</span>
                            </p>
                            <StatusBadge status={r.status} />
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-sm">
                            <Stars rating={r.rating} />
                            <span className="text-xs text-ink-muted">{fmtDate(r.createdAt)}</span>
                          </div>
                          {r.comments && <p className="mt-1 text-sm text-ink-soft">{r.comments}</p>}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="py-4 text-sm text-ink-muted">No reviews on record.</p>
                  )}
                </div>

                {/* Goals */}
                <div>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">Goals</h3>
                  {data.goals.length ? (
                    <DataTable
                      data={data.goals}
                      rowKey={(g) => g.id}
                      empty="No goals on record"
                      columns={[
                        { key: "title", header: "Goal", render: (g) => <span className="font-medium text-ink">{g.title}</span> },
                        { key: "cycle", header: "Cycle", render: (g) => <span className="num">{g.cycle}</span> },
                        { key: "weight", header: "Weight", className: "text-right", render: (g) => <span className="num">{num(g.weight)}%</span> },
                        { key: "progress", header: "Progress", className: "text-right", render: (g) => <span className="num">{g.progress}%</span> },
                        { key: "status", header: "Status", render: (g) => <StatusBadge status={g.status} /> },
                      ]}
                    />
                  ) : (
                    <p className="py-4 text-sm text-ink-muted">No goals on record.</p>
                  )}
                </div>
              </div>
            ) : (
              <EmptyState message="No history available." />
            )
          }
        </Async>
      )}
    </Section>
  );
}
