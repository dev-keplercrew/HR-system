// Statutory levies (item 2) — exact-value unit tests for the pure calculation
// functions (self-help funds, SDL, FWL), matching the project's exact-assertion
// test style. Rates are passed in / fixture-supplied so no DB is required.
import { describe, it, expect } from "vitest";
import {
  computeSdl,
  DEFAULT_SDL_CONFIG,
  selfHelpFundFromBands,
  computeFwlFromBands,
  type SelfHelpBand,
  type FwlBand,
} from "../src/services/statutoryLevies.js";

describe("Skills Development Levy (SDL)", () => {
  it("clamps to the $2 floor for low wages", () => {
    // 500 × 0.25% = 1.25 → below the $2 floor → 2.
    expect(computeSdl(500)).toBe(2);
  });
  it("clamps to the $11.25 cap at/above the wage cap", () => {
    // 4500 × 0.25% = 11.25 (exactly the cap); 20000 caps at 4500 → still 11.25.
    expect(computeSdl(4500)).toBe(11.25);
    expect(computeSdl(20000)).toBe(11.25);
  });
  it("returns the mid-band value between floor and cap", () => {
    // 3000 × 0.25% = 7.5.
    expect(computeSdl(3000)).toBe(7.5);
  });
  it("is zero for a zero wage (not the floor)", () => {
    expect(computeSdl(0)).toBe(0);
  });
  it("honours an overridden config (2026 rate revision = data change)", () => {
    const cfg = { ...DEFAULT_SDL_CONFIG, rate: 0.005 };
    // 3000 × 0.5% = 15 → clamped to the max 11.25.
    expect(computeSdl(3000, cfg)).toBe(11.25);
  });
});

describe("Self-help fund contribution", () => {
  const bands: SelfHelpBand[] = [
    { ethnicGroup: "CDAC", wageLower: 0, wageUpper: 2000, amount: 0.5 },
    { ethnicGroup: "CDAC", wageLower: 2000.01, wageUpper: 0, amount: 12 }, // 0 = no upper bound
    { ethnicGroup: "MBMF", wageLower: 0, wageUpper: 1000, amount: 3 },
    { ethnicGroup: "SINDA", wageLower: 0, wageUpper: 1000, amount: 1 },
    { ethnicGroup: "ECF", wageLower: 0, wageUpper: 1000, amount: 2 },
  ];

  it("looks up the correct band for each fund", () => {
    expect(selfHelpFundFromBands("CDAC", 1500, bands)).toBe(0.5);
    expect(selfHelpFundFromBands("CDAC", 6000, bands)).toBe(12); // no-upper-bound band
    expect(selfHelpFundFromBands("MBMF", 800, bands)).toBe(3);
    expect(selfHelpFundFromBands("SINDA", 800, bands)).toBe(1);
    expect(selfHelpFundFromBands("ECF", 800, bands)).toBe(2);
  });
  it("is case-insensitive on the group key", () => {
    expect(selfHelpFundFromBands("cdac", 1500, bands)).toBe(0.5);
  });
  it("returns 0 for a null/opt-out ethnic group", () => {
    expect(selfHelpFundFromBands(null, 5000, bands)).toBe(0);
    expect(selfHelpFundFromBands(undefined, 5000, bands)).toBe(0);
  });
  it("returns 0 when no band matches the wage", () => {
    expect(selfHelpFundFromBands("MBMF", 5000, bands)).toBe(0); // only a 0–1000 MBMF band
  });
});

describe("Foreign Worker Levy (FWL)", () => {
  const bands: FwlBand[] = [
    { workPassType: "sp", tier: "basic", monthlyRate: 450 },
    { workPassType: "wp", tier: "basic", monthlyRate: 700 },
  ];
  it("returns the configured rate for SP/WP holders", () => {
    expect(computeFwlFromBands("sp", bands)).toBe(450);
    expect(computeFwlFromBands("wp", bands)).toBe(700);
  });
  it("is zero for citizens and PRs (no FWL)", () => {
    expect(computeFwlFromBands("citizen", bands)).toBe(0);
    expect(computeFwlFromBands("pr", bands)).toBe(0);
    expect(computeFwlFromBands(null, bands)).toBe(0);
  });
  it("never hardcodes a rate — an unconfigured pass/tier yields 0", () => {
    expect(computeFwlFromBands("sp", bands, "higher")).toBe(0);
  });
});
