// Shared formatters. Money and statutory figures always use these so the whole
// app renders numbers consistently (tabular mono via the `.num` class in markup).

export function sgd(value: number | null | undefined): string {
  const n = typeof value === "number" ? value : 0;
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function num(value: number | null | undefined, dp = 0): string {
  const n = typeof value === "number" ? value : 0;
  return n.toLocaleString("en-SG", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function initials(first?: string, last?: string): string {
  return `${(first ?? "").charAt(0)}${(last ?? "").charAt(0)}`.toUpperCase() || "?";
}

export function titleCase(s: string | null | undefined): string {
  if (!s) return "—";
  return s
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
