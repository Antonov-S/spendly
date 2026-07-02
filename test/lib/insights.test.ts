import { describe, it, expect } from "vitest";
import { countAtRiskBudgets, buildInsightItems } from "@/lib/insights";
import type { DashboardInsights } from "@/types/dashboard";

describe("countAtRiskBudgets", () => {
  it("returns 0 for an empty array", () => {
    expect(countAtRiskBudgets([])).toBe(0);
  });

  it("counts a row exactly at 80% spent (>= boundary)", () => {
    expect(countAtRiskBudgets([{ spent: 80, limit: 100 }])).toBe(1);
  });

  it("does not count a row at 79% spent", () => {
    expect(countAtRiskBudgets([{ spent: 79, limit: 100 }])).toBe(0);
  });

  it("counts an over-budget row (120%)", () => {
    expect(countAtRiskBudgets([{ spent: 120, limit: 100 }])).toBe(1);
  });

  it("counts a row whose carried overspend drove the effective limit to <= 0", () => {
    // Base 400, but −400 carried in → effective limit 0 → definitionally over.
    expect(
      countAtRiskBudgets([{ spent: 50, limit: 400, carriedAmount: -400 }])
    ).toBe(1);
  });

  it("uses the effective (base + carry) limit for the at-risk fraction", () => {
    // 90 spent against base 100 is at risk, but +100 carried in → effective 200 → safe.
    expect(
      countAtRiskBudgets([{ spent: 90, limit: 100, carriedAmount: 100 }])
    ).toBe(0);
  });

  it("returns the correct total for a mixed array", () => {
    const rows = [
      { spent: 90, limit: 100 }, // at risk
      { spent: 10, limit: 100 }, // safe
      { spent: 200, limit: 100 }, // over budget — at risk
      { spent: 50, limit: 100, carriedAmount: -100 }, // carry wiped the limit — over
      { spent: 80, limit: 100 }, // boundary — at risk
    ];
    expect(countAtRiskBudgets(rows)).toBe(4);
  });

  it("flags a budget pushed over the threshold by split-fed spend", () => {
    // getBudgetsData now derives `spent` via getCategorySpend, so split-line
    // spend attributed to a category counts here with zero insights-code change.
    // Category c1 has €0 direct spend but €85 from split lines against a €100
    // budget → 85% ≥ threshold → at risk. Pins the free-rider coupling (§7).
    expect(countAtRiskBudgets([{ spent: 85, limit: 100 }])).toBe(1);
  });

  it("ignores non-finite / malformed inputs rather than false-positiving", () => {
    const rows = [
      { spent: NaN, limit: 100 },
      { spent: 50, limit: NaN },
      { spent: 90, limit: 100 }, // the only genuine at-risk row
    ];
    expect(countAtRiskBudgets(rows)).toBe(1);
  });
});

describe("buildInsightItems", () => {
  const zero: DashboardInsights = {
    atRiskBudgetCount: 0,
    pendingDraftCount: 0,
    overdueGoalCount: 0,
  };

  it("returns [] when all counts are zero", () => {
    expect(buildInsightItems(zero)).toEqual([]);
  });

  it("uses singular copy for a count of 1", () => {
    const items = buildInsightItems({
      atRiskBudgetCount: 1,
      pendingDraftCount: 1,
      overdueGoalCount: 1,
    });
    expect(items.map((i) => i.label)).toEqual([
      "1 budget at risk",
      "1 recurring draft pending",
      "1 overdue goal",
    ]);
  });

  it("uses plural copy for counts greater than 1", () => {
    const items = buildInsightItems({
      atRiskBudgetCount: 2,
      pendingDraftCount: 3,
      overdueGoalCount: 2,
    });
    expect(items.map((i) => i.label)).toEqual([
      "2 budgets at risk",
      "3 recurring drafts pending",
      "2 overdue goals",
    ]);
  });

  it("preserves the fixed order budgets → drafts → goals", () => {
    const items = buildInsightItems({
      atRiskBudgetCount: 1,
      pendingDraftCount: 1,
      overdueGoalCount: 1,
    });
    expect(items.map((i) => i.key)).toEqual(["budgets", "drafts", "goals"]);
  });

  it("omits zero-count signals", () => {
    const items = buildInsightItems({
      atRiskBudgetCount: 2,
      pendingDraftCount: 0,
      overdueGoalCount: 1,
    });
    expect(items.map((i) => i.key)).toEqual(["budgets", "goals"]);
  });

  it("assigns the correct href and tone to each pill", () => {
    const items = buildInsightItems({
      atRiskBudgetCount: 1,
      pendingDraftCount: 1,
      overdueGoalCount: 1,
    });
    expect(items).toEqual([
      { key: "budgets", label: "1 budget at risk", href: "/budgets", tone: "warning" },
      { key: "drafts", label: "1 recurring draft pending", href: "/recurring", tone: "info" },
      { key: "goals", label: "1 overdue goal", href: "/goals", tone: "warning" },
    ]);
  });
});
