// Leave Approval — managers see their team's requests, HR/admin see everyone's.
// Approve / reject pending requests inline; a status filter lets approvers
// review historical decisions too.
import { useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useApi } from "../lib/useApi";
import {
  PageHeader,
  Section,
  StatCard,
  StatusBadge,
  Button,
  Field,
  Select,
  DataTable,
  type Column,
  Async,
} from "../components/ui";
import { fmtDate, num } from "../lib/format";

interface Employee {
  firstName: string;
  lastName: string;
  employeeNo?: string;
}
interface LeaveType {
  name: string;
}
interface LeaveRequest {
  id: number;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: string;
  employee?: Employee;
  leaveType?: LeaveType;
}

type StatusFilter = "pending" | "approved" | "rejected" | "all";

export default function LeaveApproval() {
  const { hasRole } = useAuth();
  const scope = hasRole("admin", "hr") ? "all" : "team";

  const [status, setStatus] = useState<StatusFilter>("pending");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const requests = useApi<LeaveRequest[]>(
    () => api.get(`/leave/requests?scope=${scope}&status=${status}`),
    [scope, status]
  );

  async function decide(id: number, action: "approve" | "reject") {
    setBusyId(id);
    setActionError(null);
    try {
      await api.post(`/leave/requests/${id}/${action}`);
      requests.reload();
    } catch (err: any) {
      setActionError(err?.message ?? `Failed to ${action} leave request`);
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<LeaveRequest>[] = [
    {
      key: "employee",
      header: "Employee",
      render: (r) =>
        r.employee ? (
          <div>
            <p className="font-medium text-ink">
              {r.employee.firstName} {r.employee.lastName}
            </p>
            {r.employee.employeeNo && <p className="text-xs text-ink-muted">{r.employee.employeeNo}</p>}
          </div>
        ) : (
          "—"
        ),
    },
    { key: "type", header: "Type", render: (r) => r.leaveType?.name ?? "—" },
    {
      key: "dates",
      header: "Dates",
      render: (r) => (
        <span className="whitespace-nowrap">
          {fmtDate(r.startDate)} <span className="text-ink-muted">–</span> {fmtDate(r.endDate)}
        </span>
      ),
    },
    { key: "days", header: "Days", className: "text-right", render: (r) => <span className="num">{num(r.days)}</span> },
    {
      key: "reason",
      header: "Reason",
      render: (r) => <span className="text-ink-soft">{r.reason || <span className="text-ink-muted">—</span>}</span>,
    },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (r) =>
        r.status === "pending" ? (
          <div className="flex justify-end gap-2">
            <Button variant="primary" size="sm" disabled={busyId === r.id} onClick={() => decide(r.id, "approve")}>
              Approve
            </Button>
            <Button variant="danger" size="sm" disabled={busyId === r.id} onClick={() => decide(r.id, "reject")}>
              Reject
            </Button>
          </div>
        ) : null,
    },
  ];

  const filterControl = (
    <Field label="">
      <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
        <option value="pending">Pending</option>
        <option value="approved">Approved</option>
        <option value="rejected">Rejected</option>
        <option value="all">All</option>
      </Select>
    </Field>
  );

  return (
    <div>
      <PageHeader
        title="Leave Approvals"
        subtitle={
          scope === "all"
            ? "Review and decide leave requests across the organisation."
            : "Review and decide leave requests from your team."
        }
      />

      {actionError && <p className="mb-4 text-sm font-medium text-bad">{actionError}</p>}

      <Async state={requests}>
        {(list) => {
          const pending = list.filter((r) => r.status === "pending");
          const totalDays = pending.reduce((s, r) => s + (r.days ?? 0), 0);
          return (
            <>
              <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <StatCard label="Pending" value={num(pending.length)} sub="Awaiting your decision" tone="warn" />
                <StatCard label="Days Requested" value={num(totalDays)} sub="Across pending requests" tone="teal" />
                <StatCard
                  label="Showing"
                  value={num(list.length)}
                  sub={status === "all" ? "All statuses" : `${status} requests`}
                  tone="neutral"
                />
              </div>

              <Section title="Leave Requests" actions={<div className="w-40">{filterControl}</div>}>
                <DataTable columns={columns} data={list} rowKey={(r) => r.id} empty="No leave requests to show." />
              </Section>
            </>
          );
        }}
      </Async>
    </div>
  );
}
