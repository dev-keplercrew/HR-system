// Candidate Pipeline — a kanban view of applicants across the hiring stages.
// Managers/HR filter by stage and requisition, drag candidates forward via a
// per-card modal (move stage, schedule interviews, record evaluations, make an
// offer) and capture new applicants. Mutations reload from the source of truth.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { useApi } from "../lib/useApi";
import {
  PageHeader,
  StatusBadge,
  Badge,
  Button,
  Field,
  Input,
  Select,
  Textarea,
  Async,
  EmptyState,
  Modal,
} from "../components/ui";
import { fmtDateTime, titleCase } from "../lib/format";

interface Interview {
  id: number;
  candidateId: number;
  round: number;
  scheduledAt: string | null;
  interviewer: string | null;
  score: number | null;
  feedback: string | null;
  status: string;
}
interface RequisitionRef {
  id: number;
  title: string;
  department: string;
}
interface Candidate {
  id: number;
  requisitionId: number | null;
  name: string;
  email: string;
  phone: string | null;
  source: string | null;
  stage: string;
  createdAt: string;
  requisition: RequisitionRef | null;
  interviews: Interview[];
}

const STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected"] as const;
type Stage = (typeof STAGES)[number];

const STAGE_TONE: Record<Stage, string> = {
  applied: "border-t-ink-muted",
  screening: "border-t-amber",
  interview: "border-t-amber",
  offer: "border-t-teal",
  hired: "border-t-good",
  rejected: "border-t-bad",
};

const SOURCE_TONE: Record<string, "neutral" | "teal" | "good" | "warn" | "bad"> = {
  referral: "good",
  jobboard: "teal",
  agency: "warn",
  direct: "neutral",
};

