import { describe, it, expect } from "vitest";
import {
  rolloverCarryIn,
  effectiveLimit,
  type RolloverPoint,
} from "@/lib/rollover";
import { budgetProgressWithCarry, roundMoney } from "@/lib/budget";

describe("rolloverCarryIn", () => {
  it("returns 0 for an empty run", () => {
    expect(rolloverCarryIn([])).toBe(0);
  });

  it("carries a single underspent month forward as a positive remainder", () => {
    // 400 base, 320 spent → +80 rolls forward.
    expect(rolloverCarryIn([{ baseLimit: 400, spent: 320 }])).toBe(80);
  });

  it("carries a single overspent month forward as a negative remainder", () => {
    // 400 base, 450 spent → −50 rolls forward.
    expect(rolloverCarryIn([{ baseLimit: 400, spent: 450 }])).toBe(-50);
  });

  it("accumulates multiple underspent months forward", () => {
    // Month 1: 400−350 = +50 ; Month 2: 400+50−420 = +30 → +30.
    const run: RolloverPoint[] = [
      { baseLimit: 400, spent: 350 },
      { baseLimit: 400, spent: 420 },
    ];
    expect(rolloverCarryIn(run)).toBe(30);
  });

  it("nets a negative month then a positive month correctly", () => {
    // Jan: 400−500 = −100 ; Feb: 400+(−100)−250 = +50 → +50 (sign flip).
    const run: RolloverPoint[] = [
      { baseLimit: 400, spent: 500 },
      { baseLimit: 400, spent: 250 },
    ];
    expect(rolloverCarryIn(run)).toBe(50);
  });

  it("lets carry exceed the next base limit", () => {
    // Two big underspends accumulate beyond one month's base.
    const run: RolloverPoint[] = [
      { baseLimit: 400, spent: 0 },
      { baseLimit: 400, spent: 0 },
    ];
    expect(rolloverCarryIn(run)).toBe(800);
  });

  it("is order-independent for the running sum once the caller sorts chronologically", () => {
    const chronological: RolloverPoint[] = [
      { baseLimit: 400, spent: 500 }, // Jan
      { baseLimit: 400, spent: 250 }, // Feb
      { baseLimit: 300, spent: 100 }, // Mar
    ];
    // The DB hands back rows in arbitrary order; the caller sorts before folding.
    const shuffled = [chronological[2], chronological[0], chronological[1]];
    const sorted = [...shuffled].sort(
      (a, b) => chronological.indexOf(a) - chronological.indexOf(b)
    );
    expect(rolloverCarryIn(sorted)).toBe(rolloverCarryIn(chronological));
  });

  it("yields a clean 2-dp carry after a single boundary round (no float drift)", () => {
    const run: RolloverPoint[] = [
      { baseLimit: 100.1, spent: 0 },
      { baseLimit: 0.2, spent: 0 },
    ];
    // 100.1 + 0.2 = 100.30000000000001 in raw JS; roundMoney fixes it at the edge.
    expect(roundMoney(rolloverCarryIn(run))).toBe(100.3);
  });
});

describe("effectiveLimit", () => {
  it("adds the carry to the base limit", () => {
    expect(effectiveLimit(400, 100)).toBe(500);
  });

  it("can be driven to or below zero by a large negative carry", () => {
    expect(effectiveLimit(400, -400)).toBe(0);
    expect(effectiveLimit(400, -500)).toBe(-100);
  });
});

describe("budgetProgressWithCarry", () => {
  it("widens the bar with a positive carry", () => {
    // 300 spent against an effective 500 (400 + 100) → 60% (amber).
    const p = budgetProgressWithCarry(300, 400, 100);
    expect(p.effectiveLimit).toBe(500);
    expect(p.state).toBe("warning");
    expect(p.percent).toBe(60);
  });

  it("treats an effective limit <= 0 as fully over (danger / 100)", () => {
    const p = budgetProgressWithCarry(10, 400, -400);
    expect(p.effectiveLimit).toBe(0);
    expect(p.state).toBe("danger");
    expect(p.percent).toBe(100);
  });

  it("matches the plain helpers when there is no carry", () => {
    const p = budgetProgressWithCarry(200, 400, 0);
    expect(p.effectiveLimit).toBe(400);
    expect(p.state).toBe("success");
    expect(p.percent).toBe(50);
  });
});
