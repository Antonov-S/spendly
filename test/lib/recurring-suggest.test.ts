import { describe, it, expect } from "vitest";
import {
  buildRecurringSuggestions,
  SUBSCRIPTION_DETECTION_DEFAULTS,
  type CandidateRow,
  type SubscriptionDetectionConfig,
} from "@/lib/recurring-suggest";
import { SUBSCRIPTION_SUGGEST_MAX } from "@/lib/system-constants";
import type { RecurringType } from "@/lib/recurring";

/** UTC-midnight calendar date (matches @db.Date storage). */
function d(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** A fixed "now" so every test is deterministic. */
const NOW = d(2026, 6, 20);

interface RowOverrides {
  merchant?: string;
  amount?: number;
  type?: RecurringType;
  categoryId?: string | null;
  account?: string;
}

/**
 * Build `count` monthly rows on day `endDay`, ending in `endMonth`, in
 * ascending date order — a clean, non-stale monthly pattern relative to NOW.
 */
function monthlySeries(
  count: number,
  endMonth: number,
  overrides: RowOverrides = {},
  endDay = 15
): CandidateRow[] {
  const {
    merchant = "Netflix",
    amount = 12.99,
    type = "EXPENSE",
    categoryId = null,
    account = "acc1",
  } = overrides;
  const rows: CandidateRow[] = [];
  for (let i = count - 1; i >= 0; i--) {
    rows.push({
      merchant,
      amount,
      type,
      date: new Date(Date.UTC(2026, endMonth - 1 - i, endDay)),
      categoryId,
      financialAccountId: account,
    });
  }
  return rows;
}

function build(
  rows: CandidateRow[],
  extra: Partial<Parameters<typeof buildRecurringSuggestions>[0]> = {}
) {
  return buildRecurringSuggestions({
    rows,
    templateNames: [],
    mutedKeys: new Set(),
    now: NOW,
    ...extra,
  });
}

describe("grouping", () => {
  it("merges casing / whitespace / NFC variants into one group", () => {
    const rows: CandidateRow[] = [
      { merchant: "  NETFLIX ", amount: 12.99, type: "EXPENSE", date: d(2026, 4, 15), categoryId: null, financialAccountId: "acc1" },
      { merchant: "netflix", amount: 12.99, type: "EXPENSE", date: d(2026, 5, 15), categoryId: null, financialAccountId: "acc1" },
      { merchant: "Netflix", amount: 12.99, type: "EXPENSE", date: d(2026, 6, 15), categoryId: null, financialAccountId: "acc1" },
    ];
    const res = build(rows);
    expect(res.suggestions).toHaveLength(1);
    expect(res.suggestions[0].occurrenceCount).toBe(3);
    // Display name uses the most-recent raw casing.
    expect(res.suggestions[0].name).toBe("Netflix");
    expect(res.suggestions[0].merchantKey).toBe("netflix");
  });

  it("converges NFC and NFD forms of the same name", () => {
    const composed = "caf" + String.fromCharCode(0x00e9); // cafe + single accented e
    const decomposed = "cafe" + String.fromCharCode(0x0301); // cafe + combining accent
    const rows: CandidateRow[] = [
      { merchant: composed, amount: 20, type: "EXPENSE", date: d(2026, 4, 15), categoryId: null, financialAccountId: "acc1" },
      { merchant: decomposed, amount: 20, type: "EXPENSE", date: d(2026, 5, 15), categoryId: null, financialAccountId: "acc1" },
      { merchant: composed, amount: 20, type: "EXPENSE", date: d(2026, 6, 15), categoryId: null, financialAccountId: "acc1" },
    ];
    expect(build(rows).suggestions).toHaveLength(1);
  });

  it("splits a merchant's INCOME and EXPENSE into separate groups", () => {
    const rows = [
      ...monthlySeries(3, 6, { merchant: "Acme", type: "EXPENSE", amount: 50 }),
      ...monthlySeries(3, 6, { merchant: "Acme", type: "INCOME", amount: 50 }, 16),
    ];
    const res = build(rows);
    expect(res.suggestions).toHaveLength(2);
    expect(new Set(res.suggestions.map((s) => s.type))).toEqual(
      new Set(["INCOME", "EXPENSE"])
    );
  });

  it("ignores blank merchants", () => {
    const rows = monthlySeries(3, 6, { merchant: "   " });
    expect(build(rows).suggestions).toHaveLength(0);
  });
});

describe("occurrence floor", () => {
  it("does not suggest a merchant with fewer than 3 occurrences", () => {
    expect(build(monthlySeries(2, 6)).suggestions).toHaveLength(0);
  });

  it("suggests at exactly 3 occurrences", () => {
    expect(build(monthlySeries(3, 6)).suggestions).toHaveLength(1);
  });
});

describe("cadence bands", () => {
  it("selects WEEKLY from a ~7-day median gap", () => {
    const rows: CandidateRow[] = [
      { merchant: "Gym", amount: 10, type: "EXPENSE", date: d(2026, 6, 1), categoryId: null, financialAccountId: "acc1" },
      { merchant: "Gym", amount: 10, type: "EXPENSE", date: d(2026, 6, 8), categoryId: null, financialAccountId: "acc1" },
      { merchant: "Gym", amount: 10, type: "EXPENSE", date: d(2026, 6, 15), categoryId: null, financialAccountId: "acc1" },
    ];
    expect(build(rows).suggestions[0].cadence).toBe("WEEKLY");
  });

  it("selects MONTHLY from a ~30-day median gap", () => {
    expect(build(monthlySeries(3, 6)).suggestions[0].cadence).toBe("MONTHLY");
  });

  it("rejects a median gap that fits no band (e.g. ~18 days)", () => {
    const rows: CandidateRow[] = [
      { merchant: "Odd", amount: 10, type: "EXPENSE", date: d(2026, 5, 1), categoryId: null, financialAccountId: "acc1" },
      { merchant: "Odd", amount: 10, type: "EXPENSE", date: d(2026, 5, 19), categoryId: null, financialAccountId: "acc1" },
      { merchant: "Odd", amount: 10, type: "EXPENSE", date: d(2026, 6, 6), categoryId: null, financialAccountId: "acc1" },
    ];
    expect(build(rows).suggestions).toHaveLength(0);
  });

  it("one out-of-band gap (a same-day duplicate) kills the group", () => {
    const rows: CandidateRow[] = [
      { merchant: "Dup", amount: 10, type: "EXPENSE", date: d(2026, 4, 15), categoryId: null, financialAccountId: "acc1" },
      { merchant: "Dup", amount: 10, type: "EXPENSE", date: d(2026, 5, 15), categoryId: null, financialAccountId: "acc1" },
      { merchant: "Dup", amount: 10, type: "EXPENSE", date: d(2026, 5, 15), categoryId: null, financialAccountId: "acc1" },
      { merchant: "Dup", amount: 10, type: "EXPENSE", date: d(2026, 6, 15), categoryId: null, financialAccountId: "acc1" },
    ];
    expect(build(rows).suggestions).toHaveLength(0);
  });
});

describe("amount regularity", () => {
  it("passes at exactly 15% deviation from the median", () => {
    // median = 10; 11.5 is +15% → within tolerance.
    const rows = [
      ...monthlySeries(3, 6, { amount: 10 }),
    ];
    rows[2] = { ...rows[2], amount: 11.5 };
    expect(build(rows).suggestions).toHaveLength(1);
  });

  it("fails just above 15% deviation", () => {
    const rows = [...monthlySeries(3, 6, { amount: 10 })];
    rows[2] = { ...rows[2], amount: 11.6 }; // +16%
    expect(build(rows).suggestions).toHaveLength(0);
  });
});

describe("staleness", () => {
  it("suggests when the last charge is within the stale window (52 days ≤ 52.5)", () => {
    // Monthly band maxDays 35 × 1.5 = 52.5. last = 03-15, now = 05-06 → 52 days.
    const rows = monthlySeries(3, 3); // 01-15, 02-15, 03-15
    const res = build(rows, { now: d(2026, 5, 6) });
    expect(res.suggestions).toHaveLength(1);
  });

  it("drops a cancelled series just past the stale window (53 > 52.5)", () => {
    const rows = monthlySeries(3, 3);
    const res = build(rows, { now: d(2026, 5, 7) });
    expect(res.suggestions).toHaveLength(0);
  });
});

describe("minimum amount floor", () => {
  it("suggests when the median exactly meets the €5 floor", () => {
    expect(build(monthlySeries(3, 6, { amount: 5 })).suggestions).toHaveLength(1);
  });

  it("drops a perfectly regular series below the floor", () => {
    expect(build(monthlySeries(3, 6, { amount: 4.99 })).suggestions).toHaveLength(0);
  });
});

describe("suppression", () => {
  it("suppresses a merchant already covered by a template (normalized)", () => {
    const res = build(monthlySeries(3, 6, { merchant: "Netflix" }), {
      templateNames: ["  netflix "],
    });
    expect(res.suggestions).toHaveLength(0);
  });

  it("suppresses regardless of whether the template is paused (name-based)", () => {
    // The engine only sees names — paused/active is not distinguished here.
    const res = build(monthlySeries(3, 6, { merchant: "Spotify" }), {
      templateNames: ["Spotify"],
    });
    expect(res.suggestions).toHaveLength(0);
  });

  it("suppresses a muted merchant key", () => {
    const res = build(monthlySeries(3, 6, { merchant: "Rent" }), {
      mutedKeys: new Set(["rent"]),
    });
    expect(res.suggestions).toHaveLength(0);
  });
});

describe("derived values", () => {
  it("uses the round2 median as the suggested amount", () => {
    const rows = [...monthlySeries(3, 6, { amount: 10 })];
    rows[0] = { ...rows[0], amount: 9 };
    rows[2] = { ...rows[2], amount: 10.5 };
    // sorted magnitudes [9, 10, 10.5] → median 10.
    expect(build(rows).suggestions[0].amount).toBe(10);
  });

  it("takes the mode category with a most-recent tie-break", () => {
    // 4 monthly rows, categories [c1, c1, c2, c2] — tie, newest is c2.
    const rows = monthlySeries(4, 6);
    const cats = ["c1", "c1", "c2", "c2"];
    const withCats = rows.map((r, i) => ({ ...r, categoryId: cats[i] }));
    expect(build(withCats).suggestions[0].categoryId).toBe("c2");
  });

  it("takes the clear mode when there is no tie", () => {
    const rows = monthlySeries(3, 6);
    const cats = ["c1", "c2", "c2"];
    const withCats = rows.map((r, i) => ({ ...r, categoryId: cats[i] }));
    expect(build(withCats).suggestions[0].categoryId).toBe("c2");
  });

  it("carries the most-recent account and null category through", () => {
    const rows = monthlySeries(3, 6);
    const withAccts = rows.map((r, i) => ({
      ...r,
      financialAccountId: i === 2 ? "acc-new" : "acc-old",
    }));
    const s = build(withAccts).suggestions[0];
    expect(s.financialAccountId).toBe("acc-new");
    expect(s.categoryId).toBeNull();
  });

  it("advances nextOccurrence to the first date ≥ today (multi-step)", () => {
    // last = 03-15, now = 04-20 → 04-15 is before today, so step to 05-15.
    const rows = monthlySeries(3, 3);
    const s = build(rows, { now: d(2026, 4, 20) }).suggestions[0];
    expect(s.nextOccurrence).toBe("2026-05-15");
  });

  it("never proposes a nextOccurrence before today", () => {
    const rows = monthlySeries(3, 6);
    const s = build(rows).suggestions[0];
    expect(s.nextOccurrence >= "2026-06-20").toBe(true);
  });
});

describe("ranking, cap, and the result invariant", () => {
  it("ranks by median amount desc, tie-broken by name asc", () => {
    const rows = [
      ...monthlySeries(3, 6, { merchant: "Cheap", amount: 10 }),
      ...monthlySeries(3, 6, { merchant: "Pricey", amount: 100 }),
      ...monthlySeries(3, 6, { merchant: "Beta", amount: 50 }),
      ...monthlySeries(3, 6, { merchant: "Alpha", amount: 50 }),
    ];
    const names = build(rows).suggestions.map((s) => s.name);
    // 100 first, then the two €50 alphabetically, then €10.
    expect(names).toEqual(["Pricey", "Alpha", "Beta", "Cheap"]);
  });

  it("caps surfaced suggestions but preserves the pre-cap detectedCount", () => {
    const rows: CandidateRow[] = [];
    for (let i = 0; i < SUBSCRIPTION_SUGGEST_MAX + 3; i++) {
      rows.push(...monthlySeries(3, 6, { merchant: `Merchant ${i}`, amount: 10 + i }));
    }
    const res = build(rows);
    expect(res.detectedCount).toBe(SUBSCRIPTION_SUGGEST_MAX + 3);
    expect(res.suggestions).toHaveLength(SUBSCRIPTION_SUGGEST_MAX);
    expect(res.suggestions).toHaveLength(
      Math.min(res.detectedCount, SUBSCRIPTION_SUGGEST_MAX)
    );
  });

  it("does not count suppressed groups toward detectedCount", () => {
    const rows = [
      ...monthlySeries(3, 6, { merchant: "Keep", amount: 20 }),
      ...monthlySeries(3, 6, { merchant: "Muted", amount: 30 }),
    ];
    const res = build(rows, { mutedKeys: new Set(["muted"]) });
    expect(res.detectedCount).toBe(1);
    expect(res.suggestions).toHaveLength(1);
  });
});

describe("config injection", () => {
  it("uses the constant defaults when config is omitted", () => {
    // 2 occurrences → below the default floor of 3.
    expect(build(monthlySeries(2, 6)).suggestions).toHaveLength(0);
  });

  it("honors a custom minOccurrences via injected config", () => {
    const config: SubscriptionDetectionConfig = {
      ...SUBSCRIPTION_DETECTION_DEFAULTS,
      minOccurrences: 2,
    };
    expect(build(monthlySeries(2, 6), { config }).suggestions).toHaveLength(1);
  });

  it("honors a custom suggestMax cap", () => {
    const rows = [
      ...monthlySeries(3, 6, { merchant: "A", amount: 30 }),
      ...monthlySeries(3, 6, { merchant: "B", amount: 20 }),
      ...monthlySeries(3, 6, { merchant: "C", amount: 10 }),
    ];
    const config: SubscriptionDetectionConfig = {
      ...SUBSCRIPTION_DETECTION_DEFAULTS,
      suggestMax: 2,
    };
    const res = build(rows, { config });
    expect(res.detectedCount).toBe(3);
    expect(res.suggestions).toHaveLength(2);
  });
});

describe("determinism", () => {
  it("produces deep-equal output for the same input twice", () => {
    const rows = [
      ...monthlySeries(3, 6, { merchant: "One", amount: 40 }),
      ...monthlySeries(3, 6, { merchant: "Two", amount: 25 }),
    ];
    const a = build(rows);
    const b = build(rows);
    expect(a).toEqual(b);
  });

  it("respects an injected now for the staleness cutoff", () => {
    const rows = monthlySeries(3, 3); // ends 03-15
    expect(build(rows, { now: d(2026, 4, 1) }).suggestions).toHaveLength(1);
    expect(build(rows, { now: d(2026, 8, 1) }).suggestions).toHaveLength(0);
  });
});
