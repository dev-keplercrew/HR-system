// Leave-balance maths. Shared by the leave route and tests so entitlement,
// taken, pending and available days are computed the same way everywhere.

export interface LeaveBalanceLike {
  entitled: number;
  taken: number;
  pending: number;
}

// Days still available to book = entitlement minus taken minus pending (never < 0).
export function availableDays(b: LeaveBalanceLike): number {
  return Math.max(0, b.entitled - b.taken - b.pending);
}

// Inclusive whole-day count between two dates (start & end inclusive).
export function leaveDays(start: Date | string, end: Date | string): number {
  const s = new Date(start);
  const e = new Date(end);
  s.setHours(0, 0, 0, 0);
  e.setHours(0, 0, 0, 0);
  const diff = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(1, diff + 1);
}