export default function CandidatePipeline() {
  const { hasRole } = useAuth();
  const canManage = hasRole("admin", "hr", "manager");

  const [stageFilter, setStageFilter] = useState<string>("");
  const [reqFilter, setReqFilter] = useState<string>("");

  const requisitions = useApi<RequisitionRef[]>(() => api.get("/recruitment/requisitions"), []);
  const candidates = useApi<Candidate[]>(() => {
    const params = new URLSearchParams();
    if (reqFilter) params.set("requisitionId", reqFilter);
    if (stageFilter) params.set("stage", stageFilter);
    const qs = params.toString();
    return api.get(`/recruitment/candidates${qs ? `?${qs}` : ""}`);
  }, [stageFilter, reqFilter]);

  const [selected, setSelected] = useState<Candidate | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  if (!canManage) {
    return (
      <div>
        <PageHeader title="Candidate Pipeline" />
        <EmptyState title="Restricted" message="You do not have access to recruitment." />
      </div>
    );
  }

  const visibleStages: readonly Stage[] = stageFilter
    ? (STAGES.filter((s) => s === stageFilter) as Stage[])
    : STAGES;

  return (
    <div>
      <PageHeader
        title="Candidate Pipeline"
        subtitle="Track applicants from first contact through to offer."
        actions={
          <>
            <Link to="/recruitment" className="btn-ghost btn-sm">
              ← Requisitions
            </Link>
            <Button size="sm" onClick={() => setShowAdd(true)}>
              Add Candidate
            </Button>
          </>
        }
      />

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Field label="Stage">
            <Select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
              <option value="">All stages</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-64">
          <Field label="Requisition">
            <Async state={requisitions}>
              {(list) => (
                <Select value={reqFilter} onChange={(e) => setReqFilter(e.target.value)}>
                  <option value="">All requisitions</option>
                  {list.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title} · {r.department}
                    </option>
                  ))}
                </Select>
              )}
            </Async>
          </Field>
        </div>
        {(stageFilter || reqFilter) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setStageFilter("");
              setReqFilter("");
            }}
          >
            Clear
          </Button>
        )}
      </div>

      <Async state={candidates}>
        {(list) => {
          if (!list.length) {
            return <EmptyState title="No candidates" message="No applicants match these filters yet." />;
          }
          const byStage: Record<string, Candidate[]> = {};
          for (const s of STAGES) byStage[s] = [];
          for (const c of list) (byStage[c.stage] ??= []).push(c);

          return (
            <div className="flex gap-4 overflow-x-auto pb-4">
              {visibleStages.map((stage) => {
                const cards = byStage[stage] ?? [];
                return (
                  <div key={stage} className="flex w-72 flex-shrink-0 flex-col">
                    <div className="mb-3 flex items-center justify-between">
                      <StatusBadge status={stage} />
                      <span className="num text-xs font-medium text-ink-muted">{cards.length}</span>
                    </div>
                    <div className="space-y-3">
                      {cards.length === 0 && (
                        <div className="rounded-lg border border-dashed border-line py-6 text-center text-xs text-ink-muted">
                          Empty
                        </div>
                      )}
                      {cards.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setSelected(c)}
                          className={`w-full rounded-lg border border-line border-t-2 bg-surface p-3 text-left shadow-sm transition-shadow hover:shadow-pop ${STAGE_TONE[stage]}`}
                        >
                          <p className="font-medium text-ink">{c.name}</p>
                          <p className="truncate text-xs text-ink-muted">{c.email}</p>
                          <div className="mt-2 flex items-center gap-2">
                            {c.source && (
                              <Badge tone={SOURCE_TONE[c.source] ?? "neutral"}>{titleCase(c.source)}</Badge>
                            )}
                            {c.interviews.length > 0 && (
                              <span className="text-xs text-ink-muted">
                                {c.interviews.length} interview{c.interviews.length > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        }}
      </Async>

      {selected && (
        <CandidateModal
          candidate={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            candidates.reload();
            // Optimistically close-and-reopen not needed; refetch full list and
            // resync the selected candidate from fresh data.
            api
              .get<Candidate[]>(`/recruitment/candidates`)
              .then((fresh) => {
                const next = fresh.find((c) => c.id === selected.id);
                if (next) setSelected(next);
              })
              .catch(() => null);
          }}
        />
      )}

      <AddCandidateModal
        open={showAdd}
        requisitions={requisitions.data ?? []}
        onClose={() => setShowAdd(false)}
        onCreated={() => {
          setShowAdd(false);
          candidates.reload();
        }}
      />
    </div>
  );
}

// ---- candidate detail modal ----------------------------------------------

function CandidateModal({
  candidate,
  onClose,
  onChanged,
}: {
  candidate: Candidate;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // move-stage form
  const [stage, setStage] = useState(candidate.stage);

  // schedule-interview form
  const [round, setRound] = useState(String((candidate.interviews.at(-1)?.round ?? 0) + 1));
  const [scheduledAt, setScheduledAt] = useState("");
  const [interviewer, setInterviewer] = useState("");

  async function guard(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onChanged();
    } catch (e: any) {
      setErr(e?.message ?? "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const moveStage = () =>
    guard(async () => {
      await api.put(`/recruitment/candidates/${candidate.id}`, { stage });
    });

  const makeOffer = () =>
    guard(async () => {
      await api.post(`/recruitment/candidates/${candidate.id}/offer`);
    });

  const scheduleInterview = () =>
    guard(async () => {
      await api.post(`/recruitment/candidates/${candidate.id}/interviews`, {
        round: Number(round),
        scheduledAt: new Date(scheduledAt).toISOString(),
        interviewer: interviewer.trim(),
      });
      setScheduledAt("");
      setInterviewer("");
    });

  return (
    <Modal
      open
      onClose={onClose}
      title={candidate.name}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-5">
        {err && <p className="text-sm text-bad">{err}</p>}

        {/* details */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Detail label="Email" value={candidate.email} />
          <Detail label="Phone" value={candidate.phone ?? "—"} />
          <Detail
            label="Source"
            value={candidate.source ? titleCase(candidate.source) : "—"}
          />
          <Detail label="Stage" value={<StatusBadge status={candidate.stage} />} />
          <Detail
            label="Requisition"
            value={candidate.requisition ? candidate.requisition.title : "Unassigned"}
          />
        </dl>

        {/* move stage + offer */}
        <div className="rounded-lg border border-line p-3">
          <p className="field-label mb-2">Move stage</p>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Select value={stage} onChange={(e) => setStage(e.target.value)}>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </Select>
            </div>
            <Button size="sm" disabled={busy || stage === candidate.stage} onClick={moveStage}>
              Update
            </Button>
            <Button size="sm" variant="ghost" disabled={busy || candidate.stage === "offer"} onClick={makeOffer}>
              Make Offer
            </Button>
          </div>
        </div>

        {/* schedule interview */}
        <div className="rounded-lg border border-line p-3">
          <p className="field-label mb-2">Schedule interview</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Round">
              <Input type="number" min={1} value={round} onChange={(e) => setRound(e.target.value)} />
            </Field>
            <Field label="Interviewer">
              <Input
                value={interviewer}
                onChange={(e) => setInterviewer(e.target.value)}
                placeholder="Name"
              />
            </Field>
            <div className="col-span-2">
              <Field label="Date & time">
                <Input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </Field>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button size="sm" disabled={busy || !scheduledAt} onClick={scheduleInterview}>
              Schedule
            </Button>
          </div>
        </div>

        {/* interview list + evaluations */}
        <div>
          <p className="field-label mb-2">Interviews</p>
          {candidate.interviews.length === 0 ? (
            <p className="py-3 text-center text-sm text-ink-muted">No interviews scheduled.</p>
          ) : (
            <div className="space-y-3">
              {candidate.interviews.map((iv) => (
                <InterviewRow key={iv.id} interview={iv} busy={busy} onSave={guard} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function InterviewRow({
  interview,
  busy,
  onSave,
}: {
  interview: Interview;
  busy: boolean;
  onSave: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [score, setScore] = useState(interview.score != null ? String(interview.score) : "");
  const [feedback, setFeedback] = useState(interview.feedback ?? "");
  const [complete, setComplete] = useState(interview.status === "completed");

  const save = () =>
    onSave(async () => {
      await api.put(`/recruitment/interviews/${interview.id}`, {
        score: score === "" ? null : Number(score),
        feedback: feedback.trim(),
        status: complete ? "completed" : interview.status,
      });
    });

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink">Round {interview.round}</span>
          <StatusBadge status={interview.status} />
        </div>
        <span className="text-xs text-ink-muted">
          {interview.scheduledAt ? fmtDateTime(interview.scheduledAt) : "—"}
        </span>
      </div>
      {interview.interviewer && (
        <p className="mb-2 text-xs text-ink-muted">Interviewer: {interview.interviewer}</p>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Score (1–5)">
          <Select value={score} onChange={(e) => setScore(e.target.value)}>
            <option value="">—</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <div className="col-span-2 flex items-end">
          <label className="flex items-center gap-2 pb-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={complete}
              onChange={(e) => setComplete(e.target.checked)}
            />
            Mark completed
          </label>
        </div>
      </div>
      <div className="mt-3">
        <Field label="Feedback">
          <Textarea
            rows={2}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Evaluation notes…"
          />
        </Field>
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" disabled={busy} onClick={save}>
          Save evaluation
        </Button>
      </div>
    </div>
  );
}

// ---- add candidate modal --------------------------------------------------

function AddCandidateModal({
  open,
  requisitions,
  onClose,
  onCreated,
}: {
  open: boolean;
  requisitions: RequisitionRef[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [requisitionId, setRequisitionId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setRequisitionId("");
    setName("");
    setEmail("");
    setPhone("");
    setSource("");
    setErr(null);
  }

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      await api.post("/recruitment/candidates", {
        requisitionId: requisitionId || null,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        source: source || null,
      });
      reset();
      onCreated();
    } catch (e: any) {
      setErr(e?.message ?? "Could not add candidate");
    } finally {
      setSaving(false);
    }
  }

  const valid = name.trim() && email.trim();

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Add Candidate"
      footer={
        <>
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || saving}>
            {saving ? "Adding…" : "Add Candidate"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {err && <p className="text-sm text-bad">{err}</p>}
        <Field label="Requisition" hint="Optional — link to an open req.">
          <Select value={requisitionId} onChange={(e) => setRequisitionId(e.target.value)}>
            <option value="">Unassigned</option>
            {requisitions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title} · {r.department}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Full Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Candidate name" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
        <Field label="Source">
          <Select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">—</option>
            <option value="referral">Referral</option>
            <option value="jobboard">Job Board</option>
            <option value="agency">Agency</option>
            <option value="direct">Direct</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 font-medium text-ink">{value}</dd>
    </div>
  );
}
