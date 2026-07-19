// Offboarding & Exit Clearance — HR/manager console for exit-clearance
// checklists and reclaiming issued company assets. Route is guarded to
// manager/hr/admin in App.tsx.
import { useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useApi } from "../lib/useApi";
import {
  PageHeader,
  Section,
  StatCard,
  Badge,
  StatusBadge,
  Button,
  Field,
  Select,
  DataTable,
  Async,
  EmptyState,
  type Column,
} from "../components/ui";
import { fmtDate, titleCase } from "../lib/format";

interface EmployeeLite {
  id: number;
  firstName: string;
  lastName: string;
  employeeNo: string;
  status: string;
  jobTitle: string | null;
}

interface Task {
  id: number;
  employeeId: number;
  title: string;
  department: string;
  dueDate: string | null;
  status: string;
  createdAt: string;
  employee?: {
    id: number;
    firstName: string;
    lastName: string;
    employeeNo: string;
    jobTitle: string | null;
    department?: { name: string } | null;
  };
}

interface Asset {
  id: number;
  tag: string;
  name: string;
  category: string;
  status: string;
  employeeId: number | null;
  issuedDate: string | null;
  returnedDate: string | null;
  employee?: { id: number; firstName: string; lastName: string; employeeNo: string } | null;
}

const STATUS_OPTIONS = ["pending", "in-progress", "done"];

const DEPT_TONE: Record<string, "teal" | "good" | "warn" | "neutral" | "bad"> = {
  IT: "teal",
  HR: "good",
  "Hiring Manager": "warn",
  Facilities: "neutral",
};

