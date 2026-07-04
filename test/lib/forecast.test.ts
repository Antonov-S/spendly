import { describe, it, expect } from "vitest";
import { buildCashflowForecast } from "@/lib/forecast";
import type { RecurringType } from "@/lib/recurring";
import type { RecurringCadence } from "@/generated/prisma/client";

// Fixed anchor: 2026-01-01 (UTC). Day d in the series is 2026-01-(01+d).
const NOW = new Date(Date.UTC(2026, 0, 1));

/** Day `d` (0-based) of the projection window, as a UTC-midnight date. */
function day(d: number): Date {
  return new Date(Date.UTC(2026, 0, 1 + d));
}

function template(overrides: {
  type?: RecurringType;
  amount?: number;
  cadence?: RecurringCadence;
  nextOccurrence: Date;
  hasPendingDraft?: boolean;
}) {
  return {
    type: overrides.type ?? "EXPENSE",
    amount: overrides.amount ?? 100,
    cadence: overrides.cadence ?? "MONTHLY",
    nextOccurrence: overrides.nextOccurrence,
    hasPendingDraft: overrides.hasPendingDraft ?? false,
  };
}

function draft(overrides: {
  type?: RecurringType;
  amount?: number;
  suggestedDate: Date;
}) {
  return {
    type: overrides.type ?? "EXPENSE",
    amount: overrides.amount ?? 100,
    suggestedDate: overrides.suggestedDate,
  };
}

describe("buildCashflowForecast — empty inputs", () => {
  it("produces a flat series at startBalance with eventCount 0", () => {
    const r = buildCashflowForecast({
      startBalance: 1000,
      templates: [],
      drafts: [],
      now: NOW,
      horizonDays: 30,
    });
    expect(r.points).toHaveLength(31);
    expect(r.eventCount).toBe(0);
    expect(r.points.every((p) => p.balance === 1000)).toBe(true);
    // low === end === points[0] (all equal → earliest wins the tie).
    expect(r.low).toEqual(r.points[0]);
    expect(r.end).toEqual(r.points[30]);
    expect(r.low.balance).toBe(1000);
  });

  it("dates the series from today at UTC midnight", () => {
    const r = buildCashflowForecast({
      startBalance: 0,
      templates: [],
      drafts: [],
      now: NOW,
      horizonDays: 5,
    });
    expect(r.points[0].date).toEqual(day(0));
    expect(r.points[5].date).toEqual(day(5));
  });
});

describe("buildCashflowForecast — draft signing & clamping", () => {
  it("signs an EXPENSE draft negative on its due day", () => {
    const r = buildCashflowForecast({
      startBalance: 1000,
      templates: [],
      drafts: [draft({ type: "EXPENSE", amount: 100, suggestedDate: day(5) })],
      now: NOW,
      horizonDays: 30,
    });
    expect(r.eventCount).toBe(1);
    expect(r.points[4].balance).toBe(1000);
    expect(r.points[5].balance).toBe(900);
    expect(r.end.balance).toBe(900);
  });

  it("signs an INCOME draft positive on its due day", () => {
    const r = buildCashflowForecast({
      startBalance: 1000,
      templates: [],
      drafts: [draft({ type: "INCOME", amount: 200, suggestedDate: day(10) })],
      now: NOW,
      horizonDays: 30,
    });
    expect(r.points[9].balance).toBe(1000);
    expect(r.points[10].balance).toBe(1200);
  });

  it("clamps an overdue draft to day 0", () => {
    const r = buildCashflowForecast({
      startBalance: 1000,
      templates: [],
      drafts: [
        draft({
          type: "EXPENSE",
          amount: 50,
          suggestedDate: new Date(Date.UTC(2025, 11, 20)), // before today
        }),
      ],
      now: NOW,
      horizonDays: 30,
    });
    expect(r.points[0].balance).toBe(950);
    expect(r.eventCount).toBe(1);
  });

  it("drops a draft dated past the horizon end", () => {
    const r = buildCashflowForecast({
      startBalance: 1000,
      templates: [],
      drafts: [draft({ suggestedDate: day(40) })],
      now: NOW,
      horizonDays: 30,
    });
    expect(r.eventCount).toBe(0);
    expect(r.points.every((p) => p.balance === 1000)).toBe(true);
  });
});

