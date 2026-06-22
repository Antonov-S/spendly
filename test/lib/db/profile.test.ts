import { describe, it, expect, vi, beforeEach } from "vitest";
import { getProfileStats, getUserOverview } from "@/lib/db/profile";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
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
const userFindUnique = vi.mocked(prisma.user.findUnique);

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

describe("getUserOverview", () => {
  beforeEach(() => {
    userFindUnique.mockReset();
  });

  // The projection is a drift-prevention contract shared by /profile and
  // /settings — pin its exact shape so an accidental column drop/add is caught.
  it("scopes by id and selects exactly the agreed columns", async () => {
    userFindUnique.mockResolvedValue(null as never);

    await getUserOverview("u1");

    expect(userFindUnique).toHaveBeenCalledTimes(1);
    const arg = userFindUnique.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "u1" });
    expect(arg.select).toEqual({
      name: true,
      email: true,
      image: true,
      password: true,
      isPro: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      preferredCurrency: true,
      createdAt: true,
    });
  });
});