export default function Offboarding() {
  const { hasRole } = useAuth();
  const isHR = hasRole("admin", "hr");

  const tasks = useApi<Task[]>(() => api.get("/lifecycle/offboarding"), []);
  const employees = useApi<EmployeeLite[]>(() => api.get("/lifecycle/employees-lite"), []);
  const assets = useApi<Asset[]>(() => api.get("/lifecycle/assets"), []);

  const [pickEmp, setPickEmp] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);

  async function startOffboarding() {
    if (!pickEmp) return;
    setStarting(true);
    setStartError(null);
    try {
      await api.post("/lifecycle/offboarding", { employeeId: Number(pickEmp) });
      setPickEmp("");
      tasks.reload();
    } catch (err: any) {
      setStartError(err?.message ?? "Failed to start exit clearance");
    } finally {
      setStarting(false);
    }
  }

  async function changeStatus(taskId: number, status: string) {
    setStatusError(null);
    try {
      await api.patch(`/lifecycle/offboarding/tasks/${taskId}`, { status });
      tasks.reload();
    } catch (err: any) {
      setStatusError(err?.message ?? "Failed to update task status");
    }
  }

  async function returnAsset(id: number) {
    setAssetError(null);
    try {
      await api.post(`/lifecycle/assets/${id}/return`);
      assets.reload();
    } catch (err: any) {
      setAssetError(err?.message ?? "Failed to return asset");
    }
  }

  const issuedColumns: Column<Asset>[] = [
    { key: "tag", header: "Tag", render: (a) => <span className="font-medium text-ink">{a.tag}</span> },
    { key: "name", header: "Name", render: (a) => a.name },
    { key: "category", header: "Category", render: (a) => <span className="capitalize">{titleCase(a.category)}</span> },
    {
      key: "holder",
      header: "Held By",
      render: (a) =>
        a.employee ? (
          <span>
            <span className="text-ink">
              {a.employee.firstName} {a.employee.lastName}
            </span>
            <span className="ml-2 text-xs text-ink-muted">{a.employee.employeeNo}</span>
          </span>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    { key: "issued", header: "Issued", render: (a) => fmtDate(a.issuedDate) },
    {
      key: "action",
      header: "",
      className: "text-right",
      render: (a) =>
        isHR ? (
          <Button variant="ghost" size="sm" onClick={() => returnAsset(a.id)}>
            Return
          </Button>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Offboarding & Exit Clearance"
        subtitle="Run exit-clearance checklists and reclaim company assets from leavers."
      />

      {/* Stat row */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Async state={tasks}>
          {(list) => {
            const groups = new Set(list.map((t) => t.employeeId));
            return <StatCard label="Active Clearances" value={groups.size} sub="Employees exiting" tone="teal" />;
          }}
        </Async>
        <Async state={tasks}>
          {(list) => {
            const open = list.filter((t) => t.status !== "done").length;
            return <StatCard label="Open Tasks" value={open} sub={`${list.length} total tasks`} tone="warn" />;
          }}
        </Async>
        <Async state={assets}>
          {(list) => (
            <StatCard
              label="Assets To Reclaim"
              value={list.filter((a) => a.status === "issued").length}
              sub="Still issued"
              tone="bad"
            />
          )}
        </Async>
        <Async state={assets}>
          {(list) => (
            <StatCard
              label="Assets Returned"
              value={list.filter((a) => a.status === "returned").length}
              sub="Reclaimed"
              tone="good"
            />
          )}
        </Async>
      </div>

      {/* Start exit clearance */}
      {isHR && (
        <Section title="Start Exit Clearance">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] flex-1">
              <Async state={employees}>
                {(list) => (
                  <Field label="Employee">
                    <Select value={pickEmp} onChange={(e) => setPickEmp(e.target.value)}>
                      <option value="">Select an employee…</option>
                      {list.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.firstName} {e.lastName} · {e.employeeNo}
                          {e.jobTitle ? ` · ${e.jobTitle}` : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </Async>
            </div>
            <Button onClick={startOffboarding} disabled={!pickEmp || starting}>
              {starting ? "Starting…" : "Start Exit Clearance"}
            </Button>
          </div>
          {startError && <p className="mt-2 text-sm font-medium text-bad">{startError}</p>}
          <p className="mt-2 text-xs text-ink-muted">
            Generates the standard exit checklist (asset return, access revocation, final payroll, exit interview,
            handover). Existing clearances are preserved.
          </p>
        </Section>
      )}

      {/* Clearance checklists grouped by employee */}
      <div className="mt-6">
        {statusError && <p className="mb-4 text-sm font-medium text-bad">{statusError}</p>}
        <Async state={tasks}>
          {(list) => {
            const byEmployee = groupByEmployee(list);
            if (byEmployee.length === 0) {
              return (
                <Section title="Exit Clearance Checklists">
                  <EmptyState
                    title="No exit clearance in progress"
                    message={isHR ? "Start an exit clearance above to generate a checklist." : "No clearances have been started yet."}
                  />
                </Section>
              );
            }
            return (
              <div className="grid gap-6 lg:grid-cols-2">
                {byEmployee.map((group) => (
                  <ChecklistCard key={group.employeeId} group={group} onStatus={changeStatus} />
                ))}
              </div>
            );
          }}
        </Async>
      </div>

      {/* Asset return view — assets still issued */}
      <div className="mt-6">
        <Section title="Asset Return">
          {assetError && <p className="mb-4 text-sm font-medium text-bad">{assetError}</p>}
          <Async state={assets}>
            {(list) => {
              const issued = list.filter((a) => a.status === "issued");
              return (
                <DataTable
                  data={issued}
                  rowKey={(a) => a.id}
                  empty="No outstanding assets to reclaim."
                  columns={issuedColumns}
                />
              );
            }}
          </Async>
        </Section>
      </div>
    </div>
  );
}

// ---- checklist card -------------------------------------------------------

interface Group {
  employeeId: number;
  employee?: Task["employee"];
  tasks: Task[];
}

function groupByEmployee(tasks: Task[]): Group[] {
  const map = new Map<number, Group>();
  for (const t of tasks) {
    let g = map.get(t.employeeId);
    if (!g) {
      g = { employeeId: t.employeeId, employee: t.employee, tasks: [] };
      map.set(t.employeeId, g);
    }
    g.tasks.push(t);
  }
  return [...map.values()];
}

function ChecklistCard({ group, onStatus }: { group: Group; onStatus: (id: number, status: string) => void }) {
  const done = group.tasks.filter((t) => t.status === "done").length;
  const total = group.tasks.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const emp = group.employee;
  const name = emp ? `${emp.firstName} ${emp.lastName}` : `Employee #${group.employeeId}`;

  return (
    <div className="card">
      <div className="border-b border-line px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-soft text-sm font-semibold text-teal-dark">
              {(emp?.firstName?.[0] ?? "") + (emp?.lastName?.[0] ?? "") || "?"}
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">{name}</p>
              <p className="text-xs text-ink-muted">
                {emp?.employeeNo ?? "—"}
                {emp?.jobTitle ? ` · ${emp.jobTitle}` : ""}
                {emp?.department?.name ? ` · ${emp.department.name}` : ""}
              </p>
            </div>
          </div>
          <Badge tone={pct === 100 ? "good" : "warn"}>
            {done}/{total} done
          </Badge>
        </div>
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-line">
            <div
              className={`h-full rounded-full transition-all ${pct === 100 ? "bg-good" : "bg-teal"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
      <ul className="divide-y divide-line">
        {group.tasks.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge tone={DEPT_TONE[t.department] ?? "neutral"}>{t.department}</Badge>
                <span className="truncate text-sm font-medium text-ink">{t.title}</span>
              </div>
              <p className="mt-1 text-xs text-ink-muted">Due {fmtDate(t.dueDate)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusBadge status={t.status} />
              <Select
                value={t.status}
                onChange={(e) => onStatus(t.id, e.target.value)}
                className="w-32"
                aria-label={`Status for ${t.title}`}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </Select>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
