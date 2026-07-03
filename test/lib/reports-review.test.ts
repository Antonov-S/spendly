import { describe, it, expect } from "vitest";
import {
  buildReviewFacts,
  hasReviewSignal,
  type ReviewInputs,
} from "@/lib/reports-review";
import type { BudgetListRow } from "@/types/dashboard";

/** Build a BudgetListRow with sane defaults for the fields the fact-builder reads. */
function budget(
  name: string,
  spent: number,
  limit: number,
  carriedAmount = 0
): BudgetListRow {
  return {
    id: `b-${name}`,
    category: { name, color: "#000", icon: "Tag" },
    spent,
    limit,
    rollover: carriedAmount !== 0,
    carriedAmount,
  };
}

/** Assemble ReviewInputs; spend maps keyed by id, names supplied alongside. */
function inputs(overrides: Partial<ReviewInputs> = {}): ReviewInputs {
  return {
    currentSpend: new Map(),
    priorSpend: new Map(),
    currentTotals: { income: 0, expenses: 0 },
    priorTotals: { income: 0, expenses: 0 },
    budgets: [],
    categoryNames: new Map(),
    periodLabel: "July 2026",
    ...overrides,
  };
}

const OPTS = { maxMovers: 3, maxBudgetNotes: 2 };

describe("buildReviewFacts — movers", () => {
  it("computes an up mover with a percentage delta", () => {
    const facts = buildReviewFacts(
      inputs({
        currentSpend: new Map([["c1", 300]]),
        priorSpend: new Map([["c1", 200]]),
        categoryNames: new Map([["c1", "Dining"]]),
        currentTotals: { income: 0, expenses: 300 },
      }),
      OPTS
    );
    expect(facts.movers).toEqual([
      { name: "Dining", current: 300, previous: 200, deltaPct: 0.5, direction: "up" },
    ]);
  });

  it("treats previous==0 as new spending (null deltaPct, never Infinity)", () => {
    const facts = buildReviewFacts(
      inputs({
        currentSpend: new Map([["c1", 60]]),
        priorSpend: new Map(),
        categoryNames: new Map([["c1", "Travel"]]),
        currentTotals: { income: 0, expenses: 60 },
      }),
      OPTS
    );
    expect(facts.movers[0].direction).toBe("new");
    expect(facts.movers[0].deltaPct).toBeNull();
  });

  it("treats a disappeared category (prev>0, cur=0) as a down mover", () => {
    const facts = buildReviewFacts(
      inputs({
        currentSpend: new Map(),
        priorSpend: new Map([["c1", 90]]),
        categoryNames: new Map([["c1", "Gifts"]]),
        currentTotals: { income: 0, expenses: 10 },
      }),
      OPTS
    );
    expect(facts.movers[0]).toMatchObject({
      name: "Gifts",
      current: 0,
      previous: 90,
      direction: "down",
      deltaPct: -1,
    });
  });

  it("drops movers below the REVIEW_MIN_MOVER_DELTA floor (€2 → €4)", () => {
    const facts = buildReviewFacts(
      inputs({
        currentSpend: new Map([["c1", 4]]),
        priorSpend: new Map([["c1", 2]]),
        categoryNames: new Map([["c1", "Pets"]]),
        currentTotals: { income: 0, expenses: 4 },
      }),
      OPTS
    );
    expect(facts.movers).toHaveLength(0);
  });

  it("ranks by absolute euro change, not percentage", () => {
    const facts = buildReviewFacts(
      inputs({
        // small-€ big-% (change 6, +150%) vs large-€ small-% (change 60, +12%)
        currentSpend: new Map([
          ["c1", 10],
          ["c2", 560],
        ]),
        priorSpend: new Map([
          ["c1", 4],
          ["c2", 500],
        ]),
        categoryNames: new Map([
          ["c1", "Small"],
          ["c2", "Large"],
        ]),
        currentTotals: { income: 0, expenses: 570 },
      }),
      OPTS
    );
    expect(facts.movers.map((m) => m.name)).toEqual(["Large", "Small"]);
  });

  it("honors the maxMovers cap", () => {
    const facts = buildReviewFacts(
      inputs({
        currentSpend: new Map([
          ["a", 100],
          ["b", 90],
          ["c", 80],
          ["d", 70],
        ]),
        priorSpend: new Map(),
        categoryNames: new Map([
          ["a", "A"],
          ["b", "B"],
          ["c", "C"],
          ["d", "D"],
        ]),
        currentTotals: { income: 0, expenses: 340 },
      }),
      { maxMovers: 2, maxBudgetNotes: 2 }
    );
    expect(facts.movers).toHaveLength(2);
    expect(facts.movers.map((m) => m.name)).toEqual(["A", "B"]);
  });

  it("tie-breaks equal euro changes by category name ascending", () => {
    const facts = buildReviewFacts(
      inputs({
        currentSpend: new Map([
          ["z", 50],
          ["a", 50],
        ]),
        priorSpend: new Map(),
        categoryNames: new Map([
          ["z", "Zebra"],
          ["a", "Apple"],
        ]),
        currentTotals: { income: 0, expenses: 100 },
      }),
      OPTS
    );
    expect(facts.movers.map((m) => m.name)).toEqual(["Apple", "Zebra"]);
  });
});

