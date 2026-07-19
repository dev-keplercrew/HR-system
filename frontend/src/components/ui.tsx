// Shared UI primitives — the app's design system in code. Every page imports
// from here so the whole product looks like one system. Do NOT restyle these
// per-page; compose them. Styling classes are defined in src/index.css.
import { type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export type Tone = "neutral" | "teal" | "good" | "warn" | "bad";

// ---- Page scaffolding -----------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function Section({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="card">
      {(title || actions) && (
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone = "teal",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
}) {
  const bar: Record<Tone, string> = {
    neutral: "bg-ink-muted",
    teal: "bg-teal",
    good: "bg-good",
    warn: "bg-amber",
    bad: "bg-bad",
  };
  return (
    <div className="card-pad relative overflow-hidden">
      <span className={`absolute left-0 top-0 h-full w-1 ${bar[tone]}`} />
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="num mt-2 text-2xl font-semibold text-ink">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

// ---- Badges ---------------------------------------------------------------

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  const cls: Record<Tone, string> = {
    neutral: "badge-neutral",
    teal: "badge-teal",
    good: "badge-good",
    warn: "badge-warn",
    bad: "badge-bad",
  };
  return <span className={cls[tone]}>{children}</span>;
}

// Map common workflow status strings to a tone for consistent colouring.
const STATUS_TONE: Record<string, Tone> = {
  active: "good", approved: "good", finalised: "good", completed: "good", done: "good", hired: "good", paid: "good", achieved: "good", confirmed: "good",
  pending: "warn", draft: "neutral", "in-progress": "warn", "on-leave": "warn", screening: "warn", interview: "warn", submitted: "warn", enrolled: "neutral", scheduled: "warn", probation: "warn",
  rejected: "bad", cancelled: "bad", terminated: "bad", resigned: "bad", missed: "bad", critical: "bad", retired: "neutral",
  offer: "teal", posted: "teal", warning: "warn", info: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  const key = (status || "").toLowerCase();
  const tone = STATUS_TONE[key] ?? "neutral";
  return <Badge tone={tone}>{titleCaseLocal(status)}</Badge>;
}

function titleCaseLocal(s: string): string {
  return (s || "").replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---- Buttons --------------------------------------------------------------

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger";
  size?: "sm" | "md";
}
export function Button({ variant = "primary", size = "md", className = "", ...rest }: BtnProps) {
  const v = variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : "btn-ghost";
  const s = size === "sm" ? "btn-sm" : "";
  return <button className={`${v} ${s} ${className}`} {...rest} />;
}

// ---- Forms ----------------------------------------------------------------

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ""}`} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`select ${props.className ?? ""}`} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`textarea ${props.className ?? ""}`} />;
}

// ---- Table ----------------------------------------------------------------

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  empty = "No records",
  rowKey,
  onRowClick,
}: {
  columns: Column<T>[];
  data: T[];
  empty?: string;
  rowKey?: (row: T, i: number) => string | number;
  onRowClick?: (row: T) => void;
}) {
  if (!data.length) return <EmptyState message={empty} />;
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.className}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={rowKey ? rowKey(row, i) : i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? "cursor-pointer" : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={c.className}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- States ---------------------------------------------------------------

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-ink-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-teal" />
      {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="card-pad flex flex-col items-center gap-3 py-12 text-center">
      <p className="text-sm font-medium text-bad">{error}</p>
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, message }: { title?: string; message: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-12 text-center">
      {title && <p className="text-sm font-semibold text-ink-soft">{title}</p>}
      <p className="text-sm text-ink-muted">{message}</p>
    </div>
  );
}

// Convenience wrapper: renders loading / error / content for a useApi() result.
export function Async<T>({
  state,
  children,
}: {
  state: { data: T | null; loading: boolean; error: string | null; reload: () => void };
  children: (data: T) => ReactNode;
}) {
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (state.data == null) return <EmptyState message="No data" />;
  return <>{children(state.data)}</>;
}

// ---- Modal ----------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-line bg-surface shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ---- Tabs -----------------------------------------------------------------

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="mb-5 flex flex-wrap gap-1 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            active === t.key
              ? "border-teal text-teal-dark"
              : "border-transparent text-ink-muted hover:text-ink"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
