import { describe, it, expect } from "vitest";
import {
  budgetFraction,
  budgetState,
  budgetPercent,
  budgetColor,
  mapBudgetRow,
  summarizeBudgets,
  formatCarry,
  type MappableBudget,
} from "@/lib/budget";
import type { BudgetRow } from "@/types/dashboard";

/** Build a minimal BudgetRow for the summary tests (icon is irrelevant here). */
function row(spent: number, limit: number, carriedAmount = 0): BudgetRow {
  return {
    id: "b",
    category: { name: "X", color: "#000000", icon: (() => null) as never },
    spent,
    limit,
    rollover: carriedAmount !== 0,
    carriedAmount,
  };
}

describe("budgetFraction", () => {
  it("returns 0 when limit is zero", () => {
    expect(budgetFraction(50, 0)).toBe(0);
  });

  it("returns 0 when limit is negative", () => {
    expect(budgetFraction(50, -100)).toBe(0);
  });

  it("returns the ratio of spent to limit", () => {
    expect(budgetFraction(60, 100)).toBe(0.6);
  });

  it("returns a value greater than 1 when over budget", () => {
    expect(budgetFraction(150, 100)).toBe(1.5);
  });

  it("returns 0 when spent is 0", () => {
    expect(budgetFraction(0, 200)).toBe(0);
  });
});

describe("budgetState", () => {
  it("returns success when under the warning threshold (< 60%)", () => {
    expect(budgetState(59, 100)).toBe("success");
  });

  it("returns warning at exactly the warning threshold (60%)", () => {
    expect(budgetState(60, 100)).toBe("warning");
  });

  it("returns warning between 60% and 100%", () => {
    expect(budgetState(80, 100)).toBe("warning");
  });

  it("returns danger at exactly 100%", () => {
    expect(budgetState(100, 100)).toBe("danger");
  });

  it("returns danger when over 100%", () => {
    expect(budgetState(150, 100)).toBe("danger");
  });

  it("returns success when limit is zero", () => {
    expect(budgetState(50, 0)).toBe("success");
  });
});

describe("budgetPercent", () => {
  it("returns 0 when nothing is spent", () => {
    expect(budgetPercent(0, 100)).toBe(0);
  });

  it("returns the percentage spent when within budget", () => {
    expect(budgetPercent(75, 100)).toBe(75);
  });

  it("clamps to 100 when over budget", () => {
    expect(budgetPercent(150, 100)).toBe(100);
  });

  it("returns 0 when limit is zero", () => {
    expect(budgetPercent(50, 0)).toBe(0);
  });
});

describe("budgetColor", () => {
  it("returns the green hex for success", () => {
    expect(budgetColor("success")).toBe("#1D9E75");
  });

  it("returns the amber hex for warning", () => {
    expect(budgetColor("warning")).toBe("#EF9F27");
  });

  it("returns the red hex for danger", () => {
    expect(budgetColor("danger")).toBe("#E24B4A");
  });
});

describe("mapBudgetRow", () => {
  function budget(amount: number): MappableBudget {
    return {
      id: "b1",
      amount,
      category: {
        name: "Groceries",
        color: "#EF9F27",
        icon: "ShoppingCart",
      },
    };
  }

  it("returns the precomputed spent and the budget limit", () => {
    const r = mapBudgetRow(budget(400), 100.5, false, 0);
    expect(r.spent).toBe(100.5);
    expect(r.limit).toBe(400);
  });

  it("returns 0 spent when the caller supplies 0", () => {
    const r = mapBudgetRow(budget(200), 0, false, 0);
    expect(r.spent).toBe(0);
    expect(r.limit).toBe(200);
  });

  it("carries through the category name/color and the raw icon name", () => {
    const r = mapBudgetRow(budget(400), 10, false, 0);
    expect(r.category.name).toBe("Groceries");
    expect(r.category.color).toBe("#EF9F27");
    expect(r.category.icon).toBe("ShoppingCart");
  });

  it("threads rollover + carriedAmount through; limit stays the base amount", () => {
    const r = mapBudgetRow(budget(400), 50, true, 80);
    expect(r.rollover).toBe(true);
    expect(r.carriedAmount).toBe(80);
    expect(r.limit).toBe(400); // base, not the effective 480
  });

  it("coerces a Decimal-like amount value via toString", () => {
    const r = mapBudgetRow(
      {
        id: "b2",
        amount: { toString: () => "150" },
        category: {
          name: "Dining",
          color: "#D85A30",
          icon: "UtensilsCrossed",
        },
      },
      25,
      false,
      0
    );
    expect(r.limit).toBe(150);
    expect(r.spent).toBe(25);
  });
});

