import { describe, it, expect } from "vitest";
import {
  toDateInputValue,
  todayDateInputValue,
  dateInputToUtc,
  startOfUtcDay,
} from "@/lib/date";

describe("toDateInputValue", () => {
  it("formats a stored @db.Date using its UTC parts (no off-by-one)", () => {
    expect(toDateInputValue(new Date(Date.UTC(2026, 4, 31)))).toBe("2026-05-31");
  });

  it("zero-pads single-digit months and days", () => {
    expect(toDateInputValue(new Date(Date.UTC(2026, 0, 5)))).toBe("2026-01-05");
  });
});

describe("todayDateInputValue", () => {
  it("uses the local calendar parts of the given date", () => {
    // Constructed from local components, so the parts are stable across zones.
    expect(todayDateInputValue(new Date(2026, 5, 9))).toBe("2026-06-09");
  });
});

describe("dateInputToUtc", () => {
  it("parses YYYY-MM-DD to UTC midnight", () => {
    const d = dateInputToUtc("2026-05-31");
    expect(d.toISOString()).toBe("2026-05-31T00:00:00.000Z");
  });

  it("round-trips with toDateInputValue", () => {
    expect(toDateInputValue(dateInputToUtc("2026-12-01"))).toBe("2026-12-01");
  });
});

describe("startOfUtcDay", () => {
  it("floors a mid-day UTC timestamp to 00:00:00.000Z of the same calendar day", () => {
    const floored = startOfUtcDay(new Date("2026-06-16T14:37:21.500Z"));
    expect(floored.toISOString()).toBe("2026-06-16T00:00:00.000Z");
  });

  it("is idempotent (flooring an already-floored date returns the same instant)", () => {
    const once = startOfUtcDay(new Date("2026-06-16T14:37:21.500Z"));
    expect(startOfUtcDay(once).toISOString()).toBe(once.toISOString());
  });
});