describe("buildReviewFacts — budget notes", () => {
  it("classifies over/under against the EFFECTIVE (rollover) limit", () => {
    const facts = buildReviewFacts(
      inputs({
        // spent 120, base 100, carry +50 → effective 150 → UNDER (not over)
        budgets: [budget("Groceries", 120, 100, 50)],
        currentTotals: { income: 0, expenses: 120 },
      }),
      OPTS
    );
    expect(facts.budgetNotes[0]).toMatchObject({
      name: "Groceries",
      spent: 120,
      effectiveLimit: 150,
      remaining: 30,
      status: "under",
    });
  });

  it("ranks over-budget first (largest overspend), then under closest to limit", () => {
    const facts = buildReviewFacts(
      inputs({
        budgets: [
          budget("Under", 40, 100), // remaining +60
          budget("OverSmall", 110, 100), // over by 10
          budget("OverBig", 200, 100), // over by 100
          budget("NearLimit", 95, 100), // remaining +5
        ],
        currentTotals: { income: 0, expenses: 445 },
      }),
      { maxMovers: 3, maxBudgetNotes: 3 }
    );
    expect(facts.budgetNotes.map((n) => n.name)).toEqual([
      "OverBig",
      "OverSmall",
      "NearLimit",
    ]);
  });

  it("honors the maxBudgetNotes cap", () => {
    const facts = buildReviewFacts(
      inputs({
        budgets: [budget("A", 200, 100), budget("B", 150, 100), budget("C", 120, 100)],
        currentTotals: { income: 0, expenses: 470 },
      }),
      { maxMovers: 3, maxBudgetNotes: 2 }
    );
    expect(facts.budgetNotes).toHaveLength(2);
  });
});

describe("buildReviewFacts — cashflow & topInsight", () => {
  it("computes net cashflow as income − expenses", () => {
    const facts = buildReviewFacts(
      inputs({ currentTotals: { income: 1000, expenses: 580 } }),
      OPTS
    );
    expect(facts.netCashflow).toBe(420);
    expect(facts.totalIncome).toBe(1000);
    expect(facts.totalExpenses).toBe(580);
  });

  it("prioritizes an over-budget note as the top insight", () => {
    const facts = buildReviewFacts(
      inputs({
        currentSpend: new Map([["c1", 300]]),
        priorSpend: new Map([["c1", 100]]),
        categoryNames: new Map([["c1", "Dining"]]),
        budgets: [budget("Rent", 1200, 1000)],
        currentTotals: { income: 2000, expenses: 1500 },
      }),
      OPTS
    );
    expect(facts.topInsight).toEqual({ kind: "budget", ref: "Rent" });
  });

  it("falls back to the largest mover when no budget is over", () => {
    const facts = buildReviewFacts(
      inputs({
        currentSpend: new Map([["c1", 300]]),
        priorSpend: new Map([["c1", 100]]),
        categoryNames: new Map([["c1", "Dining"]]),
        budgets: [budget("Rent", 500, 1000)], // under
        currentTotals: { income: 2000, expenses: 300 },
      }),
      OPTS
    );
    expect(facts.topInsight).toEqual({ kind: "mover", ref: "Dining" });
  });

  it("falls back to cashflow, then null, when there are no movers or over-budgets", () => {
    const withCashflow = buildReviewFacts(
      inputs({ currentTotals: { income: 1000, expenses: 100 } }),
      OPTS
    );
    expect(withCashflow.topInsight).toEqual({ kind: "cashflow", ref: "cashflow" });

    const empty = buildReviewFacts(inputs(), OPTS);
    expect(empty.topInsight).toBeNull();
  });

  it("is deterministic — identical inputs yield an identical lead and order", () => {
    const build = () =>
      buildReviewFacts(
        inputs({
          currentSpend: new Map([
            ["a", 50],
            ["b", 50],
          ]),
          priorSpend: new Map(),
          categoryNames: new Map([
            ["a", "Apple"],
            ["b", "Banana"],
          ]),
          currentTotals: { income: 0, expenses: 100 },
        }),
        OPTS
      );
    expect(build()).toEqual(build());
  });
});

describe("hasReviewSignal", () => {
  it("is false for an empty/sparse month", () => {
    expect(hasReviewSignal(buildReviewFacts(inputs(), OPTS))).toBe(false);
  });

  it("is true when there is spend and a real mover", () => {
    const facts = buildReviewFacts(
      inputs({
        currentSpend: new Map([["c1", 300]]),
        priorSpend: new Map([["c1", 100]]),
        categoryNames: new Map([["c1", "Dining"]]),
        currentTotals: { income: 0, expenses: 300 },
      }),
      OPTS
    );
    expect(hasReviewSignal(facts)).toBe(true);
  });

  it("is false when there is a mover but no spend this month", () => {
    // disappeared category → a down mover, but totalExpenses is 0 → nothing to narrate
    const facts = buildReviewFacts(
      inputs({
        currentSpend: new Map(),
        priorSpend: new Map([["c1", 90]]),
        categoryNames: new Map([["c1", "Gifts"]]),
        currentTotals: { income: 0, expenses: 0 },
      }),
      OPTS
    );
    expect(hasReviewSignal(facts)).toBe(false);
  });
});
