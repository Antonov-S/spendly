import { describe, it, expect } from "vitest";
import { round2 } from "@/lib/money";

describe("round2", () => {
  it("rounds to two decimals", () => {
    expect(round2(1.239)).toBe(1.24);
    expect(round2(1.231)).toBe(1.23);
    expect(round2(1.004)).toBe(1);
  });

  it("resolves binary float error (0.1 + 0.2)", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it("leaves already-2dp values untouched and passes through 0", () => {
    expect(round2(55.0)).toBe(55);
    expect(round2(25.25)).toBe(25.25);
    expect(round2(0)).toBe(0);
  });

  it("handles negative magnitudes", () => {
    expect(round2(-80)).toBe(-80);
    expect(round2(-12.5)).toBe(-12.5);
  });
});
