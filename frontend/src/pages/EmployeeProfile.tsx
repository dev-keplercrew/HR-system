// Employee Profile — the full record for one person, split into tabs:
// Profile, Employment History, Documents, Emergency Contacts, Qualifications.
// HR/admin can add and remove sub-entities; salary is masked for others.
import { type ReactNode, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useApi } from "../lib/useApi";
import {
  Section, StatusBadge, Badge, DataTable, Async, Button, Modal,
  Field, Input, Select, Textarea, Tabs, type Column,
} from "../components/ui";
import { sgd, fmtDate, fmtDateTime, initials, titleCase } from "../lib/format";

interface Dept { id: number; name: string; code: string }
interface HistoryRow { id: number; title: string; department: string | null; startDate: string; endDate: string | null; note: string | null }
interface DocRow { id: number; name: string; category: string; filePath: string; uploadedAt: string }
interface ContactRow { id: number; name: string; relationship: string; phone: string; email: string | null }
interface QualRow { id: number; title: string; institution: string | null; type: string; obtainedDate: string | null; expiryDate: string | null }
interface Emp {
  id: number;
  employeeNo: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  maritalStatus: string | null;
  nationality: string | null;
  nric: string | null;
  address: string | null;
  jobTitle: string | null;
  employmentType: string;
  payrollGroup: string;
  status: string;
  joinDate: string;
  confirmationDate: string | null;
  probationEndDate: string | null;
  contractEndDate: string | null;
  workPassType: string | null;
  workPassExpiry: string | null;
  basicSalary: number;
  bankName: string | null;
  bankAccount: string | null;
  department: Dept | null;
  manager: { id: number; firstName: string; lastName: string } | null;
  employmentHistory: HistoryRow[];
  documents: DocRow[];
  emergencyContacts: ContactRow[];
  qualifications: QualRow[];
}

const TABS = [
  { key: "profile", label: "Profile" },
  { key: "history", label: "Employment History" },
  { key: "documents", label: "Documents" },
  { key: "contacts", label: "Emergency Contacts" },
  { key: "qualifications", label: "Qualifications" },
];

export default function EmployeeProfile() {
  const { id } = useParams<{ id: string }>();
  const { hasRole } = useAuth();
  const canManage = hasRole("admin", "hr");
  // GET /employees/:id only ever returns this far for admin/hr, a manager
  // viewing their own direct report, or an employee viewing themselves — in
  // every one of those cases the API response already includes the real
  // basicSalary, so masking it for "manager" here was cosmetic only (visible
  // in DevTools regardless). Match the mask to what the API actually enforces.
  const canSeeSalary = hasRole("admin", "hr", "manager");

  const emp = useApi<Emp>(() => api.get(`/employees/${id}`), [id]);
  const [tab, setTab] = useState("profile");

  return (
    <div>
      <div className="mb-4">
        <Link to="/employees" className="text-sm font-medium text-teal-dark hover:underline">← Back to directory</Link>
      </div>

      <Async state={emp}>
        {(e) => (
          <>
            <div className="card-pad mb-6 flex flex-wrap items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-teal-soft text-xl font-semibold text-teal-dark">
                {initials(e.firstName, e.lastName)}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="font-display text-2xl font-semibold text-ink">{e.firstName} {e.lastName}</h1>
                <p className="text-sm text-ink-muted">
                  {e.jobTitle ?? "—"}{e.department ? ` · ${e.department.name}` : ""} · <span className="num">{e.employeeNo}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={e.status} />
                <Badge tone="neutral">{titleCase(e.employmentType)}</Badge>
              </div>
            </div>

            <Tabs tabs={TABS} active={tab} onChange={setTab} />

            {tab === "profile" && <ProfileTab e={e} canSeeSalary={canSeeSalary} />}
            {tab === "history" && <HistoryTab e={e} canManage={canManage} reload={emp.reload} />}
            {tab === "documents" && <DocumentsTab e={e} canManage={canManage} reload={emp.reload} />}
            {tab === "contacts" && <ContactsTab e={e} canManage={canManage} reload={emp.reload} />}
            {tab === "qualifications" && <QualificationsTab e={e} canManage={canManage} reload={emp.reload} />}
          </>
        )}
      </Async>
    </div>
  );
}

// ---- Profile tab ----------------------------------------------------------