describe("buildCashflowForecast — the skip rule (§4.1.2 equivalence)", () => {
  it("a draft-minted template + its draft equals the no-draft template", () => {
    // Scenario A: draft already minted → template.hasPendingDraft = true, plus
    // the draft itself at the head of the series.
    const a = buildCashflowForecast({
      startBalance: 2000,
      templates: [
        template({
          type: "EXPENSE",
          amount: 900,
          cadence: "MONTHLY",
          nextOccurrence: day(14), // 2026-01-15
          hasPendingDraft: true,
        }),
      ],
      drafts: [draft({ type: "EXPENSE", amount: 900, suggestedDate: day(14) })],
      now: NOW,
      horizonDays: 30,
    });

    // Scenario B: draft not yet minted → template.hasPendingDraft = false.
    const b = buildCashflowForecast({
      startBalance: 2000,
      templates: [
        template({
          type: "EXPENSE",
          amount: 900,
          cadence: "MONTHLY",
          nextOccurrence: day(14),
          hasPendingDraft: false,
        }),
      ],
      drafts: [],
      now: NOW,
      horizonDays: 30,
    });

    expect(a.points).toEqual(b.points);
    expect(a.eventCount).toBe(1);
    expect(b.eventCount).toBe(1);
    // Both dip €900 on day 14, once.
    expect(a.points[13].balance).toBe(2000);
    expect(a.points[14].balance).toBe(1100);
  });

  it("does not double-count: the template with a pending draft skips its head occurrence", () => {
    // Template alone (draft present) must NOT project the day-14 occurrence.
    const r = buildCashflowForecast({
      startBalance: 2000,
      templates: [
        template({
          amount: 900,
          cadence: "MONTHLY",
          nextOccurrence: day(14),
          hasPendingDraft: true,
        }),
      ],
      drafts: [],
      now: NOW,
      horizonDays: 30,
    });
    // Next occurrence after 2026-01-15 is 2026-02-15 → out of the 30-day window.
    expect(r.eventCount).toBe(0);
  });
});

describe("buildCashflowForecast — overdue templates", () => {
  it("clamps pre-today occurrences to day 0 while preserving rhythm from unclamped dates", () => {
    // MONTHLY on the 15th, starting two months before today.
    const r = buildCashflowForecast({
      startBalance: 1000,
      templates: [
        template({
          type: "EXPENSE",
          amount: 100,
          cadence: "MONTHLY",
          nextOccurrence: new Date(Date.UTC(2025, 10, 15)), // 2025-11-15
        }),
      ],
      drafts: [],
      now: NOW,
      horizonDays: 30,
    });
    // Occurrences: 2025-11-15 (day0), 2025-12-15 (day0), 2026-01-15 (day14).
    expect(r.eventCount).toBe(3);
    expect(r.points[0].balance).toBe(800); // two clamped -100 events
    expect(r.points[13].balance).toBe(800);
    expect(r.points[14].balance).toBe(700); // the 2026-01-15 occurrence lands
  });

  it("bounds and sums a deep backlog on day 0", () => {
    // ~3 years overdue MONTHLY: every pre-today occurrence piles on day 0.
    const r = buildCashflowForecast({
      startBalance: 5000,
      templates: [
        template({
          type: "EXPENSE",
          amount: 10,
          cadence: "MONTHLY",
          nextOccurrence: new Date(Date.UTC(2023, 0, 15)), // 2023-01-15
        }),
      ],
      drafts: [],
      now: NOW,
      horizonDays: 30,
    });
    // 2023-01-15 .. 2025-12-15 = 36 clamped events, + 2026-01-15 in window = 37.
    expect(r.eventCount).toBe(37);
    // 36 clamped -10 on day 0 → 5000 - 360 = 4640.
    expect(r.points[0].balance).toBe(4640);
    // The in-window occurrence subtracts a further 10 on day 14.
    expect(r.points[14].balance).toBe(4630);
  });
});

