// Bank Reconciliation — HR uploads a bank statement CSV for a payroll run and
// sees which credited amounts matched / didn't match the run's payslip net pay
// (demo simulation).
import { useRef, useState } from "react";
import { api } from "../api/client";
import { useApi } from "../lib/useApi";
import {
  PageHeader,
  Section,
  StatCard,
  Field,
  Select,
  DataTable,
  StatusBadge,
  Badge,
  Async,
  EmptyState,
  type Column,
} from "../components/ui";
import { sgd, fmtDateTime } from "../lib/format";

interface PayrollRun {
  id: number;
  period: string;
  payrollGroup: string;
  status: string;
  runDate: string;
  totalNet: number;
}

interface ReconcileLineResult {
  rawLine: string;
  amount: number;
  reference: string;
  matchedEmployeeId: number | null;
  matchedAmount: number | null;
  status: "matched" | "unmatched" | "amount-mismatch";
}

interface ReconcileSummary {
  matched: number;
  unmatched: number;
  amountMismatch: number;
  total: number;
}

interface ReconcileReport {
  bankStatementId: number;
  uploadedAt?: string;
  filename?: string;
  results: ReconcileLineResult[];
  summary: ReconcileSummary;
}

export default function PayrollReconciliation() {
  const runs = useApi<PayrollRun[]>(() => api.get("/payroll/runs"), []);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Latest saved report for the picked run (null if none uploaded yet). Tags
  // the result with the run id it was fetched for, so a run switch can't
  // render the PREVIOUS run's data under the new run's heading: useApi doesn't
  // clear `data` when `selectedId` changes, so without this tag `saved.data`
  // would still hold the old run's report until the new fetch resolves.
  const saved = useApi<{ forRunId: number; report: ReconcileReport | null } | null>(
    () =>
      selectedId != null
        ? api.get<ReconcileReport | null>(`/payroll/runs/${selectedId}/reconciliation`).then((report) => ({
            forRunId: selectedId,
            report,
          }))
        : Promise.resolve(null),
    [selectedId]
  );
  const savedForCurrentRun = saved.data && saved.data.forRunId === selectedId ? saved.data.report : null;

  // The report shown after a fresh upload takes precedence over the saved one.
  const [report, setReport] = useState<ReconcileReport | null>(null);
  const shown = report ?? savedForCurrentRun;

  function pickRun(id: number | null) {
    setSelectedId(id);
    setReport(null);
    setFormError(null);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || selectedId == null) return;
    setFormError(null);
    setUploading(true);
    try {
      const text = await file.text();
      const res = await api.post<ReconcileReport>(`/payroll/runs/${selectedId}/reconciliation`, {
        csv: text,
        filename: file.name,
      });
      setReport(res);
      saved.reload();
    } catch (err: any) {
      setFormError(err?.message ?? "Failed to reconcile bank statement");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const columns: Column<ReconcileLineResult>[] = [
    {
      key: "reference",
      header: "Reference",
      render: (r) => <span className="font-medium text-ink">{r.reference || "—"}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      className: "text-right",
      render: (r) => <span className="num">{sgd(r.amount)}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (r) =>
        r.status === "amount-mismatch" ? (
          <Badge tone="warn">Amount Mismatch</Badge>
        ) : (
          <StatusBadge status={r.status} />
        ),
    },
    {
      key: "matched",
      header: "Matched Net",
      className: "text-right",
      render: (r) => (
        <span className="num">{r.matchedAmount != null ? sgd(r.matchedAmount) : "—"}</span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Bank Reconciliation"
        subtitle="Upload a bank statement CSV to match credited amounts against each payslip's net pay."
      />

      <div className="mb-4 rounded-lg border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-ink-soft">
        <span className="font-semibold text-ink">⚠ Demo simulation.</span> Bank matching is a demo
        simulation, not a certified banking integration.
      </div>

      <div className="mb-6">
        <Section title="Select payroll run">
          <Async state={runs}>
            {(list) => (
              <div className="max-w-md">
                <Field label="Payroll run" hint="Pick a run to view or upload its bank statement.">
                  <Select
                    value={selectedId ?? ""}
                    onChange={(e) => pickRun(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Select a run…</option>
                    {list.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.period} · {r.payrollGroup} · {sgd(r.totalNet)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
          </Async>
        </Section>
      </div>

      {selectedId != null && (
        <>
          <div className="mb-6">
            <Section title="Upload bank statement">
              <div className="space-y-3">
                <p className="text-sm text-ink-muted">
                  CSV columns:{" "}
                  <span className="num text-ink-soft">reference,name,amount</span> (or{" "}
                  <span className="num text-ink-soft">reference,amount</span>). Each credited amount
                  is matched to a payslip's net pay.
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={onFile}
                  disabled={uploading}
                  className="block w-full text-sm text-ink-soft file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-teal file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-teal-dark disabled:opacity-60"
                />
                {uploading && <p className="text-sm text-ink-muted">Reconciling…</p>}
                {formError && <p className="text-sm font-medium text-bad">{formError}</p>}
              </div>
            </Section>
          </div>

          {shown ? (
            <>
              <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard label="Matched" value={shown.summary.matched} tone="good" />
                <StatCard label="Amount Mismatch" value={shown.summary.amountMismatch} tone="warn" />
                <StatCard label="Unmatched" value={shown.summary.unmatched} tone="bad" />
                <StatCard label="Total Lines" value={shown.summary.total} tone="neutral" />
              </div>

              <Section
                title="Reconciliation results"
                actions={
                  shown.filename || shown.uploadedAt ? (
                    <span className="text-xs text-ink-muted">
                      {shown.filename && <span className="num">{shown.filename}</span>}
                      {shown.uploadedAt && <span> · {fmtDateTime(shown.uploadedAt)}</span>}
                    </span>
                  ) : undefined
                }
              >
                <DataTable
                  data={shown.results}
                  rowKey={(r, i) => i}
                  empty="No lines in this statement."
                  columns={columns}
                />
              </Section>
            </>
          ) : (
            <Section title="Reconciliation results">
              <Async state={saved}>
                {() => (
                  <EmptyState
                    title="No statement yet"
                    message="Upload a bank statement CSV above to reconcile this payroll run."
                  />
                )}
              </Async>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
