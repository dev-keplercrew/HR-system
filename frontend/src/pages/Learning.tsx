// Learning & Certifications — an employee's training history and certifications,
// with a Team view and expiring-certification reminders for managers/HR.
// Composed from the /api/learning module endpoints.
import { useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
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
  type Column,
  Async,
  EmptyState,
  Modal,
  Tabs,
} from "../components/ui";
import { fmtDate, num, titleCase } from "../lib/format";

interface EmployeeRef {
  firstName: string;
  lastName: string;
  employeeNo: string;
}
interface TrainingRecord {
  id: number;
  employeeId: number;
  courseName: string;
  provider: string | null;
  completedAt: string | null;
  hours: number;
  status: string;
  employee?: EmployeeRef;
}
interface Certification {
  id: number;
  employeeId: number;
  name: string;
  authority: string | null;
  issuedDate: string | null;
  expiryDate: string | null;
  mandatory: boolean;
  employee?: EmployeeRef;
}

const MS_DAY = 86_400_000;

// Whole days from today until an expiry date (negative = already expired).
function daysUntil(value: string | null): number | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - today.getTime()) / MS_DAY);
}

// Map an expiry horizon to a tone + label: expired=bad, <60d=warn, else good.
function expiryStatus(value: string | null): { tone: "bad" | "warn" | "good" | "neutral"; label: string } {
  const days = daysUntil(value);
  if (days == null) return { tone: "neutral", label: "No expiry" };
  if (days < 0) return { tone: "bad", label: "Expired" };
  if (days <= 60) return { tone: "warn", label: `${days}d left` };
  return { tone: "good", label: "Valid" };
}

const empName = (e?: EmployeeRef) => (e ? `${e.firstName} ${e.lastName}` : "—");

export default function Learning() {
  const { user, hasRole } = useAuth();
  const isStaff = hasRole("admin", "hr", "manager");
  const [tab, setTab] = useState<"mine" | "team">("mine");
  const scope = tab === "team" ? "all" : "mine";

  return (
    <div>
      <PageHeader
        title="Learning & Certifications"
        subtitle="Training history, certifications and mandatory-renewal reminders."
      />

      <Tabs
        tabs={[
          { key: "mine", label: "My Learning" },
          ...(isStaff ? [{ key: "team", label: "Team" }] : []),
        ]}
        active={tab}
        onChange={(k) => setTab(k as "mine" | "team")}
      />

      {tab === "team" && isStaff ? (
        <TeamView scope="all" />
      ) : (
        <MineView scope="mine" canManageSelf hasEmployee={user?.employeeId != null} />
      )}
    </div>
  );
}

// ---- Expiring-soon reminders (staff only) ---------------------------------

