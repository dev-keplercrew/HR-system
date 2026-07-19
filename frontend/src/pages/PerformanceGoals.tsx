// Goals & Check-ins — the signed-in employee's performance goals as progress
// cards, with a "Set Goal" flow and per-goal check-ins. Any role.
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
  Input,
  Select,
  Textarea,
  Async,
  EmptyState,
  Modal,
} from "../components/ui";
import { titleCase, num } from "../lib/format";

interface Goal {
  id: number;
  employeeId: number;
  cycle: string;
  title: string;
  description: string | null;
  weight: number;
  progress: number;
  status: string;
}

const STATUSES = ["active", "achieved", "missed"];

function currentYear(): string {
  return String(new Date().getFullYear());
}

// Map goal status → progress-bar colour class.
function barTone(status: string, progress: number): string {
  if (status === "achieved") return "bg-good";
  if (status === "missed") return "bg-bad";
  if (progress >= 67) return "bg-teal";
  if (progress >= 34) return "bg-amber";
  return "bg-ink-muted";
}

export default function PerformanceGoals() {
  const { user } = useAuth();
  const goals = useApi<Goal[]>(() => api.get("/performance/goals?scope=mine"), []);

  const [setOpen, setSetOpen] = useState(false);
  const [checkGoal, setCheckGoal] = useState<Goal | null>(null);

  const hasEmp = user?.employeeId != null;

  return (
    <div>
      <PageHeader
        title="Goals & Check-ins"
        subtitle="Track your performance goals for the cycle and log progress check-ins."
        actions={
          hasEmp ? (
            <Button onClick={() => setSetOpen(true)}>+ Set Goal</Button>
          ) : undefined
        }
      />

      {!hasEmp ? (
        <EmptyState
          title="No employee profile linked"
          message="This account is not linked to an employee record, so it has no goals."
        />
      ) : (
        <Async state={goals}>
          {(list) => {
            const active = list.filter((g) => g.status === "active").length;
            const achieved = list.filter((g) => g.status === "achieved").length;
            const avgProgress = list.length
              ? Math.round(list.reduce((s, g) => s + g.progress, 0) / list.length)
              : 0;

            return (
              <>
                <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <StatCard label="Total Goals" value={list.length} sub="This cycle & prior" tone="teal" />
                  <StatCard label="Active" value={active} sub="In progress" tone="warn" />
                  <StatCard label="Achieved" value={achieved} sub="Completed goals" tone="good" />
                  <StatCard label="Avg Progress" value={`${avgProgress}%`} sub="Across all goals" tone="neutral" />
                </div>

                <Section title="My Goals">
                  {list.length === 0 ? (
                    <EmptyState
                      title="No goals yet"
                      message="Set your first goal for this cycle to start tracking progress."
                    />
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                      {list.map((g) => (
                        <div key={g.id} className="card-pad flex flex-col">
                          <div className="mb-2 flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-ink">{g.title}</p>
                              <p className="mt-0.5 text-xs text-ink-muted">
                                Cycle {g.cycle} · Weight {num(g.weight)}%
                              </p>
                            </div>
                            <StatusBadge status={g.status} />
                          </div>

                          {g.description && (
                            <p className="mb-3 text-sm text-ink-soft">{g.description}</p>
                          )}

                          <div className="mt-auto">
                            <div className="mb-1 flex items-center justify-between text-xs text-ink-muted">
                              <span>Progress</span>
                              <span className="num font-medium text-ink">{g.progress}%</span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-line">
                              <div
                                className={`h-full rounded-full transition-all ${barTone(g.status, g.progress)}`}
                                style={{ width: `${Math.min(100, Math.max(0, g.progress))}%` }}
                              />
                            </div>
                            <div className="mt-3 flex justify-end">
                              <Button variant="ghost" size="sm" onClick={() => setCheckGoal(g)}>
                                Check-in
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              </>
            );
          }}
        </Async>
      )}

      <SetGoalModal open={setOpen} onClose={() => setSetOpen(false)} onSaved={() => goals.reload()} />
      <CheckInModal goal={checkGoal} onClose={() => setCheckGoal(null)} onSaved={() => goals.reload()} />
    </div>
  );
}

// ---- Set Goal modal -------------------------------------------------------

function SetGoalModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [weight, setWeight] = useState("20");
  const [cycle, setCycle] = useState(currentYear());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setDescription("");
    setWeight("20");
    setCycle(currentYear());
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.post("/performance/goals", {
        title,
        description,
        weight: Number(weight),
        cycle,
      });
      reset();
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Failed to set goal");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Set a Goal"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="set-goal-form" disabled={saving}>
            {saving ? "Saving…" : "Set Goal"}
          </Button>
        </>
      }
    >
      <form id="set-goal-form" onSubmit={submit} className="space-y-4">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Ship the payroll module" required />
        </Field>
        <Field label="Description" hint="What does success look like?">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Describe the goal and how it will be measured."
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Weight (%)" hint="Relative importance">
            <Input type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(e.target.value)} />
          </Field>
          <Field label="Cycle">
            <Input value={cycle} onChange={(e) => setCycle(e.target.value)} placeholder={currentYear()} required />
          </Field>
        </div>
        {error && <p className="text-sm font-medium text-bad">{error}</p>}
      </form>
    </Modal>
  );
}

// ---- Check-in modal -------------------------------------------------------

function CheckInModal({
  goal,
  onClose,
  onSaved,
}: {
  goal: Goal | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("active");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track which goal the local state was seeded from so we re-seed on change.
  const [seededId, setSeededId] = useState<number | null>(null);

  if (goal && seededId !== goal.id) {
    setSeededId(goal.id);
    setProgress(goal.progress);
    setStatus(goal.status);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!goal) return;
    setError(null);
    setSaving(true);
    try {
      await api.put(`/performance/goals/${goal.id}`, { progress: Number(progress), status });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Failed to save check-in");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={goal != null}
      onClose={onClose}
      title={goal ? `Check-in · ${goal.title}` : "Check-in"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="checkin-form" disabled={saving}>
            {saving ? "Saving…" : "Save Check-in"}
          </Button>
        </>
      }
    >
      <form id="checkin-form" onSubmit={submit} className="space-y-4">
        <Field label={`Progress · ${progress}%`}>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
            className="w-full accent-teal"
          />
        </Field>
        <Field label="Progress value (%)">
          <Input
            type="number"
            min={0}
            max={100}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
          />
        </Field>
        <Field label="Status">
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
