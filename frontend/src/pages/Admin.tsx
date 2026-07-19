// Admin — Security & Governance console. Two tabs: user administration
// (create logins, change roles, activate/deactivate) and the immutable audit
// trail. Admin-only; guarded both at the route and here for defence in depth.
import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { useApi } from "../lib/useApi";
import {
  PageHeader,
  Section,
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
  Tabs,
  type Column,
  type Tone,
} from "../components/ui";
import { fmtDateTime, titleCase } from "../lib/format";

interface EmployeeLite {
  id: number;
  firstName: string;
  lastName: string;
  employeeNo: string;
}

interface AdminUser {
  id: number;
  email: string;
  role: string;
  active: boolean;
  createdAt: string;
  employee: EmployeeLite | null;
}

interface AuditRow {
  id: number;
  userId: number | null;
  action: string;
  entity: string;
  entityId: string | null;
  detail: string | null;
  createdAt: string;
  user?: { email: string; role: string } | null;
}

const ROLE_TONE: Record<string, Tone> = {
  admin: "bad",
  hr: "teal",
  manager: "warn",
  employee: "neutral",
};

const ROLES = ["admin", "hr", "manager", "employee"];

function RoleBadge({ role }: { role: string }) {
  return <Badge tone={ROLE_TONE[role] ?? "neutral"}>{titleCase(role)}</Badge>;
}

export default function Admin() {
  const { hasRole, user: me } = useAuth();
  const [tab, setTab] = useState("users");

  if (!hasRole("admin")) {
    return (
      <div>
        <PageHeader title="Administration" />
        <EmptyState title="Restricted" message="Administrator access is required for this area." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Administration"
        subtitle="Security & Governance — role-based access control & audit trail."
      />
      <Tabs
        tabs={[
          { key: "users", label: "Users" },
          { key: "audit", label: "Audit Log" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "users" ? <UsersTab meId={me?.id ?? null} /> : <AuditTab />}
    </div>
  );
}

// ---- Users tab ------------------------------------------------------------

function UsersTab({ meId }: { meId: number | null }) {
  const users = useApi<AdminUser[]>(() => api.get("/admin/users"), []);
  const employees = useApi<EmployeeLite[]>(() => api.get("/admin/employees-lite"), []);

  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  async function patchUser(id: number, data: { role?: string; active?: boolean }) {
    setBusyId(id);
    setRowError(null);
    try {
      await api.patch(`/admin/users/${id}`, data);
      users.reload();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<AdminUser>[] = [
    {
      key: "email",
      header: "User",
      render: (u) => (
        <div>
          <p className="font-medium text-ink">{u.email}</p>
          <p className="text-xs text-ink-muted">
            {u.employee ? `${u.employee.firstName} ${u.employee.lastName} · ${u.employee.employeeNo}` : "No employee link"}
          </p>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (u) => (
        <div className="flex items-center gap-2">
          <RoleBadge role={u.role} />
          <Select
            className="w-32"
            value={u.role}
            disabled={busyId === u.id}
            onChange={(e) => patchUser(u.id, { role: e.target.value })}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{titleCase(r)}</option>
            ))}
          </Select>
        </div>
      ),
    },
    {
      key: "active",
      header: "Status",
      render: (u) => <StatusBadge status={u.active ? "active" : "inactive"} />,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (u) => (
        <Button
          size="sm"
          variant={u.active ? "danger" : "ghost"}
          disabled={busyId === u.id || u.id === meId}
          title={u.id === meId ? "You cannot deactivate your own account" : undefined}
          onClick={() => patchUser(u.id, { active: !u.active })}
        >
          {busyId === u.id ? "…" : u.active ? "Deactivate" : "Activate"}
        </Button>
      ),
    },
  ];

  return (
    <>
      <Section
        title="Application Users"
        actions={<Button size="sm" onClick={() => setCreateOpen(true)}>New User</Button>}
      >
        {rowError && <p className="mb-3 text-sm text-bad">{rowError}</p>}
        <Async state={users}>
          {(list) => (
            <DataTable<AdminUser>
              data={list}
              columns={columns}
              rowKey={(u) => u.id}
              empty="No users yet."
            />
          )}
        </Async>
      </Section>

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        employees={employees.data ?? []}
        onCreated={() => {
          setCreateOpen(false);
          users.reload();
          employees.reload();
        }}
      />
    </>
  );
}

function CreateUserModal({
  open,
  onClose,
  employees,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  employees: EmployeeLite[];
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("employee");
  const [employeeId, setEmployeeId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEmail("");
    setPassword("");
    setRole("employee");
    setEmployeeId("");
    setError(null);
  }

  function close() {
    reset();
    onClose();
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.post("/admin/users", {
        email: email.trim(),
        password,
        role,
        employeeId: employeeId ? Number(employeeId) : undefined,
      });
      reset();
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create user.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="New User"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !email.trim() || password.length < 6}>
            {saving ? "Creating…" : "Create user"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <p className="text-sm text-bad">{error}</p>}
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@meridian.hr"
          />
        </Field>
        <Field label="Password" hint="Minimum 6 characters.">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>{titleCase(r)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Linked Employee" hint="Optional — link this login to an employee record.">
          <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">No link</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.firstName} {emp.lastName} ({emp.employeeNo})
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

// ---- Audit tab ------------------------------------------------------------

function AuditTab() {
  const logs = useApi<AuditRow[]>(() => api.get("/admin/audit"), []);

  const columns: Column<AuditRow>[] = [
    { key: "createdAt", header: "When", render: (l) => <span className="whitespace-nowrap">{fmtDateTime(l.createdAt)}</span> },
    {
      key: "actor",
      header: "Actor",
      render: (l) =>
        l.user ? (
          <div>
            <p className="text-ink">{l.user.email}</p>
            <p className="text-xs text-ink-muted">{titleCase(l.user.role)}</p>
          </div>
        ) : (
          <span className="text-ink-muted">System</span>
        ),
    },
    { key: "action", header: "Action", render: (l) => <code className="text-xs text-ink-soft">{l.action}</code> },
    {
      key: "entity",
      header: "Entity",
      render: (l) => (
        <span className="text-ink-soft">
          {l.entity}
          {l.entityId ? <span className="text-ink-muted"> #{l.entityId}</span> : null}
        </span>
      ),
    },
    { key: "detail", header: "Detail", render: (l) => <span className="text-sm text-ink-muted">{l.detail ?? "—"}</span> },
  ];

  return (
    <Section title="Audit Trail" actions={<span className="text-xs text-ink-muted">Latest 100 events</span>}>
      <Async state={logs}>
        {(list) => (
          <DataTable<AuditRow>
            data={list}
            columns={columns}
            rowKey={(l) => l.id}
            empty="No audit events recorded yet."
          />
        )}
      </Async>
    </Section>
  );
}