describe("formatCarry", () => {
  it("words a positive carry as added room with an explicit +", () => {
    expect(formatCarry(100)).toBe("+€100 rolled over");
  });

  it("words a negative carry as last month's overspend", () => {
    expect(formatCarry(-70)).toBe("€70 overspent last month");
  });

  it("returns an empty string for zero carry (no carry line)", () => {
    expect(formatCarry(0)).toBe("");
  });
});

describe("summarizeBudgets", () => {
  // Fixed clock: 2026-06-16 (mid-June, current = period 6/2026).
  const NOW = new Date("2026-06-16T12:00:00Z");

  it("totals the limits and computes remaining", () => {
    const s = summarizeBudgets([row(50, 400), row(100, 200)], ["USD", "USD"], 6, 2026, NOW);
    expect(s.total).toBe(600);
    expect(s.remaining).toBe(450);
    expect(s.categoryCount).toBe(2);
  });

  it("clamps remaining at 0 when overspent", () => {
    const s = summarizeBudgets([row(500, 400)], ["USD"], 6, 2026, NOW);
    expect(s.remaining).toBe(0);
  });

  it("uses the effective limit (base + carry) for total and remaining", () => {
    // Base 400 + 100 carried = 480 effective limit (wait: 400+100=500); 50 spent.
    const s = summarizeBudgets([row(50, 400, 100)], ["EUR"], 6, 2026, NOW);
    expect(s.total).toBe(500); // 400 base + 100 carry
    expect(s.remaining).toBe(450); // 500 − 50
  });

  it("shrinks total/remaining with a negative carry", () => {
    const s = summarizeBudgets([row(50, 400, -100)], ["EUR"], 6, 2026, NOW);
    expect(s.total).toBe(300); // 400 base − 100 carry
    expect(s.remaining).toBe(250); // 300 − 50
  });

  it("leaves non-rollover rows (carry 0) unaffected", () => {
    const s = summarizeBudgets([row(50, 400, 0)], ["EUR"], 6, 2026, NOW);
    expect(s.total).toBe(400);
    expect(s.remaining).toBe(350);
  });

  it("computes daysLeft for the current period", () => {
    // June has 30 days; mid-June 16 → 14 days left.
    const s = summarizeBudgets([row(0, 100)], ["USD"], 6, 2026, NOW);
    expect(s.daysLeft).toBe(14);
  });

  it("returns 0 daysLeft for a past period", () => {
    const s = summarizeBudgets([row(0, 100)], ["USD"], 5, 2026, NOW);
    expect(s.daysLeft).toBe(0);
  });

  it("returns 0 daysLeft for a future period", () => {
    const s = summarizeBudgets([row(0, 100)], ["USD"], 7, 2026, NOW);
    expect(s.daysLeft).toBe(0);
  });

  it("flags mixed currencies when more than one currency is present", () => {
    const s = summarizeBudgets([row(0, 100), row(0, 100)], ["USD", "EUR"], 6, 2026, NOW);
    expect(s.hasMixedCurrencies).toBe(true);
  });

  it("does not flag a uniform single-currency period", () => {
    const s = summarizeBudgets([row(0, 100)], ["USD", "USD"], 6, 2026, NOW);
    expect(s.hasMixedCurrencies).toBe(false);
  });

  it("does not flag an empty period", () => {
    const s = summarizeBudgets([], [], 6, 2026, NOW);
    expect(s.hasMixedCurrencies).toBe(false);
    expect(s.total).toBe(0);
    expect(s.remaining).toBe(0);
    expect(s.categoryCount).toBe(0);
  });
});
