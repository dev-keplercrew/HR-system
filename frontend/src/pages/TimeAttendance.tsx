// Time & Attendance — the signed-in employee's clock-in/out workspace, the shift
// roster, and overtime requests (with a manager approvals queue). Three tabs;
// staff (admin/hr/manager) get broadened scope and approval controls.
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
  Textarea,
  DataTable,
  type Column,
  Async,
  EmptyState,
  Modal,
  Tabs,
} from "../components/ui";
import { fmtDate, fmtDateTime, num } from "../lib/format";

// ---- shared types ---------------------------------------------------------

interface EmployeeRef {
  firstName: string;
  lastName: string;
  employeeNo: string;
}
interface Shift {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  location: string | null;
  employee?: EmployeeRef;
}
interface AttendanceRecord {
  id: number;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  scheduledHours: number;
  workedHours: number;
  overtimeHours: number;
  employee?: EmployeeRef;
}
interface OvertimeRequest {
  id: number;
  date: string;
  hours: number;
  reason: string | null;
  status: string;
  employee?: EmployeeRef;
}
interface EmployeeOption {
  id: number;
  firstName: string;
  lastName: string;
  employeeNo: string;
}

const empName = (e?: EmployeeRef) => (e ? `${e.firstName} ${e.lastName}` : "—");
const isToday = (v: string | null | undefined) => {
  if (!v) return false;
  const d = new Date(v);
  const now = new Date();
  return d.toDateString() === now.toDateString();
};

type TabKey = "attendance" | "roster" | "overtime";

export default function TimeAttendance() {
  const { user, hasRole } = useAuth();
  const isStaff = hasRole("admin", "hr", "manager");
  const hasEmp = user?.employeeId != null;
  const [tab, setTab] = useState<TabKey>("attendance");

  return (
    <div>
      <PageHeader
        title="Time & Attendance"
        subtitle="Clock in and out, view your roster, and manage overtime."
      />
      <Tabs
        active={tab}
        onChange={(k) => setTab(k as TabKey)}
        tabs={[
          { key: "attendance", label: "Attendance" },
          { key: "roster", label: "Roster" },
          { key: "overtime", label: "Overtime" },
        ]}
      />

      {tab === "attendance" && <AttendanceTab isStaff={isStaff} hasEmp={hasEmp} />}
      {tab === "roster" && <RosterTab isStaff={isStaff} hasEmp={hasEmp} selfId={user?.employeeId ?? null} />}
      {tab === "overtime" && <OvertimeTab isStaff={isStaff} hasEmp={hasEmp} />}
    </div>
  );
}

// ---- Attendance tab -------------------------------------------------------

