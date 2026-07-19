// Leave Application — an employee's own leave workspace: balances at a glance,
// an "Apply for Leave" modal form, and the history of their own requests with a
// cancel action for anything still pending.
import { useState } from "react";
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
  Input,
  Textarea,
  DataTable,
  type Column,
  Async,
  EmptyState,
  Modal,
} from "../components/ui";
import { fmtDate, num } from "../lib/format";

interface LeaveType {
  id: number;
  name: string;
  code: string;
  annualQuota: number;
  paid: boolean;
}
interface Balance {
  id: number;
  entitled: number;
  taken: number;
  pending: number;
  leaveType?: LeaveType;
}
interface LeaveRequest {
  id: number;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: string;
  leaveType?: LeaveType;
}

const available = (b: Balance) => Math.max(0, (b.entitled ?? 0) - (b.taken ?? 0) - (b.pending ?? 0));

export default function LeaveApplication() {
  const { user } = useAuth();
  const hasEmp = user?.employeeId != null;

  const balances = useApi<Balance[]>(() => api.get("/leave/balances?scope=mine"), []);
  const types = useApi<LeaveType[]>(() => api.get("/leave/types"), []);
  const requests = useApi<LeaveRequest[]>(() => api.get("/leave/requests?scope=mine"), []);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ leaveTypeId: "", startDate: "", endDate: "", reason: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  function reloadAll() {
    balances.reload();
    requests.reload();
  }

  function openForm() {
    setForm({ leaveTypeId: "", startDate: "", endDate: "", reason: "" });
    setError(null);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.leaveTypeId) return setError("Please choose a leave type.");
    if (!form.startDate || !form.endDate) return setError("Please choose both dates.");
    if (form.endDate < form.startDate) return setError("End date must be on or after the start date.");
    setSubmitting(true);
    try {
      await api.post("/leave/requests", {
        leaveTypeId: Number(form.leaveTypeId),
        startDate: form.startDate,
        endDate: form.endDate,
        reason: form.reason,
      });
      setOpen(false);
      reloadAll();
    } catch (err: any) {
      setError(err?.message ?? "Could not submit your request.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(id: number) {
    setBusyId(id);
    setCancelError(null);
    try {
      await api.post(`/leave/requests/${id}/cancel`);
      reloadAll();
    } catch (err: any) {
      setCancelError(err?.message ?? "Failed to cancel leave request");
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<LeaveRequest>[] = [
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
    { key: "reason", header: "Reason", render: (r) => r.reason || <span className="text-ink-muted">—</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (r) =>
        r.status === "pending" ? (
          <Button variant="ghost" size="sm" disabled={busyId === r.id} onClick={() => cancel(r.id)}>
            {busyId === r.id ? "Cancelling…" : "Cancel"}
          </Button>
        ) : null,
    },
  ];

  if (!hasEmp) {
    return (
      <div>
        <PageHeader title="Leave" subtitle="Apply for leave and track your requests." />
        <EmptyState
          title="No employee profile linked"
          message="This account is not linked to an employee record, so leave cannot be requested."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Leave"
        subtitle="Apply for leave and track your requests."
        actions={<Button onClick={openForm}>Apply for Leave</Button>}
      />

      {/* Balances */}
      <div className="mb-6">
        <Async state={balances}>
          {(list) =>
            list.length ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {list.map((b) => (
                  <StatCard
                    key={b.id}
                    label={b.leaveType?.name ?? "Leave"}
                    value={num(available(b))}
                    sub={`${num(b.taken)} taken · ${num(b.pending)} pending · ${num(b.entitled)} total`}
                    tone={available(b) > 0 ? "teal" : "warn"}
                  />
                ))}
              </div>
            ) : (
              <Section title="Leave Balances">
                <EmptyState message="No leave balances configured yet." />
              </Section>
            )
          }
        </Async>
      </div>

      {/* My requests */}
      <Section title="My Leave Requests">
        {cancelError && <p className="mb-4 text-sm font-medium text-bad">{cancelError}</p>}
        <Async state={requests}>
          {(list) => <DataTable columns={columns} data={list} rowKey={(r) => r.id} empty="You have no leave requests yet." />}
        </Async>
      </Section>

      {/* Apply modal */}
      <Modal
        open={open}
        onClose={() => (submitting ? undefined : setOpen(false))}
        title="Apply for Leave"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" form="leave-apply-form" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit Request"}
            </Button>
          </>
        }
      >
        <form id="leave-apply-form" onSubmit={submit} className="space-y-4">
          {error && (
            <p className="rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">{error}</p>
          )}
          <Field label="Leave Type">
            <Async state={types}>
              {(list) => (
                <Select
                  value={form.leaveTypeId}
                  onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}
                  required
                >
                  <option value="">Select a leave type…</option>
                  {list.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.paid ? "" : " (unpaid)"}
                    </option>
                  ))}
                </Select>
              )}
            </Async>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start Date">
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                required
              />
            </Field>
            <Field label="End Date">
              <Input
                type="date"
                min={form.startDate || undefined}
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                required
              />
            </Field>
          </div>
          <Field label="Reason" hint="Optional — a short note for your approver.">
            <Textarea
              rows={3}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="e.g. Family holiday"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
