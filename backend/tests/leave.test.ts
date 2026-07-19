import { describe, it, expect } from "vitest";
import { availableDays, leaveDays } from "../src/services/leaveCalc.js";

describe("Leave balance maths", () => {
  it("available = entitled − taken − pending", () => {
    expect(availableDays({ entitled: 18, taken: 5, pending: 3 })).toBe(10);
  });

  it("never returns a negative balance", () => {
    expect(availableDays({ entitled: 5, taken: 5, pending: 3 })).toBe(0);
  });

  it("decrements as a request is approved (taken up, pending down)", () => {
    const before = { entitled: 18, taken: 0, pending: 3 }; // 3 days pending approval
    expect(availableDays(before)).toBe(15);
    const afterApproval = { entitled: 18, taken: 3, pending: 0 };
    expect(availableDays(afterApproval)).toBe(15); // same available, now consumed
  });

  it("counts inclusive whole days for a leave span", () => {
    expect(leaveDays("2025-07-10", "2025-07-12")).toBe(3);
    expect(leaveDays("2025-07-10", "2025-07-10")).toBe(1);
  });
});
