// Claims Submission — any employee submits expense/benefit claims, tracks their
// annual benefit balances and reviews the status of everything they've filed.
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
  EmptyState,
  Modal,
  type Column,
} from "../components/ui";
import { sgd, fmtDate } from "../lib/format";

interface ClaimType {
  id: number;
  name: string;
  code: string;
  annualCap: number;
}

interface Balance {
  claimType: { id: number; name: string; code: string };
  cap: number;
  used: number;
  remaining: number;
}

interface Claim {
  id: number;
  amount: number;
  claimDate: string;
  description: string | null;
  status: string;
  claimType?: { id: number; name: string; code: string };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ClaimsSubmission() {
  const { user } = useAuth();
  const hasEmp = user?.employeeId != null;

  const types = useApi<ClaimType[]>(() => api.get("/claims/types"), []);
  const balances = useApi<Balance[]>(() => (hasEmp ? api.get("/claims/balances?scope=mine") : Promise.resolve([])), [hasEmp]);
  const claims = useApi<Claim[]>(() => (hasEmp ? api.get("/claims?scope=mine") : Promise.resolve([])), [hasEmp]);

  const [open, setOpen] = useState(false);
  const [claimTypeId, setClaimTypeId] = useState("");
  const [amount, setAmount] = useState("");
  const [claimDate, setClaimDate] = useState(today());
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function resetForm() {
    setClaimTypeId("");
    setAmount("");
    setClaimDate(today());
    setDescription("");
    setFormError(null);
  }

  async function submitClaim(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!claimTypeId) {
      setFormError("Please choose a claim type.");
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setFormError("Amount must be greater than zero.");
      return;
    }
    setSaving(true);
    try {
      await api.post("/claims", {
        claimTypeId: Number(claimTypeId),
        amount: amt,
        claimDate,
        description: description.trim() || undefined,
      });
      setOpen(false);
      resetForm();
      claims.reload();
      balances.reload();
    } catch (err: any) {
      setFormError(err?.message ?? "Failed to submit claim");
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<Claim>[] = [
    { key: "type", header: "Type", render: (c) => <span className="font-medium text-ink">{c.claimType?.name ?? "—"}</span> },
    { key: "amount", header: "Amount", className: "text-right", render: (c) => <span className="num font-semibold">{sgd(c.amount)}</span> },
    { key: "date", header: "Claim Date", render: (c) => fmtDate(c.claimDate) },
    {
      key: "desc",
      header: "Description",
      render: (c) => <span className="text-ink-soft">{c.description || <span className="text-ink-muted">—</span>}</span>,
    },
    { key: "status", header: "Status", className: "text-right", render: (c) => <StatusBadge status={c.status} /> },
  ];

  if (!hasEmp) {
    return (
      <div>
        <PageHeader title="Claims & Benefits" />
        <EmptyState title="No employee profile linked" message="This account is not linked to an employee record, so claims cannot be submitted." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Claims & Benefits"
        subtitle="Submit expense claims and track your annual benefit balances."
        actions={<Button onClick={() => { resetForm(); setOpen(true); }}>Submit Claim</Button>}
      />

      {/* Benefit balances */}
      <Section title="Benefit Balances">
        <Async state={balances}>
          {(list) =>
            list.length ? (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {list.map((b) => {
                  const low = b.cap > 0 && b.remaining <= b.cap * 0.2;
                  return (
                    <StatCard
                      key={b.claimType.id}
                      label={b.claimType.name}
                      value={sgd(b.remaining)}
                      sub={`${sgd(b.used)} used · ${sgd(b.cap)} cap`}
                      tone={low ? "warn" : "teal"}
                    />
                  );
                })}
              </div>
            ) : (
              <EmptyState message="No benefit types configured." />
            )
          }
        </Async>
      </Section>

      {/* My claims */}
      <div className="mt-6">
        <Section title="My Claims">
          <Async state={claims}>
            {(list) => (
              <DataTable
                data={list}
                rowKey={(c) => c.id}
                empty="You haven't submitted any claims yet."
                columns={columns}
              />
            )}
          </Async>
        </Section>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Submit a Claim"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="claim-form" disabled={saving}>
              {saving ? "Submitting…" : "Submit Claim"}
            </Button>
          </>
        }
      >
        <form id="claim-form" onSubmit={submitClaim} className="space-y-4">
          <Field label="Claim Type">
            <Async state={types}>
              {(list) => (
                <Select value={claimTypeId} onChange={(e) => setClaimTypeId(e.target.value)} required>
                  <option value="">Select a claim type…</option>
                  {list.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.annualCap > 0 ? ` (cap ${sgd(t.annualCap)})` : ""}
                    </option>
                  ))}
                </Select>
              )}
            </Async>
          </Field>
          <Field label="Amount" hint="Claim amount in SGD">
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
            />
          </Field>
          <Field label="Claim Date">
            <Input type="date" value={claimDate} onChange={(e) => setClaimDate(e.target.value)} max={today()} required />
          </Field>
          <Field label="Description" hint="Optional — what was this claim for?">
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Client dinner, taxi fare, medical consultation…"
            />
          </Field>
          {formError && <p className="text-sm font-medium text-bad">{formError}</p>}
        </form>
      </Modal>
    </div>
  );
}