function ProfileTab({ e, canSeeSalary }: { e: Emp; canSeeSalary: boolean }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Personal Details">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Row label="Email" value={e.email} />
          <Row label="Phone" value={e.phone ?? "—"} />
          <Row label="Date of Birth" value={fmtDate(e.dateOfBirth)} />
          <Row label="Gender" value={titleCase(e.gender)} />
          <Row label="Marital Status" value={titleCase(e.maritalStatus)} />
          <Row label="Nationality" value={e.nationality ?? "—"} />
          <Row label="NRIC / FIN" value={e.nric ?? "—"} />
          <Row label="Address" value={e.address ?? "—"} full />
        </dl>
      </Section>

      <Section title="Employment">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Row label="Job Title" value={e.jobTitle ?? "—"} />
          <Row label="Department" value={e.department?.name ?? "—"} />
          <Row label="Manager" value={e.manager ? `${e.manager.firstName} ${e.manager.lastName}` : "—"} />
          <Row label="Employment Type" value={titleCase(e.employmentType)} />
          <Row label="Payroll Group" value={titleCase(e.payrollGroup)} />
          <Row label="Status" value={<StatusBadge status={e.status} />} />
          <Row label="Join Date" value={fmtDate(e.joinDate)} />
          <Row label="Confirmation Date" value={fmtDate(e.confirmationDate)} />
          <Row label="Probation End" value={fmtDate(e.probationEndDate)} />
          <Row label="Contract End" value={fmtDate(e.contractEndDate)} />
        </dl>
      </Section>

      <Section title="Work Pass & Payroll">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Row label="Work Pass Type" value={e.workPassType ? e.workPassType.toUpperCase() : "—"} />
          <Row label="Work Pass Expiry" value={fmtDate(e.workPassExpiry)} />
          <Row
            label="Basic Salary"
            value={canSeeSalary ? <span className="num font-semibold">{sgd(e.basicSalary)}</span> : <span className="text-ink-muted">••••••</span>}
          />
          <Row label="Bank Name" value={e.bankName ?? "—"} />
          <Row label="Bank Account" value={e.bankAccount ?? "—"} />
        </dl>
      </Section>
    </div>
  );
}

function Row({ label, value, full }: { label: string; value: ReactNode; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  );
}

// ---- Employment History tab ----------------------------------------------

