// Report Builder — HR-only ad-hoc report designer. Pick a source, choose
// whitelisted fields, apply optional filters, run the query, and export the
// exact same rows to Excel via the frozen download() helper. Reports can be
// saved for later reuse.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, download } from "../api/client";
import { useApi } from "../lib/useApi";
import {
  PageHeader,
  Section,
  Button,
  Field,
  Input,
  Select,
  DataTable,
  Async,
  EmptyState,
  Badge,
  type Column,
} from "../components/ui";
import { titleCase } from "../lib/format";

interface FieldDef {
  key: string;
  label: string;
}
interface SourceDef {
  key: string;
  label: string;
  fields: FieldDef[];
}
interface FieldsResponse {
  sources: SourceDef[];
}
interface AdhocResult {
  columns: FieldDef[];
  rows: Record<string, unknown>[];
}
interface Filters {
  status?: string;
  department?: string;
  payrollGroup?: string;
}

export default function ReportBuilder() {
  const fields = useApi<FieldsResponse>(() => api.get("/reports/fields"), []);

  return (
    <div>
      <PageHeader
        title="Report Builder"
        subtitle="Design an ad-hoc report, preview it, and export to Excel."
        actions={
          <Link to="/reports">
            <Button variant="ghost" size="sm">
              ← Back to Reports
            </Button>
          </Link>
        }
      />
      <Async state={fields}>{(data) => <Builder sources={data.sources} />}</Async>
    </div>
  );
}

function Builder({ sources }: { sources: SourceDef[] }) {
  const [source, setSource] = useState<string>(sources[0]?.key ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>({});
  const [result, setResult] = useState<AdhocResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const activeSource = useMemo(() => sources.find((s) => s.key === source), [sources, source]);

  function onSourceChange(next: string) {
    setSource(next);
    setSelected([]);
    setResult(null);
    setError(null);
    setSaveMsg(null);
  }

  function toggleField(key: string) {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function cleanFilters(): Filters {
    const f: Filters = {};
    if (filters.status?.trim()) f.status = filters.status.trim();
    if (filters.department?.trim()) f.department = filters.department.trim();
    if (filters.payrollGroup?.trim()) f.payrollGroup = filters.payrollGroup.trim();
    return f;
  }

  async function run() {
    if (selected.length === 0) {
      setError("Select at least one field to include.");
      return;
    }
    setRunning(true);
    setError(null);
    setSaveMsg(null);
    try {
      const res = await api.post<AdhocResult>("/reports/adhoc", {
        source,
        fields: selected,
        filters: cleanFilters(),
      });
      setResult(res);
    } catch (e: any) {
      setError(e?.message ?? "Failed to run report");
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  async function exportExcel() {
    const f = cleanFilters();
    setError(null);
    try {
      await download(
        `/reports/adhoc/export?source=${source}&fields=${selected.join(",")}&filters=${encodeURIComponent(
          JSON.stringify(f)
        )}`,
        `report-${source}.xlsx`
      );
    } catch (e: any) {
      setError(e?.message ?? "Failed to export report");
    }
  }

  async function saveReport() {
    if (!saveName.trim()) {
      setSaveMsg("Enter a name to save this report.");
      return;
    }
    if (selected.length === 0) {
      setSaveMsg("Select at least one field before saving.");
      return;
    }
    try {
      await api.post("/reports/saved", {
        name: saveName.trim(),
        source,
        fields: selected,
        filters: cleanFilters(),
      });
      setSaveMsg(`Saved "${saveName.trim()}".`);
      setSaveName("");
    } catch (e: any) {
      setSaveMsg(e?.message ?? "Failed to save report");
    }
  }

  const resultColumns: Column<Record<string, unknown>>[] = useMemo(
    () =>
      (result?.columns ?? []).map((c) => ({
        key: c.key,
        header: c.label,
        render: (row) => {
          const v = row[c.key];
          return v === null || v === undefined || v === "" ? "—" : String(v);
        },
      })),
    [result]
  );

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* ---- Builder controls ---- */}
      <div className="space-y-6 lg:col-span-1">
        <Section title="1 · Source & fields">
          <div className="space-y-4">
            <Field label="Data source">
              <Select value={source} onChange={(e) => onSourceChange(e.target.value)}>
                {sources.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>

            <div>
              <span className="field-label">Fields</span>
              <div className="mt-1 space-y-1.5 rounded-lg border border-line p-3">
                {activeSource?.fields.map((f) => (
                  <label
                    key={f.key}
                    className="flex cursor-pointer items-center gap-2 text-sm text-ink-soft"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-teal"
                      checked={selected.includes(f.key)}
                      onChange={() => toggleField(f.key)}
                    />
                    {f.label}
                  </label>
                ))}
              </div>
              <span className="mt-1 block text-xs text-ink-muted">
                {selected.length} field{selected.length === 1 ? "" : "s"} selected
              </span>
            </div>
          </div>
        </Section>

        <Section title="2 · Filters (optional)">
          <div className="space-y-4">
            <Field label="Status" hint="e.g. active, probation, resigned">
              <Input
                value={filters.status ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
                placeholder="Any status"
              />
            </Field>
            <Field label="Department" hint="Exact department name">
              <Input
                value={filters.department ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, department: e.target.value }))}
                placeholder="Any department"
              />
            </Field>
            <Field label="Payroll group" hint="e.g. general, executive">
              <Input
                value={filters.payrollGroup ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, payrollGroup: e.target.value }))}
                placeholder="Any group"
              />
            </Field>
          </div>
        </Section>

        <Section title="3 · Save (optional)">
          <div className="space-y-3">
            <Field label="Report name">
              <Input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="e.g. Active Executives"
              />
            </Field>
            <Button variant="ghost" size="sm" onClick={saveReport}>
              Save report
            </Button>
            {saveMsg && <p className="text-xs text-ink-muted">{saveMsg}</p>}
          </div>
        </Section>
      </div>

      {/* ---- Results ---- */}
      <div className="lg:col-span-2">
        <Section
          title="Results"
          actions={
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={run} disabled={running}>
                {running ? "Running…" : "Run"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={exportExcel}
                disabled={selected.length === 0}
              >
                Export to Excel
              </Button>
            </div>
          }
        >
          {error && (
            <div className="mb-4">
              <Badge tone="bad">{error}</Badge>
            </div>
          )}

          {result ? (
            <>
              <p className="mb-3 text-xs text-ink-muted">
                {result.rows.length} row{result.rows.length === 1 ? "" : "s"} ·{" "}
                {titleCase(source)}
              </p>
              <DataTable
                data={result.rows}
                columns={resultColumns}
                empty="No rows match your filters"
                rowKey={(_r, i) => i}
              />
            </>
          ) : (
            <EmptyState
              title="No report run yet"
              message="Choose a source and fields, then click Run to preview your report."
            />
          )}
        </Section>
      </div>
    </div>
  );
}
