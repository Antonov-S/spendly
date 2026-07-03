import { describe, expect, it } from "vitest";
import {
  buildBudgetSuggestionFacts,
  hasSuggestSignal,
  roundUpToStep,
  toBudgetSuggestions,
  type BudgetSuggestCategory,
  type BudgetSuggestInputs,
} from "@/lib/budget-suggest";
import { BUDGET_AMOUNT_MAX } from "@/lib/constants";

const CATEGORIES = new Map<string, BudgetSuggestCategory>([
  ["cat-groceries", { name: "Groceries", icon: "ShoppingCart", color: "#EF9F27" }],
  ["cat-dining", { name: "Dining", icon: "UtensilsCrossed", color: "#D85A30" }],
  ["cat-transport", { name: "Transport", icon: "Bus", color: "#7F77DD" }],
  ["cat-pets", { name: "Pets", icon: "PawPrint", color: "#92400E" }],
]);

/** Months oldest → newest; each entry is [categoryId, spend][] for that month. */
function inputs(
  months: [string, number][][],
  overrides: Partial<BudgetSuggestInputs> = {}
): BudgetSuggestInputs {
  return {
    periodLabel: "July 2026",
    monthlySpend: months.map((m) => new Map(m)),
    budgetedCategoryIds: new Set(),
    categories: CATEGORIES,
    ...overrides,
  };
}

const MAX = { max: 8 };

describe("roundUpToStep", () => {
  it("rounds up on the €5 step under €100", () => {
    expect(roundUpToStep(87)).toBe(90);
  });

  it("rounds up on the €10 step between €100 and €500", () => {
    expect(roundUpToStep(212)).toBe(220);
  });

  it("rounds up on the €25 step above €500", () => {
    expect(roundUpToStep(740)).toBe(750);
  });

  it("leaves an exact multiple in place", () => {
    expect(roundUpToStep(90)).toBe(90);
    expect(roundUpToStep(220)).toBe(220);
    expect(roundUpToStep(750)).toBe(750);
  });

  it("clamps to BUDGET_AMOUNT_MAX", () => {
    expect(roundUpToStep(BUDGET_AMOUNT_MAX + 500)).toBe(BUDGET_AMOUNT_MAX);
  });
});

describe("buildBudgetSuggestionFacts", () => {
  it("computes median/average over months WITH spend and suggests the rounded median", () => {
    const facts = buildBudgetSuggestionFacts(
      inputs([
        [["cat-groceries", 180]],
        [["cat-groceries", 240]],
        [["cat-groceries", 210]],
      ]),
      MAX
    );
    expect(facts.suggestions).toHaveLength(1);
    const s = facts.suggestions[0];
    expect(s.monthly).toEqual([180, 240, 210]);
    expect(s.monthsWithSpend).toBe(3);
    expect(s.median).toBe(210);
    expect(s.average).toBe(210);
    expect(s.suggestedAmount).toBe(210); // exact multiple of 10 stays put
  });

  it("treats a missing month as 0 and excludes it from median/average", () => {
    const facts = buildBudgetSuggestionFacts(
      inputs([
        [["cat-dining", 40]],
        [],
        [["cat-dining", 60]],
      ]),
      MAX
    );
    const s = facts.suggestions[0];
    expect(s.monthly).toEqual([40, 0, 60]);
    expect(s.monthsWithSpend).toBe(2);
    expect(s.median).toBe(50); // even count → midpoint of the two months with spend
    expect(s.average).toBe(50);
  });

  it("drops a category with spend in only one lookback month (D8)", () => {
    const facts = buildBudgetSuggestionFacts(
      inputs([[["cat-pets", 130]], [], []]),
      MAX
    );
    expect(facts.suggestions).toHaveLength(0);
  });

  it("drops a category whose median is under the €10 floor (D8)", () => {
    const facts = buildBudgetSuggestionFacts(
      inputs([
        [["cat-transport", 8]],
        [["cat-transport", 8]],
        [["cat-transport", 8]],
      ]),
      MAX
    );
    expect(facts.suggestions).toHaveLength(0);
  });

  it("flags a spike month without letting it move the median (strict >)", () => {
    const facts = buildBudgetSuggestionFacts(
      inputs([
        [["cat-groceries", 100]],
        [["cat-groceries", 100]],
        [["cat-groceries", 400]],
      ]),
      MAX
    );
    const s = facts.suggestions[0];
    expect(s.median).toBe(100);
    expect(s.suggestedAmount).toBe(100);
    expect(s.spike).toBe(true);

    const boundary = buildBudgetSuggestionFacts(
      inputs([
        [["cat-groceries", 100]],
        [["cat-groceries", 100]],
        [["cat-groceries", 150]], // exactly 1.5 × median — not a spike
      ]),
      MAX
    );
    expect(boundary.suggestions[0].spike).toBe(false);
  });

  it("computes the variability flag from the relative spread of months with spend (D11)", () => {
    const steady = buildBudgetSuggestionFacts(
      inputs([
        [["cat-groceries", 100]],
        [["cat-groceries", 100]],
        [["cat-groceries", 110]],
      ]),
      MAX
    );
    expect(steady.suggestions[0].variability).toBe("consistent");

    const swinging = buildBudgetSuggestionFacts(
      inputs([
        [["cat-groceries", 60]],
        [["cat-groceries", 100]],
        [["cat-groceries", 140]],
      ]),
      MAX
    );
    expect(swinging.suggestions[0].variability).toBe("variable");

    const atRatio = buildBudgetSuggestionFacts(
      inputs([
        [["cat-groceries", 80]],
        [["cat-groceries", 100]],
        [["cat-groceries", 130]], // spread (130−80)/100 = 0.5 — at the ratio → variable
      ]),
      MAX
    );
    expect(atRatio.suggestions[0].variability).toBe("variable");
  });

  it("excludes categories with an active budget in the target period", () => {
    const facts = buildBudgetSuggestionFacts(
      inputs(
        [
          [["cat-groceries", 100], ["cat-dining", 50]],
          [["cat-groceries", 120], ["cat-dining", 60]],
          [["cat-groceries", 110], ["cat-dining", 70]],
        ],
        { budgetedCategoryIds: new Set(["cat-groceries"]) }
      ),
      MAX
    );
    expect(facts.suggestions.map((s) => s.categoryId)).toEqual(["cat-dining"]);
  });

  it("skips ids missing from the category lookup (e.g. a stray uncategorized key)", () => {
    const facts = buildBudgetSuggestionFacts(
      inputs([
        [["cat-unknown", 100]],
        [["cat-unknown", 120]],
        [["cat-unknown", 110]],
      ]),
      MAX
    );
    expect(facts.suggestions).toHaveLength(0);
  });

  it("ranks by average spend descending with a case-insensitive name tie-break (D7)", () => {
    const facts = buildBudgetSuggestionFacts(
      inputs([
        [["cat-dining", 50], ["cat-groceries", 200], ["cat-transport", 50]],
        [["cat-dining", 50], ["cat-groceries", 200], ["cat-transport", 50]],
        [["cat-dining", 50], ["cat-groceries", 200], ["cat-transport", 50]],
      ]),
      MAX
    );
    // Groceries (avg 200) first; Dining and Transport tie at 50 → name order.
    expect(facts.suggestions.map((s) => s.name)).toEqual([
      "Groceries",
      "Dining",
      "Transport",
    ]);
  });

  it("caps the list at opts.max", () => {
    const facts = buildBudgetSuggestionFacts(
      inputs([
        [["cat-dining", 50], ["cat-groceries", 200], ["cat-transport", 80]],
        [["cat-dining", 50], ["cat-groceries", 200], ["cat-transport", 80]],
        [["cat-dining", 50], ["cat-groceries", 200], ["cat-transport", 80]],
      ]),
      { max: 2 }
    );
    expect(facts.suggestions.map((s) => s.name)).toEqual([
      "Groceries",
      "Transport",
    ]);
  });

  it("is deterministic — identical inputs yield identical output", () => {
    const build = () =>
      buildBudgetSuggestionFacts(
        inputs([
          [["cat-dining", 55.5], ["cat-groceries", 180]],
          [["cat-dining", 44.4], ["cat-groceries", 240]],
          [["cat-dining", 66.6], ["cat-groceries", 210]],
        ]),
        MAX
      );
    expect(build()).toEqual(build());
  });

  it("is window-agnostic — a 6-month input yields lookbackMonths 6 with rules applied (D12)", () => {
    const facts = buildBudgetSuggestionFacts(
      inputs([
        [["cat-groceries", 100]],
        [],
        [["cat-groceries", 120]],
        [],
        [["cat-groceries", 140]],
        [],
      ]),
      MAX
    );
    expect(facts.lookbackMonths).toBe(6);
    const s = facts.suggestions[0];
    expect(s.monthly).toEqual([100, 0, 120, 0, 140, 0]);
    expect(s.monthsWithSpend).toBe(3);
    expect(s.median).toBe(120);
  });
});

