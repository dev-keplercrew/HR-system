// Reviews & Ratings — manager/HR/admin console for opening performance reviews
// and recording ratings across the review lifecycle. Route-guarded to MGR roles.
import { useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useApi } from "../lib/useApi";
import {
  PageHeader,
  Section,
  StatCard,
  Button,
  Field,
  Input,
  Select,
  Textarea,
  DataTable,
  StatusBadge,
  Async,
  Modal,
  Tabs,
  type Column,
} from "../components/ui";
import { titleCase } from "../lib/format";

interface EmployeeLite {
  id: number;
  firstName: string;
  lastName: string;
  employeeNo: string;
  department?: { name: string } | null;
}

interface Review {
  id: number;
  employeeId: number;
  cycle: string;
  stage: string;
  rating: number | null;
  comments: string | null;
  status: string;
  reviewerId: number | null;
  employee?: EmployeeLite | null;
}

const STAGES = ["confirmation", "mid-year", "year-end"];
const STATUSES = ["draft", "submitted", "finalised"];

function currentYear(): string {
  return String(new Date().getFullYear());
}

// Render a 1..5 rating as filled/empty stars.
function Stars({ rating }: { rating: number | null }) {
  if (rating == null) return <span className="text-ink-muted">—</span>;
  const r = Math.max(0, Math.min(5, rating));
  return (
    <span className="text-amber" title={`${r} / 5`} aria-label={`${r} out of 5`}>
      {"★".repeat(r)}
      <span className="text-line">{"★".repeat(5 - r)}</span>
    </span>
  );
}

export default function PerformanceReview() {
  const { hasRole } = useAuth();
  const canAll = hasRole("admin", "hr");
  const [scope, setScope] = useState<"team" | "all">(canAll ? "all" : "team");

  const reviews = useApi<Review[]>(() => api.get(`/performance/reviews?scope=${scope}`), [scope]);
  const employees = useApi<EmployeeLite[]>(() => api.get("/employees"), []);

  const [newOpen, setNewOpen] = useState(false);
  const [rateReview, setRateReview] = useState<Review | null>(null);

  const columns: Column<Review>[] = [
    {
      key: "emp",
      header: "Employee",
      render: (r) =>
        r.employee ? (
          <span>
            <span className="font-medium text-ink">
              {r.employee.firstName} {r.employee.lastName}
            </span>
            <span className="ml-2 text-xs text-ink-muted">{r.employee.employeeNo}</span>
          </span>
        ) : (
          "—"
        ),
    },
    { key: "dept", header: "Department", render: (r) => r.employee?.department?.name ?? "—" },
    { key: "cycle", header: "Cycle", render: (r) => <span className="num">{r.cycle}</span> },
    { key: "stage", header: "Stage", render: (r) => titleCase(r.stage) },
    { key: "rating", header: "Rating", render: (r) => <Stars rating={r.rating} /> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "action",
      header: "",
      className: "text-right",
      render: (r) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setRateReview(r);
          }}
        >
          Rate
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Reviews & Ratings"
        subtitle="Open performance reviews and record ratings across the review cycle."
        actions={<Button onClick={() => setNewOpen(true)}>+ New Review</Button>}
      />

      <Async state={reviews}>
        {(list) => {
          const drafts = list.filter((r) => r.status === "draft").length;
          const submitted = list.filter((r) => r.status === "submitted").length;
          const finalised = list.filter((r) => r.status === "finalised").length;
          const rated = list.filter((r) => r.rating != null);
          const avg = rated.length
            ? (rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length).toFixed(1)
            : "—";

          return (
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Total Reviews" value={list.length} sub="In current view" tone="teal" />
              <StatCard label="In Draft" value={drafts} sub="Not yet submitted" tone="neutral" />
              <StatCard label="Awaiting Sign-off" value={submitted} sub="Submitted, not finalised" tone="warn" />
              <StatCard label="Avg Rating" value={avg} sub={`${finalised} finalised`} tone="good" />
            </div>
          );
        }}
      </Async>

      <Section title="Reviews">
        {canAll && (
          <Tabs
            tabs={[
              { key: "all", label: "All Reviews" },
              { key: "team", label: "My Team" },
            ]}
            active={scope}
            onChange={(k) => setScope(k as "team" | "all")}
          />
        )}
        <Async state={reviews}>
          {(list) => (
            <DataTable
              data={list}
              rowKey={(r) => r.id}
              empty="No reviews yet — open a new review to get started."
              columns={columns}
              onRowClick={(r) => setRateReview(r)}
            />
          )}
        </Async>
      </Section>

      <NewReviewModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        employees={employees.data ?? []}
        onSaved={() => reviews.reload()}
      />
      <RateReviewModal review={rateReview} onClose={() => setRateReview(null)} onSaved={() => reviews.reload()} />
    </div>
  );
}

