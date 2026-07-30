// Singapore statutory levies — self-help group funds, SDL and FWL.
//
// ⚠️ DEMO SIMULATION — NOT A CERTIFIED INTEGRATION.
// Self-help fund (CDAC/MBMF/SINDA/ECF) bands, the Skills Development Levy and the
// Foreign Worker Levy are computed from ADMIN-EDITABLE config tables (StatutoryConfig,
// SelfHelpFundRate, FwlRateConfig) seeded with representative values — NOT hardcoded
// legislated rates. A 2026 rate revision is therefore a data change, not a code change.
// The only numeric literals in this file are safe fallbacks used when the config row
// is absent; the live figures always come from the database.
//
// This module is intentionally DB-free (like payrollCalc.ts): the payroll route
// batch-loads SelfHelpFundRate/FwlRateConfig/StatutoryConfig ONCE per run and
// reuses these pure functions per employee, avoiding an N+1 query per payslip.

// ---- pure calculations (rates passed in — unit-testable without a DB) --------

export interface SelfHelpBand {
  ethnicGroup: string;
  wageLower: number;
  wageUpper: number; // 0 = no upper bound
  amount: number;
}

// Look up the employee's self-help fund contribution for a gross wage from a set
// of bands. Returns 0 for a null/opt-out ethnicGroup or when no band matches.
export function selfHelpFundFromBands(
  ethnicGroup: string | null | undefined,
  grossWage: number,
  bands: SelfHelpBand[]
): number {
  if (!ethnicGroup) return 0;
  const group = ethnicGroup.toUpperCase();
  const match = bands.find(
    (b) =>
      b.ethnicGroup.toUpperCase() === group &&
      grossWage >= b.wageLower &&
      (b.wageUpper === 0 || grossWage <= b.wageUpper)
  );
  return match ? match.amount : 0;
}

export interface SdlConfig {
  rate: number; // e.g. 0.0025
  wageCap: number; // e.g. 4500
  min: number; // e.g. 2
  max: number; // e.g. 11.25
}

export const DEFAULT_SDL_CONFIG: SdlConfig = { rate: 0.0025, wageCap: 4500, min: 2, max: 11.25 };

// Skills Development Levy: `rate` of the first `wageCap` of total monthly wages,
// clamped to [min, max]. Payable for ALL employees including foreign work-pass
// holders — there is no CPF-eligibility gate here (the key difference from CPF).
// Rounded to 2 decimals. A zero wage yields 0 (not the floor).
export function computeSdl(totalMonthlyWages: number, cfg: SdlConfig = DEFAULT_SDL_CONFIG): number {
  if (totalMonthlyWages <= 0) return 0;
  const leviable = Math.min(totalMonthlyWages, cfg.wageCap);
  const raw = leviable * cfg.rate;
  const clamped = Math.min(Math.max(raw, cfg.min), cfg.max);
  return Math.round(clamped * 100) / 100;
}

export interface FwlBand {
  workPassType: string;
  tier: string;
  monthlyRate: number;
}

// Foreign Worker Levy: a placeholder monthly rate looked up per work-pass type /
// tier. Citizens and PRs pay 0; SP/WP holders pay the configured rate. The rate
// is never hardcoded in this function — it comes from the FwlRateConfig table.
export function computeFwlFromBands(
  workPassType: string | null | undefined,
  bands: FwlBand[],
  tier = "basic"
): number {
  if (!workPassType) return 0;
  const wp = workPassType.toLowerCase();
  if (wp !== "sp" && wp !== "wp") return 0;
  const match = bands.find((b) => b.workPassType.toLowerCase() === wp && b.tier === tier);
  return match ? match.monthlyRate : 0;
}