function ExpiringSoon() {
  const expiring = useApi<Certification[]>(() => api.get("/learning/expiring"), []);
  return (
    <Section title="Expiring Soon" actions={<span className="text-xs text-ink-muted">Next 60 days</span>}>
      <Async state={expiring}>
        {(list) =>
          list.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((c) => {
                const days = daysUntil(c.expiryDate);
                const tone = days != null && days < 0 ? "bad" : "warn";
                return (
                  <div key={c.id} className="rounded-lg border border-line bg-surface p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Badge tone={tone}>
                        {days != null && days < 0 ? "Expired" : `${days}d to expiry`}
                      </Badge>
                      {c.mandatory && <Badge tone="teal">Mandatory</Badge>}
                    </div>
                    <p className="text-sm font-semibold text-ink">{c.name}</p>
                    <p className="text-xs text-ink-muted">{c.authority ?? "—"}</p>
                    <p className="mt-2 text-xs text-ink-soft">
                      {empName(c.employee)} · expires {fmtDate(c.expiryDate)}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState message="No certifications expiring in the next 60 days 🎉" />
          )
        }
      </Async>
    </Section>
  );
}

// ---- Team view ------------------------------------------------------------

function TeamView({ scope }: { scope: "all" }) {
  const records = useApi<TrainingRecord[]>(() => api.get(`/learning/records?scope=${scope}`), [scope]);
  const certs = useApi<Certification[]>(() => api.get(`/learning/certifications?scope=${scope}`), [scope]);

  const recordCols: Column<TrainingRecord>[] = [
    { key: "emp", header: "Employee", render: (r) => empName(r.employee) },
    { key: "course", header: "Course", render: (r) => <span className="font-medium text-ink">{r.courseName}</span> },
    { key: "provider", header: "Provider", render: (r) => r.provider ?? "—" },
    { key: "hours", header: "Hours", className: "text-right", render: (r) => <span className="num">{num(r.hours, 1)}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "completed", header: "Completed", render: (r) => fmtDate(r.completedAt) },
  ];
  const certCols = certColumns(true);

  return (
    <div className="space-y-6">
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Async state={records}>
          {(list) => (
            <StatCard
              label="Training Records"
              value={list.length}
              sub={`${list.filter((r) => r.status === "completed").length} completed`}
              tone="teal"
            />
          )}
        </Async>
        <Async state={records}>
          {(list) => (
            <StatCard
              label="Training Hours"
              value={num(list.reduce((s, r) => s + (r.hours ?? 0), 0), 1)}
              sub="Logged across team"
              tone="good"
            />
          )}
        </Async>
        <Async state={certs}>
          {(list) => (
            <StatCard
              label="Certifications"
              value={list.length}
              sub={`${list.filter((c) => c.mandatory).length} mandatory`}
              tone="neutral"
            />
          )}
        </Async>
        <Async state={certs}>
          {(list) => (
            <StatCard
              label="Expired / Expiring"
              value={list.filter((c) => {
                const d = daysUntil(c.expiryDate);
                return d != null && d <= 60;
              }).length}
              sub="Within 60 days"
              tone="warn"
            />
          )}
        </Async>
      </div>

      <ExpiringSoon />

      <Section title="Team Training Records">
        <Async state={records}>
          {(list) => <DataTable data={list} rowKey={(r) => r.id} empty="No training records" columns={recordCols} />}
        </Async>
      </Section>

      <Section title="Team Certifications">
        <Async state={certs}>
          {(list) => <DataTable data={list} rowKey={(c) => c.id} empty="No certifications" columns={certCols} />}
        </Async>
      </Section>
    </div>
  );
}

// ---- My Learning view -----------------------------------------------------

function MineView({
  hasEmployee,
}: {
  scope: "mine";
  canManageSelf: boolean;
  hasEmployee: boolean;
}) {
  const records = useApi<TrainingRecord[]>(() => api.get("/learning/records?scope=mine"), []);
  const certs = useApi<Certification[]>(() => api.get("/learning/certifications?scope=mine"), []);
  const [adding, setAdding] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  if (!hasEmployee) {
    return (
      <EmptyState
        title="No employee profile linked"
        message="This account is not linked to an employee record, so there is no learning history to show."
      />
    );
  }

  async function markComplete(id: number) {
    setCompleteError(null);
    try {
      await api.put(`/learning/records/${id}`, { status: "completed" });
      records.reload();
    } catch (err: any) {
      setCompleteError(err?.message ?? "Failed to mark training complete");
    }
  }

  const recordCols: Column<TrainingRecord>[] = [
    { key: "course", header: "Course", render: (r) => <span className="font-medium text-ink">{r.courseName}</span> },
    { key: "provider", header: "Provider", render: (r) => r.provider ?? "—" },
    { key: "hours", header: "Hours", className: "text-right", render: (r) => <span className="num">{num(r.hours, 1)}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "completed", header: "Completed", render: (r) => fmtDate(r.completedAt) },
    {
      key: "action",
      header: "",
      className: "text-right",
      render: (r) =>
        r.status === "in-progress" ? (
          <Button variant="ghost" size="sm" onClick={() => markComplete(r.id)}>
            Mark complete
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <Section
        title="Training Records"
        actions={
          <Button size="sm" onClick={() => setAdding(true)}>
            Add Training
          </Button>
        }
      >
        {completeError && <p className="mb-4 text-sm font-medium text-bad">{completeError}</p>}
        <Async state={records}>
          {(list) => <DataTable data={list} rowKey={(r) => r.id} empty="No training yet — add your first course." columns={recordCols} />}
        </Async>
      </Section>

      <Section title="Certifications">
        <Async state={certs}>
          {(list) => (
            <DataTable data={list} rowKey={(c) => c.id} empty="No certifications on record." columns={certColumns(false)} />
          )}
        </Async>
      </Section>

      <AddTrainingModal open={adding} onClose={() => setAdding(false)} onSaved={() => records.reload()} />
    </div>
  );
}

// Shared certification columns; `withEmployee` prepends the employee name.
function certColumns(withEmployee: boolean): Column<Certification>[] {
  const base: Column<Certification>[] = [
    {
      key: "name",
      header: "Certification",
      render: (c) => (
        <span className="flex items-center gap-2">
          <span className="font-medium text-ink">{c.name}</span>
          {c.mandatory && <Badge tone="teal">Mandatory</Badge>}
        </span>
      ),
    },
    { key: "authority", header: "Authority", render: (c) => c.authority ?? "—" },
    { key: "issued", header: "Issued", render: (c) => fmtDate(c.issuedDate) },
    { key: "expiry", header: "Expiry", render: (c) => fmtDate(c.expiryDate) },
    {
      key: "state",
      header: "Status",
      render: (c) => {
        const s = expiryStatus(c.expiryDate);
        return <Badge tone={s.tone}>{s.label}</Badge>;
      },
    },
  ];
  if (withEmployee) {
    return [{ key: "emp", header: "Employee", render: (c) => empName(c.employee) }, ...base];
  }
  return base;
}

// ---- Add-training modal ---------------------------------------------------

function AddTrainingModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [courseName, setCourseName] = useState("");
  const [provider, setProvider] = useState("");
  const [hours, setHours] = useState("");
  const [status, setStatus] = useState("enrolled");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = useMemo(() => courseName.trim().length > 0, [courseName]);

  function reset() {
    setCourseName("");
    setProvider("");
    setHours("");
    setStatus("enrolled");
    setError(null);
  }

  async function submit() {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.post("/learning/records", {
        courseName: courseName.trim(),
        provider: provider.trim() || undefined,
        hours: hours === "" ? undefined : Number(hours),
        status,
      });
      reset();
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save training");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Training"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!valid || saving}>
            {saving ? "Saving…" : "Add Training"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <p className="rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
        <Field label="Course name">
          <Input value={courseName} onChange={(e) => setCourseName(e.target.value)} placeholder="e.g. Workplace Safety Fundamentals" />
        </Field>
        <Field label="Provider" hint="Training provider or platform (optional).">
          <Input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="e.g. SkillsFuture Singapore" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Hours">
            <Input type="number" min={0} step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {["enrolled", "in-progress", "completed"].map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}
