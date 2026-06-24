import { describe, it, expect, vi, beforeEach } from "vitest";
import { getBudgets } from "@/lib/db/budgets";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    budget: { findMany: vi.fn() },
    transaction: { groupBy: vi.fn() },
  },
}));

const budgetFindMany = vi.mocked(prisma.budget.findMany);
const transactionGroupBy = vi.mocked(prisma.transaction.groupBy);

function budgetRow(
  id: string,
  categoryId: string,
  amount: number,
  name: string
) {
  return {
    id,
    categoryId,
    amount,
    currency: "EUR",
    category: { name, color: "#000000", icon: "ShoppingCart" },
  };
}

describe("getBudgets", () => {
  beforeEach(() => {
    budgetFindMany.mockReset();
    transactionGroupBy.mockReset();
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

    // Negative _sum.amount becomes positive spent.
    expect(result.rows).toEqual([
      { id: "b1", category: { name: "Groceries", color: "#000000", icon: "ShoppingCart" }, spent: 100.5, limit: 400 },
      { id: "b2", category: { name: "Dining", color: "#000000", icon: "ShoppingCart" }, spent: 50, limit: 200 },
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
});