function HistoryTab({ e, canManage, reload }: { e: Emp; canManage: boolean; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const columns: Column<HistoryRow>[] = [
    { key: "title", header: "Title", render: (r) => <span className="font-medium text-ink">{r.title}</span> },
    { key: "department", header: "Department", render: (r) => r.department ?? "—" },
    { key: "period", header: "Period", render: (r) => `${fmtDate(r.startDate)} – ${r.endDate ? fmtDate(r.endDate) : "Present"}` },
    { key: "note", header: "Note", render: (r) => r.note ?? "—" },
  ];
  if (canManage) columns.push(deleteColumn((r) => api.del(`/employees/${e.id}/history/${r.id}`), reload));

  return (
    <Section
      title="Employment History"
      actions={canManage ? <Button size="sm" onClick={() => setOpen(true)}>+ Add</Button> : undefined}
    >
      <DataTable data={e.employmentHistory} rowKey={(r) => r.id} columns={columns} empty="No employment history recorded" />
      {canManage && (
        <AddModal
          open={open}
          onClose={() => setOpen(false)}
          title="Add History Entry"
          fields={[
            { name: "title", label: "Title", required: true },
            { name: "department", label: "Department" },
            { name: "startDate", label: "Start Date", type: "date", required: true },
            { name: "endDate", label: "End Date", type: "date" },
            { name: "note", label: "Note", type: "textarea" },
          ]}
          submit={(body) => api.post(`/employees/${e.id}/history`, body)}
          onDone={() => { setOpen(false); reload(); }}
        />
      )}
    </Section>
  );
}

// ---- Documents tab --------------------------------------------------------

const DOC_CATEGORIES = ["contract", "id", "certificate", "payslip", "general"];

function DocumentsTab({ e, canManage, reload }: { e: Emp; canManage: boolean; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const columns: Column<DocRow>[] = [
    { key: "name", header: "Name", render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: "category", header: "Category", render: (r) => <Badge tone="neutral">{titleCase(r.category)}</Badge> },
    { key: "filePath", header: "Path", render: (r) => <span className="text-xs text-ink-muted">{r.filePath}</span> },
    { key: "uploadedAt", header: "Uploaded", render: (r) => fmtDateTime(r.uploadedAt) },
  ];
  if (canManage) columns.push(deleteColumn((r) => api.del(`/employees/${e.id}/documents/${r.id}`), reload));

  return (
    <Section
      title="Documents"
      actions={canManage ? <Button size="sm" onClick={() => setOpen(true)}>+ Add</Button> : undefined}
    >
      <DataTable data={e.documents} rowKey={(r) => r.id} columns={columns} empty="No documents on file" />
      {canManage && (
        <AddModal
          open={open}
          onClose={() => setOpen(false)}
          title="Add Document"
          fields={[
            { name: "name", label: "Name", required: true },
            { name: "category", label: "Category", type: "select", options: DOC_CATEGORIES, defaultValue: "general" },
            { name: "filePath", label: "File Path", hint: "Leave blank to auto-generate a placeholder path." },
          ]}
          submit={(body) => api.post(`/employees/${e.id}/documents`, body)}
          onDone={() => { setOpen(false); reload(); }}
        />
      )}
    </Section>
  );
}

// ---- Emergency Contacts tab ----------------------------------------------

function ContactsTab({ e, canManage, reload }: { e: Emp; canManage: boolean; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const columns: Column<ContactRow>[] = [
    { key: "name", header: "Name", render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: "relationship", header: "Relationship", render: (r) => titleCase(r.relationship) },
    { key: "phone", header: "Phone", render: (r) => <span className="num">{r.phone}</span> },
    { key: "email", header: "Email", render: (r) => r.email ?? "—" },
  ];
  if (canManage) columns.push(deleteColumn((r) => api.del(`/employees/${e.id}/contacts/${r.id}`), reload));

  return (
    <Section
      title="Emergency Contacts"
      actions={canManage ? <Button size="sm" onClick={() => setOpen(true)}>+ Add</Button> : undefined}
    >
      <DataTable data={e.emergencyContacts} rowKey={(r) => r.id} columns={columns} empty="No emergency contacts" />
      {canManage && (
        <AddModal
          open={open}
          onClose={() => setOpen(false)}
          title="Add Emergency Contact"
          fields={[
            { name: "name", label: "Name", required: true },
            { name: "relationship", label: "Relationship", required: true },
            { name: "phone", label: "Phone", required: true },
            { name: "email", label: "Email", type: "email" },
          ]}
          submit={(body) => api.post(`/employees/${e.id}/contacts`, body)}
          onDone={() => { setOpen(false); reload(); }}
        />
      )}
    </Section>
  );
}

// ---- Qualifications tab ---------------------------------------------------

const QUAL_TYPES = ["qualification", "certification"];

function QualificationsTab({ e, canManage, reload }: { e: Emp; canManage: boolean; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const columns: Column<QualRow>[] = [
    { key: "title", header: "Title", render: (r) => <span className="font-medium text-ink">{r.title}</span> },
    { key: "institution", header: "Institution", render: (r) => r.institution ?? "—" },
    { key: "type", header: "Type", render: (r) => <Badge tone={r.type === "certification" ? "teal" : "neutral"}>{titleCase(r.type)}</Badge> },
    { key: "obtainedDate", header: "Obtained", render: (r) => fmtDate(r.obtainedDate) },
    { key: "expiryDate", header: "Expiry", render: (r) => fmtDate(r.expiryDate) },
  ];
  if (canManage) columns.push(deleteColumn((r) => api.del(`/employees/${e.id}/qualifications/${r.id}`), reload));

  return (
    <Section
      title="Qualifications & Certifications"
      actions={canManage ? <Button size="sm" onClick={() => setOpen(true)}>+ Add</Button> : undefined}
    >
      <DataTable data={e.qualifications} rowKey={(r) => r.id} columns={columns} empty="No qualifications recorded" />
      {canManage && (
        <AddModal
          open={open}
          onClose={() => setOpen(false)}
          title="Add Qualification"
          fields={[
            { name: "title", label: "Title", required: true },
            { name: "institution", label: "Institution" },
            { name: "type", label: "Type", type: "select", options: QUAL_TYPES, defaultValue: "qualification" },
            { name: "obtainedDate", label: "Obtained Date", type: "date" },
            { name: "expiryDate", label: "Expiry Date", type: "date" },
          ]}
          submit={(body) => api.post(`/employees/${e.id}/qualifications`, body)}
          onDone={() => { setOpen(false); reload(); }}
        />
      )}
    </Section>
  );
}

// ---- shared: delete-action column ----------------------------------------

function deleteColumn<T extends { id: number }>(del: (row: T) => Promise<unknown>, reload: () => void): Column<T> {
  return {
    key: "_actions",
    header: "",
    className: "text-right",
    render: (row) => (
      <Button
        variant="danger"
        size="sm"
        onClick={async () => {
          if (!confirm("Delete this record?")) return;
          try {
            await del(row);
            reload();
          } catch (err: any) {
            alert(err?.message ?? "Failed to delete");
          }
        }}
      >
        Delete
      </Button>
    ),
  };
}

// ---- shared: generic add modal -------------------------------------------

interface FieldDef {
  name: string;
  label: string;
  type?: "text" | "email" | "date" | "textarea" | "select";
  required?: boolean;
  options?: string[];
  defaultValue?: string;
  hint?: string;
}

function AddModal({
  open, onClose, title, fields, submit, onDone,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  fields: FieldDef[];
  submit: (body: Record<string, string>) => Promise<unknown>;
  onDone: () => void;
}) {
  const initial = () => Object.fromEntries(fields.map((f) => [f.name, f.defaultValue ?? ""]));
  const [form, setForm] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    for (const f of fields) {
      if (f.required && !String(form[f.name] ?? "").trim()) {
        setError(`${f.label} is required.`);
        return;
      }
    }
    setSaving(true);
    try {
      await submit(form);
      setForm(initial());
      onDone();
    } catch (e: any) {
      setError(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function set(name: string, v: string) {
    setForm((f) => ({ ...f, [name]: v }));
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      {error && <p className="mb-4 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.name} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
            <Field label={f.label} hint={f.hint}>
              {f.type === "textarea" ? (
                <Textarea value={form[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)} rows={3} />
              ) : f.type === "select" ? (
                <Select value={form[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)}>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>{titleCase(o)}</option>
                  ))}
                </Select>
              ) : (
                <Input
                  type={f.type === "date" ? "date" : f.type === "email" ? "email" : "text"}
                  value={form[f.name] ?? ""}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              )}
            </Field>
          </div>
        ))}
      </div>
    </Modal>
  );
}
