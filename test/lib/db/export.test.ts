import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  exportTxWhere,
  getTransactionsForExport,
  getFullExport,
  EXPORT_ENTITY_CLASS,
} from "@/lib/db/export";
import { EXPORT_MAX_TRANSACTIONS } from "@/lib/system-constants";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findMany: vi.fn(), groupBy: vi.fn() },
    financialAccount: { findMany: vi.fn() },
    category: { findMany: vi.fn() },
    budget: { findMany: vi.fn() },
    goal: { findMany: vi.fn() },
    recurringTemplate: { findMany: vi.fn() },
  },
}));

const txFindMany = vi.mocked(prisma.transaction.findMany);
const txGroupBy = vi.mocked(prisma.transaction.groupBy);
const accountFindMany = vi.mocked(prisma.financialAccount.findMany);
const categoryFindMany = vi.mocked(prisma.category.findMany);
const budgetFindMany = vi.mocked(prisma.budget.findMany);
const goalFindMany = vi.mocked(prisma.goal.findMany);
const templateFindMany = vi.mocked(prisma.recurringTemplate.findMany);

beforeEach(() => {
  vi.clearAllMocks();
  txFindMany.mockResolvedValue([] as never);
  txGroupBy.mockResolvedValue([] as never);
  accountFindMany.mockResolvedValue([] as never);
  categoryFindMany.mockResolvedValue([] as never);
  budgetFindMany.mockResolvedValue([] as never);
  goalFindMany.mockResolvedValue([] as never);
  templateFindMany.mockResolvedValue([] as never);
});

describe("exportTxWhere (C1, S2, D1)", () => {
  it("always scopes by userId and excludes soft-deleted", () => {
    const where = exportTxWhere("u1", undefined);
    expect(where.userId).toBe("u1");
    expect(where.deletedAt).toBeNull();
  });

  it("excludes archived accounts in the all-accounts view (no accountId)", () => {
    const where = exportTxWhere("u1", undefined);
    expect(where.financialAccount).toEqual({ isArchived: false });
  });

  it("honors an explicit account by id without an isArchived filter", () => {
    const where = exportTxWhere("u1", "acc1");
    expect(where.financialAccount).toEqual({ id: "acc1" });
  });
});

describe("getTransactionsForExport", () => {
  it("passes exportTxWhere, no type filter, and the cap+1 take", async () => {
    await getTransactionsForExport("u1", undefined);

    const args = txFindMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      take: number;
    };
    expect(args.where).toEqual(exportTxWhere("u1", undefined));
    expect(args.where).not.toHaveProperty("type"); // D4: all types
    expect(args.take).toBe(EXPORT_MAX_TRANSACTIONS + 1); // D8
  });

  it("normalizes Decimal→number, Date→YYYY-MM-DD, createdAt→ISO, null category", async () => {
    txFindMany.mockResolvedValue([
      {
        id: "t1",
        date: new Date("2026-06-15T00:00:00.000Z"),
        amount: "-47.00",
        type: "EXPENSE",
        merchant: "Aldi",
        note: null,
        isTransferLeg: false,
        transferPairId: null,
        financialAccountId: "a1",
        categoryId: null,
        recurringTemplateId: null,
        createdAt: new Date("2026-06-15T10:30:00.000Z"),
        financialAccount: { name: "Checking" },
        category: null,
      },
    ] as never);

    const [row] = await getTransactionsForExport("u1", undefined);

    expect(row.amount).toBe(-47);
    expect(row.date).toBe("2026-06-15");
    expect(row.createdAt).toBe("2026-06-15T10:30:00.000Z");
    expect(row.category).toBeNull(); // D5: no "Uncategorized" synthesis
    expect(row.account).toBe("Checking");
  });
});

describe("getFullExport scoping asymmetry (C2 / §3.2)", () => {
  it("scopes account-bound queries to ?account= but leaves global queries userId-only", async () => {
    await getFullExport("u1", "acc1");

    // account-bound: financialAccount by id
    const accountWhere = accountFindMany.mock.calls[0][0]?.where;
    expect(accountWhere).toEqual({ userId: "u1", id: "acc1" });

    // account-bound: recurring templates by financialAccountId
    const templateWhere = templateFindMany.mock.calls[0][0]?.where;
    expect(templateWhere).toEqual({ userId: "u1", financialAccountId: "acc1" });

    // account-bound: transactions via exportTxWhere
    const txWhere = txFindMany.mock.calls[0][0]?.where;
    expect(txWhere).toEqual(exportTxWhere("u1", "acc1"));

    // global: budgets + goals are userId-only — NO financialAccountId filter
    expect(budgetFindMany.mock.calls[0][0]?.where).toEqual({ userId: "u1" });
    expect(goalFindMany.mock.calls[0][0]?.where).toEqual({ userId: "u1" });
  });

  it("filters categories to user-owned only (isSystem:false, D6)", async () => {
    await getFullExport("u1", undefined);
    expect(categoryFindMany.mock.calls[0][0]?.where).toEqual({
      userId: "u1",
      isSystem: false,
    });
  });

  it("scopes account-bound queries to active accounts when no ?account=", async () => {
    await getFullExport("u1", undefined);
    expect(accountFindMany.mock.calls[0][0]?.where).toEqual({
      userId: "u1",
      isArchived: false,
    });
    expect(templateFindMany.mock.calls[0][0]?.where).toEqual({
      userId: "u1",
      financialAccount: { isArchived: false },
    });
  });

  it("derives account balance from a single all-account groupBy (no N+1)", async () => {
    accountFindMany.mockResolvedValue([
      {
        id: "a1",
        name: "Checking",
        type: "CHECKING",
        currency: "EUR",
        startingBalance: "100.00",
        color: null,
        icon: null,
        isArchived: false,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ] as never);
    txGroupBy.mockResolvedValue([
      { financialAccountId: "a1", _sum: { amount: "-30.00" } },
    ] as never);

    const result = await getFullExport("u1", undefined);

    expect(txGroupBy).toHaveBeenCalledTimes(1);
    expect(result.accounts[0].balance).toBe(70);
    expect(result.accounts[0].startingBalance).toBe(100);
  });
});

describe("EXPORT_ENTITY_CLASS completeness (§3.4 drift guard)", () => {
  it("classifies every domain entity, with auth/transient rows as 'never'", () => {
    expect(Object.keys(EXPORT_ENTITY_CLASS).sort()).toEqual(
      [
        "budget",
        "category",
        "financialAccount",
        "goal",
        "recurringDraft",
        "recurringTemplate",
        "transaction",
        "user",
      ].sort()
    );
    expect(EXPORT_ENTITY_CLASS.recurringDraft).toBe("never");
    expect(EXPORT_ENTITY_CLASS.user).toBe("never");
  });
});