describe("buildCashflowForecast — horizon boundaries & cadences", () => {
  it("includes an occurrence on exactly day horizonDays, excludes day horizonDays+1", () => {
    const onEdge = buildCashflowForecast({
      startBalance: 100,
      templates: [
        template({ amount: 10, cadence: "YEARLY", nextOccurrence: day(10) }),
      ],
      drafts: [],
      now: NOW,
      horizonDays: 10,
    });
    expect(onEdge.eventCount).toBe(1);
    expect(onEdge.points[10].balance).toBe(90);

    const past = buildCashflowForecast({
      startBalance: 100,
      templates: [
        template({ amount: 10, cadence: "YEARLY", nextOccurrence: day(11) }),
      ],
      drafts: [],
      now: NOW,
      horizonDays: 10,
    });
    expect(past.eventCount).toBe(0);
  });

  it("a DAILY template due today emits horizonDays + 1 events", () => {
    const r = buildCashflowForecast({
      startBalance: 100,
      templates: [
        template({ amount: 1, cadence: "DAILY", nextOccurrence: day(0) }),
      ],
      drafts: [],
      now: NOW,
      horizonDays: 10,
    });
    expect(r.eventCount).toBe(11);
    expect(r.end.balance).toBe(89); // 100 - 11
  });

  it("includes a YEARLY occurrence inside the window and ignores one outside", () => {
    const inside = buildCashflowForecast({
      startBalance: 500,
      templates: [
        template({ amount: 200, cadence: "YEARLY", nextOccurrence: day(20) }),
      ],
      drafts: [],
      now: NOW,
      horizonDays: 30,
    });
    expect(inside.eventCount).toBe(1);

    const outside = buildCashflowForecast({
      startBalance: 500,
      templates: [
        template({
          amount: 200,
          cadence: "YEARLY",
          nextOccurrence: new Date(Date.UTC(2026, 6, 1)), // mid-year, out of window
        }),
      ],
      drafts: [],
      now: NOW,
      horizonDays: 30,
    });
    expect(outside.eventCount).toBe(0);
  });

  it("inherits MONTHLY month-end clamping from advanceNextOccurrence (Jan 31 → Feb 28)", () => {
    // Start on Jan 31 with a long horizon; the second occurrence is Feb 28.
    const now = new Date(Date.UTC(2026, 0, 1));
    const r = buildCashflowForecast({
      startBalance: 1000,
      templates: [
        template({
          amount: 100,
          cadence: "MONTHLY",
          nextOccurrence: new Date(Date.UTC(2026, 0, 31)), // Jan 31
        }),
      ],
      drafts: [],
      now,
      horizonDays: 60,
    });
    // Jan 31 (day 30) and Feb 28 (day 58) both fall inside a 60-day window.
    expect(r.eventCount).toBe(2);
    expect(r.points[29].balance).toBe(1000);
    expect(r.points[30].balance).toBe(900); // Jan 31
    expect(r.points[58].balance).toBe(800); // Feb 28 (clamped, not Mar 3)
  });
});

describe("buildCashflowForecast — result invariants", () => {
  it("picks the earliest day on a low-point tie", () => {
    // Two equal dips: day 5 and day 10 both reach the same minimum.
    const r = buildCashflowForecast({
      startBalance: 1000,
      templates: [],
      drafts: [
        draft({ type: "EXPENSE", amount: 100, suggestedDate: day(5) }),
        draft({ type: "INCOME", amount: 100, suggestedDate: day(6) }),
        draft({ type: "EXPENSE", amount: 100, suggestedDate: day(10) }),
      ],
      now: NOW,
      horizonDays: 30,
    });
    // Balance dips to 900 on day 5, recovers to 1000 on day 6, dips to 900 again
    // on day 10 (and stays). Earliest minimum (day 5) wins.
    expect(r.low.balance).toBe(900);
    expect(r.low.date).toEqual(day(5));
  });

  it("rounds every balance to 2 decimals", () => {
    const r = buildCashflowForecast({
      startBalance: 0,
      templates: [],
      drafts: [
        draft({ type: "EXPENSE", amount: 33.333, suggestedDate: day(1) }),
      ],
      now: NOW,
      horizonDays: 5,
    });
    expect(r.points[1].balance).toBe(-33.33);
  });

  it("supports a projected balance below zero (never clamped)", () => {
    const r = buildCashflowForecast({
      startBalance: 100,
      templates: [],
      drafts: [draft({ type: "EXPENSE", amount: 400, suggestedDate: day(3) })],
      now: NOW,
      horizonDays: 10,
    });
    expect(r.points[3].balance).toBe(-300);
    expect(r.low.balance).toBe(-300);
    expect(r.end.balance).toBe(-300);
  });

  it("defaults horizonDays and now when omitted", () => {
    const r = buildCashflowForecast({ startBalance: 0, templates: [], drafts: [] });
    expect(r.points).toHaveLength(31); // FORECAST_HORIZON_DAYS (30) + 1
  });

  it("is deterministic — same input twice yields deep-equal output", () => {
    const input = {
      startBalance: 1234.56,
      templates: [
        template({ amount: 900, cadence: "MONTHLY", nextOccurrence: day(5) }),
        template({
          type: "INCOME" as const,
          amount: 2400,
          cadence: "MONTHLY",
          nextOccurrence: day(25),
        }),
      ],
      drafts: [draft({ amount: 13, suggestedDate: day(2) })],
      now: NOW,
      horizonDays: 30,
    };
    expect(buildCashflowForecast(input)).toEqual(buildCashflowForecast(input));
  });
});