function AttendanceTab({ isStaff, hasEmp }: { isStaff: boolean; hasEmp: boolean }) {
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const records = useApi<AttendanceRecord[]>(
    () => api.get(`/attendance/records?scope=${scope}`),
    [scope]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function clock(type: "in" | "out") {
    setBusy(true);
    setError(null);
    try {
      await api.post("/attendance/records/clock", { type });
      records.reload();
    } catch (err: any) {
      setError(err?.message ?? "Could not record your clock.");
    } finally {
      setBusy(false);
    }
  }

  // Today's record from the (mine-scoped) list, for the clock card summary.
  const mine = records.data ?? [];
  const todayRec = scope === "mine" ? mine.find((r) => isToday(r.date)) : undefined;
  const clockedIn = !!todayRec?.clockIn && !todayRec?.clockOut;

  const columns: Column<AttendanceRecord>[] = [
    ...(scope === "all"
      ? [{ key: "emp", header: "Employee", render: (r: AttendanceRecord) => empName(r.employee) }]
      : []),
    { key: "date", header: "Date", render: (r) => fmtDate(r.date) },
    { key: "in", header: "Clock In", render: (r) => fmtDateTime(r.clockIn) },
    { key: "out", header: "Clock Out", render: (r) => fmtDateTime(r.clockOut) },
    {
      key: "worked",
      header: "Worked",
      className: "text-right",
      render: (r) => <span className="num">{num(r.workedHours, 2)}h</span>,
    },
    {
      key: "ot",
      header: "Overtime",
      className: "text-right",
      render: (r) =>
        r.overtimeHours > 0 ? (
          <Badge tone="warn">
            <span className="num">{num(r.overtimeHours, 2)}h</span> OT
          </Badge>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
  ];

  if (!hasEmp) {
    return (
      <EmptyState
        title="No employee profile linked"
        message="This account is not linked to an employee record, so attendance cannot be tracked."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Clock card */}
      <div className="card-pad">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Today</p>
            <p className="mt-1 text-lg font-semibold text-ink">{fmtDate(new Date())}</p>
            <div className="mt-2 flex items-center gap-2 text-sm">
              {clockedIn ? (
                <Badge tone="good">On the clock</Badge>
              ) : todayRec?.clockOut ? (
                <Badge tone="neutral">Clocked out</Badge>
              ) : (
                <Badge tone="warn">Not clocked in</Badge>
              )}
              {todayRec?.clockIn && (
                <span className="text-ink-muted">In at {fmtDateTime(todayRec.clockIn)}</span>
              )}
              {todayRec?.clockOut && (
                <span className="text-ink-muted">· Out at {fmtDateTime(todayRec.clockOut)}</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            {todayRec && todayRec.workedHours > 0 && (
              <div className="text-right">
                <p className="num text-2xl font-semibold text-ink">{num(todayRec.workedHours, 2)}h</p>
                <p className="text-xs text-ink-muted">worked today</p>
              </div>
            )}
            <div className="flex gap-3">
              <Button
                size="md"
                onClick={() => clock("in")}
                disabled={busy || clockedIn}
                className="px-6 py-3 text-base"
              >
                {busy ? "…" : "Clock In"}
              </Button>
              <Button
                variant="ghost"
                size="md"
                onClick={() => clock("out")}
                disabled={busy || !clockedIn}
                className="px-6 py-3 text-base"
              >
                {busy ? "…" : "Clock Out"}
              </Button>
            </div>
          </div>
        </div>
        {error && (
          <p className="mt-4 rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">{error}</p>
        )}
      </div>

      {/* Records table */}
      <Section
        title={scope === "all" ? "All Attendance Records" : "My Attendance Records"}
        actions={
          isStaff ? (
            <div className="flex gap-1">
              <TabPill active={scope === "mine"} onClick={() => setScope("mine")}>
                Mine
              </TabPill>
              <TabPill active={scope === "all"} onClick={() => setScope("all")}>
                Everyone
              </TabPill>
            </div>
          ) : undefined
        }
      >
        <Async state={records}>
          {(list) => (
            <DataTable
              columns={columns}
              data={list}
              rowKey={(r) => r.id}
              empty="No attendance records yet."
            />
          )}
        </Async>
      </Section>
    </div>
  );
}

// ---- Roster tab -----------------------------------------------------------

function RosterTab({
  isStaff,
  hasEmp,
  selfId,
}: {
  isStaff: boolean;
  hasEmp: boolean;
  selfId: number | null;
}) {
  const [scope, setScope] = useState<"mine" | "all">(isStaff ? "all" : "mine");
  const shifts = useApi<Shift[]>(() => api.get(`/attendance/shifts?scope=${scope}`), [scope]);
  const employees = useApi<EmployeeOption[]>(
    () => (isStaff ? api.get("/employees") : Promise.resolve([])),
    [isStaff]
  );

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    employeeId: "",
    date: "",
    startTime: "09:00",
    endTime: "18:00",
    location: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openForm() {
    setForm({ employeeId: "", date: "", startTime: "09:00", endTime: "18:00", location: "" });
    setError(null);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.date) return setError("Please choose a date.");
    if (!form.startTime || !form.endTime) return setError("Please set start and end times.");
    if (isStaff && !form.employeeId) return setError("Please choose an employee.");
    setSubmitting(true);
    try {
      await api.post("/attendance/shifts", {
        employeeId: form.employeeId ? Number(form.employeeId) : undefined,
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        location: form.location || undefined,
      });
      setOpen(false);
      shifts.reload();
    } catch (err: any) {
      setError(err?.message ?? "Could not add the shift.");
    } finally {
      setSubmitting(false);
    }
  }

  const columns: Column<Shift>[] = [
    { key: "emp", header: "Employee", render: (s) => empName(s.employee) },
    { key: "date", header: "Date", render: (s) => fmtDate(s.date) },
    {
      key: "time",
      header: "Shift",
      render: (s) => (
        <span className="num whitespace-nowrap">
          {s.startTime} <span className="text-ink-muted">–</span> {s.endTime}
        </span>
      ),
    },
    { key: "loc", header: "Location", render: (s) => s.location || <span className="text-ink-muted">—</span> },
  ];

  if (!hasEmp) {
    return (
      <EmptyState
        title="No employee profile linked"
        message="This account is not linked to an employee record."
      />
    );
  }

  return (
    <div>
      <Section
        title="Shift Roster"
        actions={
          <div className="flex items-center gap-2">
            {isStaff && (
              <div className="flex gap-1">
                <TabPill active={scope === "mine"} onClick={() => setScope("mine")}>
                  Mine
                </TabPill>
                <TabPill active={scope === "all"} onClick={() => setScope("all")}>
                  Everyone
                </TabPill>
              </div>
            )}
            <Button size="sm" onClick={openForm}>
              Add Shift
            </Button>
          </div>
        }
      >
        <Async state={shifts}>
          {(list) => (
            <DataTable columns={columns} data={list} rowKey={(s) => s.id} empty="No shifts scheduled." />
          )}
        </Async>
      </Section>

      <Modal
        open={open}
        onClose={() => (submitting ? undefined : setOpen(false))}
        title="Add Shift"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" form="add-shift-form" disabled={submitting}>
              {submitting ? "Saving…" : "Add Shift"}
            </Button>
          </>
        }
      >
        <form id="add-shift-form" onSubmit={submit} className="space-y-4">
          {error && (
            <p className="rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">{error}</p>
          )}
          {isStaff ? (
            <Field label="Employee">
              <Async state={employees}>
                {(list) => (
                  <Select
                    value={form.employeeId}
                    onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                    required
                  >
                    <option value="">Select an employee…</option>
                    {list.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.firstName} {emp.lastName} ({emp.employeeNo})
                      </option>
                    ))}
                  </Select>
                )}
              </Async>
            </Field>
          ) : (
            <Field label="Employee" hint="Shifts you add apply to your own roster.">
              <Input value="Myself" disabled />
            </Field>
          )}
          <Field label="Date">
            <Input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start Time">
              <Input
                type="time"
                value={form.startTime}
                onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                required
              />
            </Field>
            <Field label="End Time">
              <Input
                type="time"
                value={form.endTime}
                onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                required
              />
            </Field>
          </div>
          <Field label="Location" hint="Optional — office, site or 'Remote'.">
            <Input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="e.g. HQ · Level 12"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}

// ---- Overtime tab ---------------------------------------------------------

function OvertimeTab({ isStaff, hasEmp }: { isStaff: boolean; hasEmp: boolean }) {
  const mine = useApi<OvertimeRequest[]>(() => api.get("/attendance/overtime?scope=mine"), []);
  const pending = useApi<OvertimeRequest[]>(
    () => (isStaff ? api.get("/attendance/overtime?scope=all&status=pending") : Promise.resolve([])),
    [isStaff]
  );

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ date: "", hours: "", reason: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);

  function openForm() {
    setForm({ date: "", hours: "", reason: "" });
    setError(null);
    setOpen(true);
  }

  function reloadAll() {
    mine.reload();
    pending.reload();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.date) return setError("Please choose a date.");
    const hours = Number(form.hours);
    if (!Number.isFinite(hours) || hours <= 0) return setError("Please enter a positive number of hours.");
    setSubmitting(true);
    try {
      await api.post("/attendance/overtime", {
        date: form.date,
        hours,
        reason: form.reason || undefined,
      });
      setOpen(false);
      reloadAll();
    } catch (err: any) {
      setError(err?.message ?? "Could not submit your request.");
    } finally {
      setSubmitting(false);
    }
  }

  async function decide(id: number, action: "approve" | "reject") {
    setBusyId(id);
    setDecideError(null);
    try {
      await api.post(`/attendance/overtime/${id}/${action}`);
      reloadAll();
    } catch (err: any) {
      setDecideError(err?.message ?? `Failed to ${action} overtime request`);
    } finally {
      setBusyId(null);
    }
  }

  const mineColumns: Column<OvertimeRequest>[] = [
    { key: "date", header: "Date", render: (r) => fmtDate(r.date) },
    { key: "hours", header: "Hours", className: "text-right", render: (r) => <span className="num">{num(r.hours, 2)}</span> },
    { key: "reason", header: "Reason", render: (r) => r.reason || <span className="text-ink-muted">—</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  const approvalColumns: Column<OvertimeRequest>[] = [
    { key: "emp", header: "Employee", render: (r) => empName(r.employee) },
    { key: "date", header: "Date", render: (r) => fmtDate(r.date) },
    { key: "hours", header: "Hours", className: "text-right", render: (r) => <span className="num">{num(r.hours, 2)}</span> },
    { key: "reason", header: "Reason", render: (r) => r.reason || <span className="text-ink-muted">—</span> },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (r) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" disabled={busyId === r.id} onClick={() => decide(r.id, "approve")}>
            Approve
          </Button>
          <Button variant="danger" size="sm" disabled={busyId === r.id} onClick={() => decide(r.id, "reject")}>
            Reject
          </Button>
        </div>
      ),
    },
  ];

  if (!hasEmp && !isStaff) {
    return (
      <EmptyState
        title="No employee profile linked"
        message="This account is not linked to an employee record, so overtime cannot be requested."
      />
    );
  }

  return (
    <div className="space-y-6">
      {decideError && <p className="text-sm font-medium text-bad">{decideError}</p>}
      {isStaff && (
        <Section title="Pending Approvals">
          <Async state={pending}>
            {(list) => (
              <DataTable
                columns={approvalColumns}
                data={list}
                rowKey={(r) => r.id}
                empty="No overtime requests awaiting your approval."
              />
            )}
          </Async>
        </Section>
      )}

      <Section
        title="My Overtime Requests"
        actions={
          hasEmp ? (
            <Button size="sm" onClick={openForm}>
              Request Overtime
            </Button>
          ) : undefined
        }
      >
        {hasEmp ? (
          <Async state={mine}>
            {(list) => (
              <DataTable
                columns={mineColumns}
                data={list}
                rowKey={(r) => r.id}
                empty="You have no overtime requests yet."
              />
            )}
          </Async>
        ) : (
          <EmptyState message="This account is not linked to an employee record." />
        )}
      </Section>

      <Modal
        open={open}
        onClose={() => (submitting ? undefined : setOpen(false))}
        title="Request Overtime"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" form="overtime-form" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit Request"}
            </Button>
          </>
        }
      >
        <form id="overtime-form" onSubmit={submit} className="space-y-4">
          {error && (
            <p className="rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">{error}</p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Date">
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
              />
            </Field>
            <Field label="Hours">
              <Input
                type="number"
                min="0"
                step="0.5"
                value={form.hours}
                onChange={(e) => setForm({ ...form, hours: e.target.value })}
                placeholder="e.g. 2"
                required
              />
            </Field>
          </div>
          <Field label="Reason" hint="Optional — why the extra hours were needed.">
            <Textarea
              rows={3}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="e.g. Month-end payroll close"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}

// ---- small local scope toggle ---------------------------------------------

function TabPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
        active ? "bg-teal-soft text-teal-dark" : "text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
