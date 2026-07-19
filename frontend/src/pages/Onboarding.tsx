// Onboarding Workflow — HR/manager console for kicking off new-hire onboarding
// checklists and tracking company-asset issuance. Auto-generated checklists fan
// work out to IT / Facilities / Hiring Manager / HR (the RFP "New Hire Created"
// workflow). Route is guarded to manager/hr/admin in App.tsx.
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
  Input,
  Select,
  DataTable,
  Async,
  EmptyState,
  Modal,
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
const CATEGORY_OPTIONS = ["hardware", "access-card", "phone", "other"];

const DEPT_TONE: Record<string, "teal" | "good" | "warn" | "neutral" | "bad"> = {
  IT: "teal",
  HR: "good",
  "Hiring Manager": "warn",
  Facilities: "neutral",
};

export default function Onboarding() {
  const { hasRole } = useAuth();
  const isHR = hasRole("admin", "hr");

  const tasks = useApi<Task[]>(() => api.get("/lifecycle/onboarding"), []);
  const employees = useApi<EmployeeLite[]>(() => api.get("/lifecycle/employees-lite"), []);
  const assets = useApi<Asset[]>(() => api.get("/lifecycle/assets"), []);

  const [pickEmp, setPickEmp] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  async function startOnboarding() {
    if (!pickEmp) return;
    setStarting(true);
    setStartError(null);
    try {
      await api.post("/lifecycle/onboarding", { employeeId: Number(pickEmp) });
      setPickEmp("");
      tasks.reload();
    } catch (err: any) {
      setStartError(err?.message ?? "Failed to start onboarding");
    } finally {
      setStarting(false);
    }
  }

  async function changeStatus(taskId: number, status: string) {
    setStatusError(null);
    try {
      await api.patch(`/lifecycle/onboarding/tasks/${taskId}`, { status });
      tasks.reload();
    } catch (err: any) {
      setStatusError(err?.message ?? "Failed to update task status");
    }
  }

  return (
    <div>
      <PageHeader
        title="Onboarding Workflow"
        subtitle="Kick off new-hire checklists and track equipment issued to joiners."
      />

      {/* Stat row */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Async state={tasks}>
          {(list) => {
            const groups = new Set(list.map((t) => t.employeeId));
            return <StatCard label="Active Onboardings" value={groups.size} sub="Employees in progress" tone="teal" />;
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
              label="Assets Issued"
              value={list.filter((a) => a.status === "issued").length}
              sub={`${list.length} in register`}
              tone="good"
            />
          )}
        </Async>
        <Async state={assets}>
          {(list) => (
            <StatCard
              label="Assets Available"
              value={list.filter((a) => a.status === "available").length}
              sub="Ready to issue"
              tone="neutral"
            />
          )}
        </Async>
      </div>

      {/* Start onboarding */}
      {isHR && (
        <Section title="Start Onboarding">
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
            <Button onClick={startOnboarding} disabled={!pickEmp || starting}>
              {starting ? "Starting…" : "Start Onboarding"}
            </Button>
          </div>
          {startError && <p className="mt-2 text-sm font-medium text-bad">{startError}</p>}
          <p className="mt-2 text-xs text-ink-muted">
            Generates a standard checklist (IT, Facilities, Hiring Manager, HR) due in 7 days. Existing checklists are
            preserved.
          </p>
        </Section>
      )}

      {/* Checklists grouped by employee */}
      <div className="mt-6">
        {statusError && <p className="mb-4 text-sm font-medium text-bad">{statusError}</p>}
        <Async state={tasks}>
          {(list) => {
            const byEmployee = groupByEmployee(list);
            if (byEmployee.length === 0) {
              return (
                <Section title="Onboarding Checklists">
                  <EmptyState
                    title="No onboarding in progress"
                    message={isHR ? "Start an onboarding above to generate a checklist." : "No checklists have been started yet."}
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

      {/* Assets */}
      <div className="mt-6">
        <AssetsSection
          state={assets}
          employees={employees}
          isHR={isHR}
          onChanged={() => assets.reload()}
        />
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

// ---- assets section (shared shape used by both lifecycle pages) -----------

type AssetState = ReturnType<typeof useApi<Asset[]>>;
type EmpState = ReturnType<typeof useApi<EmployeeLite[]>>;

export function AssetsSection({
  state,
  employees,
  isHR,
  onChanged,
}: {
  state: AssetState;
  employees: EmpState;
  isHR: boolean;
  onChanged: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [issueFor, setIssueFor] = useState<Asset | null>(null);
  const [returnError, setReturnError] = useState<string | null>(null);

  const columns: Column<Asset>[] = [
    { key: "tag", header: "Tag", render: (a) => <span className="font-medium text-ink">{a.tag}</span> },
    { key: "name", header: "Name", render: (a) => a.name },
    { key: "category", header: "Category", render: (a) => <span className="capitalize">{titleCase(a.category)}</span> },
    { key: "status", header: "Status", render: (a) => <StatusBadge status={a.status} /> },
    {
      key: "assigned",
      header: "Assigned To",
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
    {
      key: "action",
      header: "",
      className: "text-right",
      render: (a) =>
        isHR ? (
          a.status === "issued" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => returnAsset(a.id)}
            >
              Return
            </Button>
          ) : a.status === "available" ? (
            <Button variant="ghost" size="sm" onClick={() => setIssueFor(a)}>
              Issue
            </Button>
          ) : (
            <span className="text-xs text-ink-muted">—</span>
          )
        ) : null,
    },
  ];

  async function returnAsset(id: number) {
    setReturnError(null);
    try {
      await api.post(`/lifecycle/assets/${id}/return`);
      onChanged();
    } catch (err: any) {
      setReturnError(err?.message ?? "Failed to return asset");
    }
  }

  return (
    <Section
      title="Company Assets"
      actions={isHR ? <Button size="sm" onClick={() => setAddOpen(true)}>Add Asset</Button> : undefined}
    >
      {returnError && <p className="mb-4 text-sm font-medium text-bad">{returnError}</p>}
      <Async state={state}>
        {(list) => (
          <DataTable data={list} rowKey={(a) => a.id} empty="No assets registered yet." columns={columns} />
        )}
      </Async>

      {isHR && (
        <>
          <AddAssetModal
            open={addOpen}
            onClose={() => setAddOpen(false)}
            onCreated={() => {
              setAddOpen(false);
              onChanged();
            }}
          />
          <IssueAssetModal
            asset={issueFor}
            employees={employees}
            onClose={() => setIssueFor(null)}
            onIssued={() => {
              setIssueFor(null);
              onChanged();
            }}
          />
        </>
      )}
    </Section>
  );
}

function AddAssetModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [tag, setTag] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("hardware");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post("/lifecycle/assets", { tag, name, category });
      setTag("");
      setName("");
      setCategory("hardware");
      onCreated();
    } catch (err: any) {
      setError(err?.message ?? "Failed to add asset");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Asset"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-asset-form" disabled={saving}>
            {saving ? "Saving…" : "Add Asset"}
          </Button>
        </>
      }
    >
      <form id="add-asset-form" onSubmit={submit} className="space-y-4">
        <Field label="Asset Tag" hint="Unique identifier, e.g. LT-0421">
          <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="LT-0421" required />
        </Field>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="MacBook Pro 14&quot;" required />
        </Field>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {titleCase(c)}
              </option>
            ))}
          </Select>
        </Field>
        {error && <p className="text-sm font-medium text-bad">{error}</p>}
      </form>
    </Modal>
  );
}

function IssueAssetModal({
  asset,
  employees,
  onClose,
  onIssued,
}: {
  asset: Asset | null;
  employees: EmpState;
  onClose: () => void;
  onIssued: () => void;
}) {
  const [empId, setEmpId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!asset || !empId) return;
    setSaving(true);
    setError(null);
    try {
      await api.post(`/lifecycle/assets/${asset.id}/issue`, { employeeId: Number(empId) });
      setEmpId("");
      onIssued();
    } catch (err: any) {
      setError(err?.message ?? "Failed to issue asset");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={asset != null}
      onClose={onClose}
      title={asset ? `Issue ${asset.tag} · ${asset.name}` : "Issue Asset"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="issue-asset-form" disabled={saving || !empId}>
            {saving ? "Issuing…" : "Issue Asset"}
          </Button>
        </>
      }
    >
      <form id="issue-asset-form" onSubmit={submit} className="space-y-4">
        <Async state={employees}>
          {(list) => (
            <Field label="Issue To">
              <Select value={empId} onChange={(e) => setEmpId(e.target.value)}>
                <option value="">Select an employee…</option>
                {list.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.firstName} {emp.lastName} · {emp.employeeNo}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </Async>
        {error && <p className="text-sm font-medium text-bad">{error}</p>}
      </form>
    </Modal>
  );
}
