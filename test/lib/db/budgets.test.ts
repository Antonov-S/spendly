import { describe, it, expect, vi, beforeEach } from "vitest";
import { getBudgets, resolveRolloverCarry } from "@/lib/db/budgets";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    budget: { findMany: vi.fn() },
    transaction: { groupBy: vi.fn() },
    transactionSplit: { groupBy: vi.fn() },
  },
}));

const budgetFindMany = vi.mocked(prisma.budget.findMany);
const transactionGroupBy = vi.mocked(prisma.transaction.groupBy);
// Split-line aggregation half of getCategorySpend; defaults to "no splits" so the
// existing single-category assertions are unaffected (a split-fed case sets it).
const splitGroupBy = vi.mocked(prisma.transactionSplit.groupBy);

function budgetRow(
  id: string,
  categoryId: string,
  amount: number,
  name: string,
  rollover = false
) {
  return {
    id,
    categoryId,
    amount,
    currency: "EUR",
    rollover,
    category: { name, color: "#000000", icon: "ShoppingCart" },
  };
}

describe("getBudgets", () => {
  beforeEach(() => {
    budgetFindMany.mockReset();
    transactionGroupBy.mockReset();
    splitGroupBy.mockReset();
    splitGroupBy.mockResolvedValue([] as never); // no split lines by default
  });

  it("aggregates spend DB-side, scoped to the budgeted categories' ids", async () => {
    budgetFindMany.mockResolvedValue([
      budgetRow("b1", "c1", 400, "Groceries"),
      budgetRow("b2", "c2", 200, "Dining"),
    ] as never);
    transactionGroupBy.mockResolvedValue([
      { categoryId: "c1", _sum: { amount: -100.5 } },
      { categoryId: "c2", _sum: { amount: -50 } },
    ] as never);

    const result = await getBudgets("user-1", 6, 2026);

    // groupBy filtered to EXPENSE / non-deleted / in-window / budgeted categories.
    expect(transactionGroupBy).toHaveBeenCalledTimes(1);
    const arg = transactionGroupBy.mock.calls[0][0] as {
      by: string[];
      where: Record<string, unknown>;
      _sum: { amount: boolean };
    };
    expect(arg.by).toEqual(["categoryId"]);
    expect(arg._sum).toEqual({ amount: true });
    expect(arg.where).toMatchObject({
      userId: "user-1",
      deletedAt: null,
      type: "EXPENSE",
      categoryId: { in: ["c1", "c2"] },
    });
    expect(arg.where.date).toHaveProperty("gte");
    expect(arg.where.date).toHaveProperty("lt");

    // Negative _sum.amount becomes positive spent; rollover off => carriedAmount 0.
    expect(result.rows).toEqual([
      { id: "b1", category: { name: "Groceries", color: "#000000", icon: "ShoppingCart" }, spent: 100.5, limit: 400, rollover: false, carriedAmount: 0 },
      { id: "b2", category: { name: "Dining", color: "#000000", icon: "ShoppingCart" }, spent: 50, limit: 200, rollover: false, carriedAmount: 0 },
    ]);
  });

  it("maps a budget whose category is absent from the groupBy result to spent 0", async () => {
    budgetFindMany.mockResolvedValue([
      budgetRow("b1", "c1", 400, "Groceries"),
      budgetRow("b2", "c2", 200, "Dining"),
    ] as never);
    // Only c1 had spend this period; c2 is missing entirely.
    transactionGroupBy.mockResolvedValue([
      { categoryId: "c1", _sum: { amount: -75 } },
    ] as never);

    const result = await getBudgets("user-1", 6, 2026);

    expect(result.rows.find((r) => r.id === "b1")?.spent).toBe(75);
    expect(result.rows.find((r) => r.id === "b2")?.spent).toBe(0);
  });

  it("coalesces a null _sum.amount to spent 0", async () => {
    budgetFindMany.mockResolvedValue([
      budgetRow("b1", "c1", 400, "Groceries"),
    ] as never);
    transactionGroupBy.mockResolvedValue([
      { categoryId: "c1", _sum: { amount: null } },
    ] as never);

    const result = await getBudgets("user-1", 6, 2026);

    expect(result.rows[0].spent).toBe(0);
  });

  it("returns empty rows and a zeroed summary when there are no budgets", async () => {
    budgetFindMany.mockResolvedValue([] as never);
    transactionGroupBy.mockResolvedValue([] as never);

    const result = await getBudgets("user-1", 6, 2026);

    expect(result.rows).toEqual([]);
    expect(result.summary.total).toBe(0);
    expect(result.summary.categoryCount).toBe(0);
    // in: [] guards against summing unbudgeted categories.
    const arg = transactionGroupBy.mock.calls[0][0] as {
      where: { categoryId: { in: string[] } };
    };
    expect(arg.where.categoryId.in).toEqual([]);
  });

  it("does no carry walk-back when no budget in the period has rollover", async () => {
    budgetFindMany.mockResolvedValue([
      budgetRow("b1", "c1", 400, "Groceries", false),
    ] as never);
    transactionGroupBy.mockResolvedValue([
      { categoryId: "c1", _sum: { amount: -100 } },
    ] as never);

    const result = await getBudgets("user-1", 6, 2026);

    // Only the in-month spend query ran — zero extra queries for the carry.
    expect(budgetFindMany).toHaveBeenCalledTimes(1);
    expect(transactionGroupBy).toHaveBeenCalledTimes(1);
    expect(result.rows[0].carriedAmount).toBe(0);
  });

  it("accumulates carry across a Jan→Feb→Mar rollover run (with a sign flip)", async () => {
    // Mar period: one rollover-on budget (c1, base 400).
    budgetFindMany.mockResolvedValueOnce([
      budgetRow("bMar", "c1", 400, "Groceries", true),
    ] as never);
    transactionGroupBy.mockResolvedValueOnce([
      { categoryId: "c1", _sum: { amount: -100 } }, // Mar in-month spend
    ] as never);

    // Walk-back step 0 — Feb: base 400, spent 250.
    budgetFindMany.mockResolvedValueOnce([
      { categoryId: "c1", amount: 400 },
    ] as never);
    transactionGroupBy.mockResolvedValueOnce([
      { categoryId: "c1", _sum: { amount: -250 } },
    ] as never);

    // Walk-back step 1 — Jan: base 400, spent 500 (overspent → negative carry).
    budgetFindMany.mockResolvedValueOnce([
      { categoryId: "c1", amount: 400 },
    ] as never);
    transactionGroupBy.mockResolvedValueOnce([
      { categoryId: "c1", _sum: { amount: -500 } },
    ] as never);

    // Walk-back step 2 — Dec: no budget → run ends.
    budgetFindMany.mockResolvedValueOnce([] as never);
    transactionGroupBy.mockResolvedValueOnce([] as never);

    const result = await getBudgets("user-1", 3, 2026);

    // Jan: 400 + 0 − 500 = −100 ; Feb: 400 + (−100) − 250 = 50 → Mar carryIn = 50.
    const row = result.rows[0];
    expect(row.rollover).toBe(true);
    expect(row.limit).toBe(400); // base, unchanged
    expect(row.carriedAmount).toBe(50);
    expect(row.spent).toBe(100);
    // Effective March total reflects the carry (base + carry).
    expect(row.limit + row.carriedAmount).toBe(450);
  });

  it("resets carry to 0 when the run breaks at the immediately-preceding month", async () => {
    // Mar period: rollover-on c1.
    budgetFindMany.mockResolvedValueOnce([
      budgetRow("bMar", "c1", 400, "Groceries", true),
    ] as never);
    transactionGroupBy.mockResolvedValueOnce([
      { categoryId: "c1", _sum: { amount: -100 } },
    ] as never);

    // Feb: no rollover budget for c1 → run is empty, carry 0, walk stops here.
    budgetFindMany.mockResolvedValueOnce([] as never);
    transactionGroupBy.mockResolvedValueOnce([] as never);

    const result = await getBudgets("user-1", 3, 2026);

    expect(result.rows[0].carriedAmount).toBe(0);
    // Stopped after Feb — never queried January.
    expect(budgetFindMany).toHaveBeenCalledTimes(2);
  });

  it("includes split-line spend for a budgeted category whose parent tx category is null", async () => {
    budgetFindMany.mockResolvedValue([
      budgetRow("b1", "c1", 400, "Groceries"),
      budgetRow("b2", "c2", 200, "Household"),
    ] as never);
    // Non-split expenses: only c2 has a directly-categorized expense (€30).
    transactionGroupBy.mockResolvedValue([
      { categoryId: "c2", _sum: { amount: -30 } },
    ] as never);
    // A split transaction (parent categoryId null) attributes €55→c1, €25→c2.
    splitGroupBy.mockResolvedValue([
      { categoryId: "c1", _sum: { amount: 55 } },
      { categoryId: "c2", _sum: { amount: 25 } },
    ] as never);

    const result = await getBudgets("user-1", 6, 2026);

    // c1's spend comes entirely from the split line; c2 merges direct + split.
    expect(result.rows.find((r) => r.id === "b1")?.spent).toBe(55);
    expect(result.rows.find((r) => r.id === "b2")?.spent).toBe(55); // 30 + 25
  });
});

describe("resolveRolloverCarry", () => {
  beforeEach(() => {
    budgetFindMany.mockReset();
    transactionGroupBy.mockReset();
    splitGroupBy.mockReset();
    splitGroupBy.mockResolvedValue([] as never); // no split lines by default
  });

  it("short-circuits to an empty map with zero queries for an empty rollover set", async () => {
    const map = await resolveRolloverCarry("user-1", 6, 2026, []);

    expect(map.size).toBe(0);
    expect(budgetFindMany).not.toHaveBeenCalled();
    expect(transactionGroupBy).not.toHaveBeenCalled();
  });
});
