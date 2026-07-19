// Claims Approval — manager/HR/admin console to review, approve or reject the
// claims employees have filed. Route-guarded to MGR roles in the router.
import { useState } from "react";
import { api } from "../api/client";
import { useApi } from "../lib/useApi";
import {
  PageHeader,
  Section,
  StatCard,
  Button,
  Select,
  DataTable,
  StatusBadge,
  Async,
  type Column,
} from "../components/ui";
import { sgd, fmtDate } from "../lib/format";

interface Claim {
  id: number;
  amount: number;
  claimDate: string;
  description: string | null;
  status: string;
  employee?: { id: number; firstName: string; lastName: string; employeeNo: string };
  claimType?: { id: number; name: string; code: string };
}

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "paid", label: "Paid" },
  { value: "", label: "All statuses" },
];

export default function ClaimsApproval() {
  const [status, setStatus] = useState("pending");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Shared refetch trigger: bumping this reloads both the filtered list and
  // the always-pending PendingSummary stat cards together.
  const [reloadKey, setReloadKey] = useState(0);

  const claims = useApi<Claim[]>(
    () => api.get(`/claims?scope=all${status ? `&status=${status}` : ""}`),
    [status, reloadKey]
  );

  async function decide(id: number, action: "approve" | "reject") {
    setBusyId(id);
    setActionError(null);
    try {
      await api.post(`/claims/${id}/${action}`);
      setReloadKey((k) => k + 1);
    } catch (e: any) {
      setActionError(e?.message ?? `Failed to ${action} claim`);
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<Claim>[] = [
    {
      key: "emp",
      header: "Employee",
      render: (c) =>
        c.employee ? (
          <span>
            <span className="font-medium text-ink">
              {c.employee.firstName} {c.employee.lastName}
            </span>
            <span className="ml-2 text-xs text-ink-muted">{c.employee.employeeNo}</span>
          </span>
        ) : (
          "—"
        ),
    },
    { key: "type", header: "Type", render: (c) => c.claimType?.name ?? "—" },
    { key: "amount", header: "Amount", className: "text-right", render: (c) => <span className="num font-semibold">{sgd(c.amount)}</span> },
    { key: "date", header: "Date", render: (c) => fmtDate(c.claimDate) },
    {
      key: "desc",
      header: "Description",
      render: (c) => <span className="text-ink-soft">{c.description || <span className="text-ink-muted">—</span>}</span>,
    },
    {
      key: "action",
      header: "",
      className: "text-right",
      render: (c) =>
        c.status === "pending" ? (
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => decide(c.id, "approve")} disabled={busyId === c.id}>
              Approve
            </Button>
            <Button variant="danger" size="sm" onClick={() => decide(c.id, "reject")} disabled={busyId === c.id}>
              Reject
            </Button>
          </div>
        ) : (
          <StatusBadge status={c.status} />
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Claims Approval"
        subtitle="Review and action expense claims submitted by employees."
        actions={
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        }
      />

      {actionError && (
        <p className="mb-4 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{actionError}</p>
      )}

      {/* Pending summary — always reflects the full pending queue regardless of filter */}
      <PendingSummary reloadKey={reloadKey} />

      <div className="mt-6">
        <Section title={status ? `${STATUS_OPTIONS.find((o) => o.value === status)?.label ?? "Filtered"} Claims` : "All Claims"}>
          <Async state={claims}>
            {(list) => (
              <DataTable
                data={list}
                rowKey={(c) => c.id}
                empty="No claims match this filter."
                columns={columns}
              />
            )}
          </Async>
        </Section>
      </div>
    </div>
  );
}

function PendingSummary({ reloadKey }: { reloadKey: number }) {
  const pending = useApi<Claim[]>(() => api.get("/claims?scope=all&status=pending"), [reloadKey]);
  return (
    <Async state={pending}>
      {(list) => {
        const total = list.reduce((s, c) => s + (c.amount ?? 0), 0);
        return (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Pending Claims" value={list.length} sub="Awaiting your decision" tone="warn" />
            <StatCard label="Pending Amount" value={sgd(total)} sub="Total value in queue" tone="teal" />
          </div>
        );
      }}
    </Async>
  );
}
