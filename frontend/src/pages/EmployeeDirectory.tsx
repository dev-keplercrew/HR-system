// Employee Directory — searchable, filterable roster of the whole company.
// Rows link into the individual employee profile. HR/admin can add new hires.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useApi } from "../lib/useApi";
import {
  PageHeader, Section, StatCard, StatusBadge, DataTable, Async, Button, Modal,
  Field, Input, Select, type Column,
} from "../components/ui";
import { initials, titleCase } from "../lib/format";

interface Dept { id: number; name: string; code: string }
interface Emp {
  id: number;
  employeeNo: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  status: string;
  employmentType: string | null;
  department: Dept | null;
  departmentId: number | null;
}

const STATUSES = ["active", "probation", "on-leave", "resigned", "terminated"];
const ACTIVE_SET = new Set(["active", "probation", "on-leave"]);

export default function EmployeeDirectory() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const canManage = hasRole("admin", "hr");

  const emps = useApi<Emp[]>(() => api.get("/employees"), []);
  const depts = useApi<Dept[]>(() => api.get("/employees/meta/departments"), []);

  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [status, setStatus] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div>
      <PageHeader
        title="Employee Directory"
        subtitle="The people who make Meridian HR run."
        actions={
          canManage ? (
            <Button onClick={() => setShowAdd(true)}>+ Add Employee</Button>
          ) : undefined
        }
      />

      <Async state={emps}>
        {(list) => {
          const headcount = list.filter((e) => ACTIVE_SET.has(e.status)).length;

          const filtered = list.filter((e) => {
            if (dept && String(e.departmentId ?? "") !== dept) return false;
            if (status && e.status !== status) return false;
            if (q) {
              const hay = `${e.firstName} ${e.lastName} ${e.employeeNo} ${e.jobTitle ?? ""} ${e.department?.name ?? ""}`.toLowerCase();
              if (!hay.includes(q.toLowerCase())) return false;
            }
            return true;
          });

          const columns: Column<Emp>[] = [
            {
              key: "name",
              header: "Employee",
              render: (e) => (
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-soft text-xs font-semibold text-teal-dark">
                    {initials(e.firstName, e.lastName)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{e.firstName} {e.lastName}</p>
                    <p className="truncate text-xs text-ink-muted">{e.jobTitle ?? "—"}</p>
                  </div>
                </div>
              ),
            },
            { key: "employeeNo", header: "Employee No", render: (e) => <span className="num">{e.employeeNo}</span> },
            { key: "jobTitle", header: "Job Title", render: (e) => e.jobTitle ?? "—" },
            { key: "department", header: "Department", render: (e) => e.department?.name ?? "—" },
            { key: "status", header: "Status", render: (e) => <StatusBadge status={e.status} /> },
          ];

          return (
            <>
              <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard label="Headcount" value={headcount} sub={`${list.length} total records`} tone="teal" />
                <StatCard label="On Probation" value={list.filter((e) => e.status === "probation").length} sub="Pending confirmation" tone="warn" />
                <StatCard label="On Leave" value={list.filter((e) => e.status === "on-leave").length} sub="Currently away" tone="neutral" />
                <StatCard label="Departments" value={depts.data?.length ?? "—"} sub="Across the org" tone="good" />
              </div>

              <Section
                title={`Roster · ${filtered.length} shown`}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      placeholder="Search name, no, title…"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      className="w-52"
                    />
                    <Select value={dept} onChange={(e) => setDept(e.target.value)}>
                      <option value="">All departments</option>
                      {(depts.data ?? []).map((d) => (
                        <option key={d.id} value={String(d.id)}>{d.name}</option>
                      ))}
                    </Select>
                    <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                      <option value="">All statuses</option>
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{titleCase(s)}</option>
                      ))}
                    </Select>
                  </div>
                }
              >
                <DataTable
                  data={filtered}
                  rowKey={(e) => e.id}
                  columns={columns}
                  empty="No employees match your filters"
                  onRowClick={(e) => navigate(`/employees/${e.id}`)}
                />
              </Section>
            </>
          );
        }}
      </Async>

      {canManage && (
        <AddEmployeeModal
          open={showAdd}
          onClose={() => setShowAdd(false)}
          departments={depts.data ?? []}
          onCreated={() => {
            setShowAdd(false);
            emps.reload();
          }}
        />
      )}
    </div>
  );
}

const EMPLOYMENT_TYPES = ["full-time", "part-time", "contract", "intern"];
const PAYROLL_GROUPS = ["general", "executive", "management", "hourly"];
const WORK_PASS_TYPES = ["citizen", "pr", "ep", "sp", "wp"];

function AddEmployeeModal({
  open, onClose, departments, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  departments: Dept[];
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    employeeNo: "", firstName: "", lastName: "", email: "", jobTitle: "",
    departmentId: "", employmentType: "full-time", payrollGroup: "general",
    workPassType: "citizen", basicSalary: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit() {
    setError(null);
    if (!form.employeeNo.trim() || !form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) {
      setError("Employee No, first name, last name and email are required.");
      return;
    }
    setSaving(true);
    try {
      await api.post("/employees", {
        ...form,
        departmentId: form.departmentId ? Number(form.departmentId) : null,
        basicSalary: form.basicSalary ? Number(form.basicSalary) : 0,
      });
      onCreated();
      setForm({
        employeeNo: "", firstName: "", lastName: "", email: "", jobTitle: "",
        departmentId: "", employmentType: "full-time", payrollGroup: "general",
        workPassType: "citizen", basicSalary: "",
      });
    } catch (e: any) {
      setError(e?.message ?? "Failed to create employee");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Employee"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Create"}</Button>
        </>
      }
    >
      {error && <p className="mb-4 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Employee No">
          <Input value={form.employeeNo} onChange={(e) => set("employeeNo", e.target.value)} placeholder="EMP-0001" />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="name@company.com" />
        </Field>
        <Field label="First Name">
          <Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
        </Field>
        <Field label="Last Name">
          <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
        </Field>
        <Field label="Job Title">
          <Input value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} />
        </Field>
        <Field label="Department">
          <Select value={form.departmentId} onChange={(e) => set("departmentId", e.target.value)}>
            <option value="">Unassigned</option>
            {departments.map((d) => (
              <option key={d.id} value={String(d.id)}>{d.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Employment Type">
          <Select value={form.employmentType} onChange={(e) => set("employmentType", e.target.value)}>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>{titleCase(t)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Payroll Group">
          <Select value={form.payrollGroup} onChange={(e) => set("payrollGroup", e.target.value)}>
            {PAYROLL_GROUPS.map((t) => (
              <option key={t} value={t}>{titleCase(t)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Work Pass Type">
          <Select value={form.workPassType} onChange={(e) => set("workPassType", e.target.value)}>
            {WORK_PASS_TYPES.map((t) => (
              <option key={t} value={t}>{t.toUpperCase()}</option>
            ))}
          </Select>
        </Field>
        <Field label="Basic Salary (SGD)">
          <Input type="number" min="0" step="0.01" value={form.basicSalary} onChange={(e) => set("basicSalary", e.target.value)} placeholder="0.00" />
        </Field>
      </div>
    </Modal>
  );
}
