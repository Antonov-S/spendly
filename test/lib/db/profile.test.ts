import { describe, it, expect, vi, beforeEach } from "vitest";
import { getProfileStats } from "@/lib/db/profile";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    financialAccount: { count: vi.fn() },
    transaction: { count: vi.fn() },
    budget: { count: vi.fn() },
    goal: { count: vi.fn() },
    recurringTemplate: { count: vi.fn() },
  },
}));

const accountCount = vi.mocked(prisma.financialAccount.count);
const transactionCount = vi.mocked(prisma.transaction.count);
const budgetCount = vi.mocked(prisma.budget.count);
const goalCount = vi.mocked(prisma.goal.count);
const recurringCount = vi.mocked(prisma.recurringTemplate.count);

describe("getProfileStats", () => {
  beforeEach(() => {
    accountCount.mockReset();
    transactionCount.mockReset();
    budgetCount.mockReset();
    goalCount.mockReset();
    recurringCount.mockReset();
  });

  it("returns counts keyed by item type", async () => {
    accountCount.mockResolvedValue(3 as never);
    transactionCount.mockResolvedValue(42 as never);
    budgetCount.mockResolvedValue(7 as never);
    goalCount.mockResolvedValue(2 as never);
    recurringCount.mockResolvedValue(5 as never);

    const result = await getProfileStats("user-1");

    expect(result).toEqual({
      financialAccounts: 3,
      transactions: 42,
      budgets: 7,
      goals: 2,
      recurringTemplates: 5,
    });
  });

  it("scopes every count to the user and excludes deleted transactions", async () => {
    accountCount.mockResolvedValue(0 as never);
    transactionCount.mockResolvedValue(0 as never);
    budgetCount.mockResolvedValue(0 as never);
    goalCount.mockResolvedValue(0 as never);
    recurringCount.mockResolvedValue(0 as never);

    await getProfileStats("user-1");

    expect(accountCount).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(transactionCount).toHaveBeenCalledWith({
      where: { userId: "user-1", deletedAt: null },
    });
    expect(budgetCount).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(goalCount).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(recurringCount).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
  });
});
