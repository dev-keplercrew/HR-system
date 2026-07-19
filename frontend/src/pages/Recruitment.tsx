// Recruitment — Manpower Requisitions. Managers/HR raise headcount requests and
// drive each through the draft → approved → posted → closed workflow. Candidate
// counts are surfaced inline; the pipeline itself lives on CandidatePipeline.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { useApi } from "../lib/useApi";
import {
  PageHeader,
  Section,
  StatCard,
  StatusBadge,
  Button,
  Field,
  Input,
  Textarea,
  DataTable,
  type Column,
  Async,
  EmptyState,
  Modal,
} from "../components/ui";
import { fmtDate } from "../lib/format";

interface Requisition {
  id: number;
  title: string;
  department: string;
  headcount: number;
  status: string;
  justification: string | null;
  approverId: number | null;
  createdAt: string;
  _count?: { candidates: number };
}

const OPEN_STATUSES = ["draft", "approved", "posted"];

export default function Recruitment() {
  const { hasRole } = useAuth();
  const canManage = hasRole("admin", "hr", "manager");

  const reqs = useApi<Requisition[]>(() => api.get("/recruitment/requisitions"), []);

  const [showNew, setShowNew] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canManage) {
    return (
      <div>
        <PageHeader title="Manpower Requisitions" />
        <EmptyState title="Restricted" message="You do not have access to recruitment." />
      </div>
    );
  }

  async function runAction(id: number, action: string) {
    setBusyId(id);
    setError(null);
    try {
      await api.post(`/recruitment/requisitions/${id}/${action}`);
      reqs.reload();
    } catch (e: any) {
      setError(e?.message ?? "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<Requisition>[] = [
    {
      key: "title",
      header: "Position",
      render: (r) => (
        <div>
          <p className="font-medium text-ink">{r.title}</p>
          {r.justification && (
            <p className="mt-0.5 max-w-xs truncate text-xs text-ink-muted">{r.justification}</p>
          )}
        </div>
      ),
    },
    { key: "department", header: "Department", render: (r) => r.department },
    {
      key: "headcount",
      header: "Headcount",
      className: "text-right",
      render: (r) => <span className="num">{r.headcount}</span>,
    },
    {
      key: "candidates",
      header: "Candidates",
      className: "text-right",
      render: (r) => <span className="num">{r._count?.candidates ?? 0}</span>,
    },
    { key: "raised", header: "Raised", render: (r) => fmtDate(r.createdAt) },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "actions",
      header: "",
      className: "text-right whitespace-nowrap",
      render: (r) => {
        const busy = busyId === r.id;
        return (
          <div className="flex justify-end gap-1.5">
            {r.status === "draft" && (
              <Button size="sm" disabled={busy} onClick={() => runAction(r.id, "approve")}>
                Approve
              </Button>
            )}
            {r.status === "approved" && (
              <Button size="sm" disabled={busy} onClick={() => runAction(r.id, "post")}>
                Post
              </Button>
            )}
            {OPEN_STATUSES.includes(r.status) && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => runAction(r.id, "close")}>
                Close
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Manpower Requisitions"
        subtitle="Raise headcount requests and steer them through approval to posting."
        actions={
          <>
            <Link to="/recruitment/candidates" className="btn-ghost btn-sm">
              Candidate pipeline →
            </Link>
            <Button size="sm" onClick={() => setShowNew(true)}>
              New Requisition
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-bad/30 bg-bad/5 px-4 py-2 text-sm text-bad">
          {error}
        </div>
      )}

      <Async state={reqs}>
        {(list) => {
          const open = list.filter((r) => OPEN_STATUSES.includes(r.status)).length;
          const posted = list.filter((r) => r.status === "posted").length;
          const totalHeadcount = list
            .filter((r) => OPEN_STATUSES.includes(r.status))
            .reduce((sum, r) => sum + (r.headcount ?? 0), 0);

          return (
            <>
              <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard label="Open Requisitions" value={open} sub="Draft · approved · posted" tone="teal" />
                <StatCard label="Live Postings" value={posted} sub="Currently advertised" tone="good" />
                <StatCard label="Open Headcount" value={totalHeadcount} sub="Across open reqs" tone="warn" />
                <StatCard label="Total Requisitions" value={list.length} sub="All time" tone="neutral" />
              </div>

              <Section title="All Requisitions">
                <DataTable
                  data={list}
                  rowKey={(r) => r.id}
                  empty="No requisitions raised yet"
                  columns={columns}
                />
              </Section>
            </>
          );
        }}
      </Async>

      <NewRequisitionModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={() => {
          setShowNew(false);
          reqs.reload();
        }}
      />
    </div>
  );
}

function NewRequisitionModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [headcount, setHeadcount] = useState("1");
  const [justification, setJustification] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setDepartment("");
    setHeadcount("1");
    setJustification("");
    setErr(null);
  }

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      await api.post("/recruitment/requisitions", {
        title: title.trim(),
        department: department.trim(),
        headcount: Number(headcount),
        justification: justification.trim(),
      });
      reset();
      onCreated();
    } catch (e: any) {
      setErr(e?.message ?? "Could not create requisition");
    } finally {
      setSaving(false);
    }
  }

  const valid = title.trim() && department.trim() && Number(headcount) >= 1;

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="New Requisition"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || saving}>
            {saving ? "Creating…" : "Raise Requisition"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {err && <p className="text-sm text-bad">{err}</p>}
        <Field label="Position Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Senior Backend Engineer" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Department">
            <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Engineering" />
          </Field>
          <Field label="Headcount">
            <Input
              type="number"
              min={1}
              value={headcount}
              onChange={(e) => setHeadcount(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Justification" hint="Why this role is needed — helps approvers decide.">
          <Textarea
            rows={3}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Business case for this hire…"
          />
        </Field>
      </div>
    </Modal>
  );
}