describe("hasSuggestSignal", () => {
  it("is true only when at least one suggestion survived", () => {
    const empty = buildBudgetSuggestionFacts(inputs([[], [], []]), MAX);
    expect(hasSuggestSignal(empty)).toBe(false);

    const some = buildBudgetSuggestionFacts(
      inputs([
        [["cat-groceries", 100]],
        [["cat-groceries", 120]],
        [["cat-groceries", 110]],
      ]),
      MAX
    );
    expect(hasSuggestSignal(some)).toBe(true);
  });
});

describe("toBudgetSuggestions", () => {
  const facts = buildBudgetSuggestionFacts(
    inputs([
      [["cat-groceries", 180], ["cat-dining", 40]],
      [["cat-groceries", 240], ["cat-dining", 50]],
      [["cat-groceries", 210], ["cat-dining", 60]],
    ]),
    MAX
  );

  it("merges guarded notes, category display attributes, and the contract fields", () => {
    const notes = new Map([
      ["cat-groceries", "You spent €180, €240 and €210 — €210 covers a typical month."],
    ]);
    const result = toBudgetSuggestions(facts, notes, CATEGORIES, true, 1);
    expect(result.periodLabel).toBe("July 2026");
    expect(result.aiNotes).toBe(true);
    expect(result.promptVersion).toBe(1);

    const groceries = result.suggestions.find((s) => s.categoryId === "cat-groceries");
    expect(groceries).toMatchObject({
      name: "Groceries",
      icon: "ShoppingCart",
      color: "#EF9F27",
      suggestedAmount: 210,
      note: "You spent €180, €240 and €210 — €210 covers a typical month.",
    });
  });

  it("substitutes the deterministic fallback note for missing/dropped notes (D5)", () => {
    const result = toBudgetSuggestions(facts, new Map(), CATEGORIES, false, 1);
    const dining = result.suggestions.find((s) => s.categoryId === "cat-dining");
    expect(dining?.note).toBe("Median of your last 3 months of Dining spending.");
    expect(result.aiNotes).toBe(false);
  });

  it("drops a suggestion whose category is missing from the lookup", () => {
    const result = toBudgetSuggestions(
      facts,
      new Map(),
      new Map([["cat-dining", CATEGORIES.get("cat-dining")!]]),
      false,
      1
    );
    expect(result.suggestions.map((s) => s.categoryId)).toEqual(["cat-dining"]);
  });
});
