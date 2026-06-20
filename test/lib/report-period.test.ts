import { describe, it, expect } from "vitest";
import {
  parsePeriod,
  periodBounds,
  monthsInRange,
  isPeriodAllowed,
  resolveEffectivePeriod,
} from "@/lib/report-period";

// Fixed clock: 2026-06-16 (mid-June).
const NOW = new Date("2026-06-16T12:00:00Z");
// A January clock to exercise the year wrap.
const JAN = new Date("2026-01-10T12:00:00Z");

describe("parsePeriod", () => {
  it("maps each known param to its window", () => {
    expect(parsePeriod("1m").months).toBe(1);
    expect(parsePeriod("3m").months).toBe(3);
    expect(parsePeriod("12m").months).toBe(12);
  });

  it("carries the label for the matched option", () => {
    expect(parsePeriod("3m").label).toBe("Last 3 months");
  });

  it("defaults to the 1-month window for missing or garbage input", () => {
    expect(parsePeriod(undefined).months).toBe(1);
    expect(parsePeriod("nope").months).toBe(1);
    expect(parsePeriod("6m").months).toBe(1);
  });
});

describe("periodBounds", () => {
  it("this month → [start of this month, start of next month)", () => {
    const { from, to } = periodBounds(1, NOW);
    expect(from.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("last 3 months → from = start of 2 months prior, to = start of next month", () => {
    const { from, to } = periodBounds(3, NOW);
    expect(from.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("last 12 months wraps the year (Jan clock → prior February)", () => {
    const { from, to } = periodBounds(12, JAN);
    expect(from.toISOString()).toBe("2025-02-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });
});

describe("monthsInRange", () => {
  it("has length === months", () => {
    expect(monthsInRange(1, NOW)).toHaveLength(1);
    expect(monthsInRange(3, NOW)).toHaveLength(3);
    expect(monthsInRange(12, NOW)).toHaveLength(12);
  });

  it("is ordered oldest → newest, ending on the current month", () => {
    expect(monthsInRange(3, NOW)).toEqual([
      { month: 4, year: 2026 },
      { month: 5, year: 2026 },
      { month: 6, year: 2026 },
    ]);
  });

  it("spans the year boundary correctly", () => {
    const range = monthsInRange(3, JAN);
    expect(range).toEqual([
      { month: 11, year: 2025 },
      { month: 12, year: 2025 },
      { month: 1, year: 2026 },
    ]);
  });
});

describe("isPeriodAllowed", () => {
  it("Free is allowed 1m and 3m but denied 12m", () => {
    expect(isPeriodAllowed(1, false)).toBe(true);
    expect(isPeriodAllowed(3, false)).toBe(true);
    expect(isPeriodAllowed(12, false)).toBe(false);
  });

  it("Pro is allowed every window", () => {
    expect(isPeriodAllowed(1, true)).toBe(true);
    expect(isPeriodAllowed(3, true)).toBe(true);
    expect(isPeriodAllowed(12, true)).toBe(true);
  });
});

describe("resolveEffectivePeriod", () => {
  it("Free + 12m → clamps to the 3-month window and flags it", () => {
    const { effective, clamped } = resolveEffectivePeriod(
      parsePeriod("12m"),
      false
    );
    expect(effective.months).toBe(3);
    expect(clamped).toBe(true);
  });

  it("Free + 1m / 3m → returns the request unchanged, not clamped", () => {
    for (const param of ["1m", "3m"]) {
      const requested = parsePeriod(param);
      const { effective, clamped } = resolveEffectivePeriod(requested, false);
      expect(effective).toEqual(requested);
      expect(clamped).toBe(false);
    }
  });

  it("Pro + 12m → returns the 12-month request unchanged, not clamped", () => {
    const requested = parsePeriod("12m");
    const { effective, clamped } = resolveEffectivePeriod(requested, true);
    expect(effective).toEqual(requested);
    expect(effective.months).toBe(12);
    expect(clamped).toBe(false);
  });
});