// ---- New Review modal -----------------------------------------------------

function NewReviewModal({
  open,
  onClose,
  employees,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  employees: EmployeeLite[];
  onSaved: () => void;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [cycle, setCycle] = useState(currentYear());
  const [stage, setStage] = useState("confirmation");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!employeeId) {
      setError("Please select an employee");
      return;
    }
    setSaving(true);
    try {
      await api.post("/performance/reviews", { employeeId: Number(employeeId), cycle, stage });
      setEmployeeId("");
      setCycle(currentYear());
      setStage("confirmation");
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Failed to open review");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Review"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="new-review-form" disabled={saving}>
            {saving ? "Opening…" : "Open Review"}
          </Button>
        </>
      }
    >
      <form id="new-review-form" onSubmit={submit} className="space-y-4">
        <Field label="Employee">
          <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
            <option value="">Select an employee…</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.firstName} {emp.lastName} · {emp.employeeNo}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Cycle">
            <Input value={cycle} onChange={(e) => setCycle(e.target.value)} placeholder={currentYear()} required />
          </Field>
          <Field label="Stage">
            <Select value={stage} onChange={(e) => setStage(e.target.value)}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {error && <p className="text-sm font-medium text-bad">{error}</p>}
      </form>
    </Modal>
  );
}

// ---- Rate Review modal ----------------------------------------------------

function RateReviewModal({
  review,
  onClose,
  onSaved,
}: {
  review: Review | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rating, setRating] = useState("");
  const [comments, setComments] = useState("");
  const [stage, setStage] = useState("confirmation");
  const [status, setStatus] = useState("draft");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seededId, setSeededId] = useState<number | null>(null);

  if (review && seededId !== review.id) {
    setSeededId(review.id);
    setRating(review.rating != null ? String(review.rating) : "");
    setComments(review.comments ?? "");
    setStage(review.stage);
    setStatus(review.status);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!review) return;
    setError(null);
    setSaving(true);
    try {
      await api.put(`/performance/reviews/${review.id}`, {
        rating: rating === "" ? null : Number(rating),
        comments,
        stage,
        status,
      });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Failed to save review");
    } finally {
      setSaving(false);
    }
  }

  const name = review?.employee ? `${review.employee.firstName} ${review.employee.lastName}` : "";

  return (
    <Modal
      open={review != null}
      onClose={onClose}
      title={name ? `Rate · ${name}` : "Rate Review"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="rate-review-form" disabled={saving}>
            {saving ? "Saving…" : "Save Review"}
          </Button>
        </>
      }
    >
      <form id="rate-review-form" onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Rating">
            <Select value={rating} onChange={(e) => setRating(e.target.value)}>
              <option value="">Not rated</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {"★".repeat(n)} ({n})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Stage">
            <Select value={stage} onChange={(e) => setStage(e.target.value)}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Comments" hint="Feedback and rationale for the rating">
          <Textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            rows={4}
            placeholder="Strengths, areas to develop, and next steps."
          />
        </Field>
        <Field label="Status" hint="Draft → Submitted → Finalised">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
        </Field>
        {error && <p className="text-sm font-medium text-bad">{error}</p>}
      </form>
    </Modal>
  );
}
