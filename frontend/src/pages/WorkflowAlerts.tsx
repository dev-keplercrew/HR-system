// Workflow Alerts — the alert engine's operator console. Managers/HR/admin
// regenerate the alert set, slice it by type/severity/read-state, triage each
// item and acknowledge it. Read alerts are visually muted so the eye lands on
// what still needs action.
import { useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { useApi } from "../lib/useApi";
import {
  PageHeader,
  Section,
  StatCard,
  Badge,
  Button,
  Field,
  Select,
  DataTable,
  Async,
  EmptyState,
  type Column,
  type Tone,
} from "../components/ui";
import { fmtDate, titleCase } from "../lib/format";

type Severity = "info" | "warning" | "critical";

interface AlertRow {
  id: number;
  employeeId: number | null;
  type: string;
  severity: Severity;
  title: string;
  message: string;
  dueDate: string | null;
  read: boolean;
  employee?: { firstName: string; lastName: string; employeeNo: string } | null;
}

interface Summary {
  total: number;
  unread: number;
  byType: { type: string; count: number }[];
  bySeverity: { severity: string; count: number }[];
}

const SEVERITY_TONE: Record<Severity, Tone> = {
  critical: "bad",
  warning: "warn",
  info: "neutral",
};

const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "probation", label: "Probation" },
  { value: "contract-expiry", label: "Contract expiry" },
  { value: "workpass-expiry", label: "Work-pass expiry" },
  { value: "cert-renewal", label: "Cert renewal" },
];

const SEVERITY_OPTIONS = [
  { value: "", label: "All severities" },
  { value: "critical", label: "Critical" },
  { value: "warning", label: "Warning" },
  { value: "info", label: "Info" },
];

export default function WorkflowAlerts() {
  const { hasRole } = useAuth();
  const canView = hasRole("admin", "hr", "manager");

  const [type, setType] = useState("");
  const [severity, setSeverity] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (type) p.set("type", type);
    if (severity) p.set("severity", severity);
    if (unreadOnly) p.set("unread", "true");
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [type, severity, unreadOnly]);

  const summary = useApi<Summary>(() => api.get("/workflow/alerts/summary"), []);
  const alerts = useApi<AlertRow[]>(() => api.get(`/workflow/alerts${query}`), [query]);

  if (!canView) {
    return (
      <div>
        <PageHeader title="Workflow Alerts" />
        <EmptyState
          title="Restricted"
          message="Workflow alerts are available to managers, HR and administrators."
        />
      </div>
    );
  }

  const criticalCount =
    summary.data?.bySeverity.find((s) => s.severity === "critical")?.count ?? 0;

  async function regenerate() {
    setRegenerating(true);
    setNotice(null);
    try {
      const res = await api.post<{ generated: number }>("/workflow/regenerate");
      setNotice(`Regenerated ${res.generated} alert${res.generated === 1 ? "" : "s"}.`);
      summary.reload();
      alerts.reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Failed to regenerate alerts.");
    } finally {
      setRegenerating(false);
    }
  }

  async function markRead(id: number) {
    setBusyId(id);
    try {
      await api.post(`/workflow/alerts/${id}/read`);
      summary.reload();
      alerts.reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Failed to mark alert as read.");
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<AlertRow>[] = [
    {
      key: "severity",
      header: "Severity",
      render: (a) => <Badge tone={SEVERITY_TONE[a.severity] ?? "neutral"}>{titleCase(a.severity)}</Badge>,
    },
    { key: "type", header: "Type", render: (a) => <span className="text-ink-soft">{titleCase(a.type)}</span> },
    {
      key: "alert",
      header: "Alert",
      render: (a) => (
        <div className={`max-w-md ${a.read ? "opacity-50" : ""}`}>
          <p className="font-medium text-ink">{a.title}</p>
          <p className="text-xs text-ink-muted">{a.message}</p>
        </div>
      ),
    },
    {
      key: "employee",
      header: "Employee",
      render: (a) =>
        a.employee ? (
          <div>
            <p className="text-ink">{a.employee.firstName} {a.employee.lastName}</p>
            <p className="text-xs text-ink-muted">{a.employee.employeeNo}</p>
          </div>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    { key: "dueDate", header: "Due", render: (a) => <span className="num">{fmtDate(a.dueDate)}</span> },
    {
      key: "status",
      header: "",
      className: "text-right",
      render: (a) =>
        a.read ? (
          <Badge tone="good">Read</Badge>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={busyId === a.id}
            onClick={() => markRead(a.id)}
          >
            {busyId === a.id ? "…" : "Mark read"}
          </Button>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Workflow Alerts"
        subtitle="Automated compliance watch — probation, contracts, work passes & certifications."
        actions={
          <Button onClick={regenerate} disabled={regenerating}>
            {regenerating ? "Regenerating…" : "Regenerate Alerts"}
          </Button>
        }
      />

      {notice && (
        <div className="mb-4 rounded-lg border border-line bg-teal-soft/40 px-4 py-2 text-sm text-teal-dark">
          {notice}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Async state={summary}>
          {(s) => (
            <>
              <StatCard label="Total Alerts" value={s.total} sub="Across all employees" tone="teal" />
              <StatCard label="Unread" value={s.unread} sub="Awaiting acknowledgement" tone="warn" />
              <StatCard
                label="Critical"
                value={criticalCount}
                sub="Due within 7 days"
                tone="bad"
              />
              <StatCard
                label="Types Tracked"
                value={s.byType.length}
                sub={s.byType.map((t) => titleCase(t.type)).join(" · ") || "None active"}
                tone="neutral"
              />
            </>
          )}
        </Async>
      </div>

      <Section
        title="Active Alerts"
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Field label="Type">
                <Select value={type} onChange={(e) => setType(e.target.value)}>
                  {TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="w-40">
              <Field label="Severity">
                <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                  {SEVERITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-line accent-teal"
                checked={unreadOnly}
                onChange={(e) => setUnreadOnly(e.target.checked)}
              />
              Unread only
            </label>
          </div>
        }
      >
        <Async state={alerts}>
          {(rows) => (
            <div className="[&_tbody_tr]:transition-opacity">
              <DataTable<AlertRow>
                data={rows}
                columns={columns}
                rowKey={(a) => a.id}
                empty="No alerts match these filters. Try regenerating."
              />
              {rows.some((r) => r.read) && (
                <p className="mt-3 text-xs text-ink-muted">
                  Read alerts remain listed for reference; filter to “Unread only” to focus on open items.
                </p>
              )}
            </div>
          )}
        </Async>
      </Section>
    </div>
  );
}
