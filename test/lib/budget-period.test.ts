import { describe, it, expect } from "vitest";
import {
  parseMonth,
  parseYear,
  monthBounds,
  currentPeriod,
} from "@/lib/budget-period";

// Fixed clock: 2026-06-16 (mid-June).
const NOW = new Date("2026-06-16T12:00:00Z");

describe("parseMonth", () => {
  it("parses a valid month string", () => {
    expect(parseMonth("3", NOW)).toBe(3);
  });

  it("accepts the boundary values 1 and 12", () => {
    expect(parseMonth("1", NOW)).toBe(1);
    expect(parseMonth("12", NOW)).toBe(12);
  });

  it("falls back to the current month when out of range", () => {
    expect(parseMonth("0", NOW)).toBe(6);
    expect(parseMonth("13", NOW)).toBe(6);
  });

  it("falls back to the current month for garbage or missing input", () => {
    expect(parseMonth("abc", NOW)).toBe(6);
    expect(parseMonth(undefined, NOW)).toBe(6);
    expect(parseMonth("6.5", NOW)).toBe(6);
  });
});

describe("parseYear", () => {
  it("parses a valid year string", () => {
    expect(parseYear("2030", NOW)).toBe(2030);
  });

  it("falls back to the current year when out of range", () => {
    expect(parseYear("2019", NOW)).toBe(2026);
    expect(parseYear("2101", NOW)).toBe(2026);
  });

  it("falls back to the current year for garbage or missing input", () => {
    expect(parseYear("nope", NOW)).toBe(2026);
    expect(parseYear(undefined, NOW)).toBe(2026);
  });
});

describe("monthBounds", () => {
  it("returns half-open UTC bounds for a normal month", () => {
    const { monthStart, nextMonthStart } = monthBounds(6, 2026);
    expect(monthStart.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(nextMonthStart.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("handles February in a non-leap year", () => {
    const { monthStart, nextMonthStart } = monthBounds(2, 2026);
    expect(monthStart.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(nextMonthStart.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("wraps December into January of the next year", () => {
    const { monthStart, nextMonthStart } = monthBounds(12, 2026);
    expect(monthStart.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(nextMonthStart.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("currentPeriod", () => {
  it("derives month/year from the injected clock", () => {
    expect(currentPeriod(NOW)).toEqual({ month: 6, year: 2026 });
  });
});
