import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCategorySpend } from "@/lib/db/split-spend";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { groupBy: vi.fn() },
    transactionSplit: { groupBy: vi.fn() },
  },
}));

const txGroupBy = vi.mocked(prisma.transaction.groupBy);
const splitGroupBy = vi.mocked(prisma.transactionSplit.groupBy);

const WINDOW = { gte: new Date("2026-06-01"), lt: new Date("2026-07-01") };

beforeEach(() => {
  txGroupBy.mockReset();
  splitGroupBy.mockReset();
  txGroupBy.mockResolvedValue([] as never);
  splitGroupBy.mockResolvedValue([] as never);
});

describe("getCategorySpend", () => {
  it("conserves spend: Σ per-category == Σ abs(EXPENSE amount), split or not", async () => {
    // Two non-split expenses (c1 −40, c2 −10) and a split parent attributing
    // 55→c1 and 25→c3. Grand total abs = 40 + 10 + 55 + 25 = 130.
    txGroupBy.mockResolvedValue([
      { categoryId: "c1", _sum: { amount: -40 } },
      { categoryId: "c2", _sum: { amount: -10 } },
    ] as never);
    splitGroupBy.mockResolvedValue([
      { categoryId: "c1", _sum: { amount: 55 } },
      { categoryId: "c3", _sum: { amount: 25 } },
    ] as never);

    const map = await getCategorySpend("u1", WINDOW);
    const total = [...map.values()].reduce((s, v) => s + v, 0);

    expect(total).toBe(130);
    // A split attributes to each LINE's category, merged with any direct spend.
    expect(map.get("c1")).toBe(95); // 40 direct + 55 split
    expect(map.get("c2")).toBe(10);
    expect(map.get("c3")).toBe(25);
  });

  it("query (a) targets EXPENSE, non-deleted, no-split rows in the window", async () => {
    await getCategorySpend("u1", WINDOW);
    const where = txGroupBy.mock.calls[0][0].where as Record<string, unknown>;
    expect(where).toMatchObject({
      userId: "u1",
      deletedAt: null,
      type: "EXPENSE",
      splits: { none: {} },
    });
    expect(where.date).toBe(WINDOW);
  });

  it("query (b) scopes split lines through the parent transaction predicate", async () => {
    await getCategorySpend("u1", WINDOW);
    const where = splitGroupBy.mock.calls[0][0].where as {
      transaction: Record<string, unknown>;
    };
    expect(where.transaction).toMatchObject({
      userId: "u1",
      deletedAt: null,
      type: "EXPENSE",
    });
  });

  it("keeps a null split category under the null key (Reports Uncategorized)", async () => {
    splitGroupBy.mockResolvedValue([
      { categoryId: null, _sum: { amount: 12 } },
    ] as never);

    const map = await getCategorySpend("u1", WINDOW);
    expect(map.get(null)).toBe(12);
  });

  it("scopes both queries to the given categoryIds (budget path)", async () => {
    await getCategorySpend("u1", WINDOW, { categoryIds: ["c1", "c2"] });

    expect(
      (txGroupBy.mock.calls[0][0].where as Record<string, unknown>).categoryId
    ).toEqual({ in: ["c1", "c2"] });
    expect(
      (splitGroupBy.mock.calls[0][0].where as Record<string, unknown>).categoryId
    ).toEqual({ in: ["c1", "c2"] });
  });

  it("applies the accountFilter to both the parent row and split-line queries", async () => {
    const accountFilter = { isArchived: false };
    await getCategorySpend("u1", WINDOW, { accountFilter });

    const txWhere = txGroupBy.mock.calls[0][0].where as Record<string, unknown>;
    const splitWhere = splitGroupBy.mock.calls[0][0].where as {
      transaction: Record<string, unknown>;
    };
    expect(txWhere.financialAccount).toEqual(accountFilter);
    expect(splitWhere.transaction.financialAccount).toEqual(accountFilter);
  });

  it("drops zero-sum groups from the map", async () => {
    txGroupBy.mockResolvedValue([
      { categoryId: "c1", _sum: { amount: 0 } },
      { categoryId: "c2", _sum: { amount: null } },
    ] as never);

    const map = await getCategorySpend("u1", WINDOW);
    expect(map.size).toBe(0);
  });
});
