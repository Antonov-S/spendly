import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getDeletedTransactions,
  getDeletedTransactionCount,
} from "@/lib/db/transactions";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findMany: vi.fn(), count: vi.fn() },
  },
}));

const findMany = vi.mocked(prisma.transaction.findMany);
const count = vi.mocked(prisma.transaction.count);

/** Build a queried-row shape matching the fetcher's FEED_INCLUDE projection. */
function row(overrides: Record<string, unknown>) {
  return {
    id: "t1",
    type: "EXPENSE",
    amount: -10,
    currency: "EUR",
    date: new Date(Date.UTC(2026, 5, 15)),
    merchant: "Pret",
    note: null,
    isTransferLeg: false,
    transferPairId: null,
    financialAccountId: "acc1",
    deletedAt: new Date(Date.UTC(2026, 5, 20)),
    category: { name: "Dining", color: "#000000", icon: "UtensilsCrossed" },
    financialAccount: { name: "Checking" },
    tags: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getDeletedTransactions", () => {
  it("queries only soft-deleted rows, newest deletion first, with no archived exclusion", async () => {
    findMany.mockResolvedValue([]);

    await getDeletedTransactions("u1");

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1", deletedAt: { not: null } },
        orderBy: [{ deletedAt: "desc" }, { id: "desc" }],
        take: 50,
      })
    );
    // No financialAccount archived filter — deleted rows stay recoverable
    // regardless of their account's archive state.
    const arg = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where).not.toHaveProperty("financialAccount");
  });

  it("sorts a row's tags by name (not join order)", async () => {
    findMany.mockResolvedValue([
      row({
        id: "t1",
        tags: [
          { tag: { id: "z", name: "zeta", color: null } },
          { tag: { id: "a", name: "alpha", color: "#10B981" } },
        ],
      }) as never,
    ]);

    const rows = await getDeletedTransactions("u1");
    expect(rows[0].tags.map((t) => t.name)).toEqual(["alpha", "zeta"]);
  });

  it("attaches deletedAt to each collapsed row", async () => {
    const deletedAt = new Date(Date.UTC(2026, 5, 20));
    findMany.mockResolvedValue([row({ id: "t1", deletedAt }) as never]);

    const rows = await getDeletedTransactions("u1");

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("t1");
    expect(rows[0].deletedAt).toEqual(deletedAt);
  });

  it("collapses both legs of a deleted transfer into one row", async () => {
    const deletedAt = new Date(Date.UTC(2026, 5, 21));
    findMany.mockResolvedValue([
      row({
        id: "out",
        type: "TRANSFER",
        amount: -100,
        isTransferLeg: true,
        transferPairId: "pair1",
        financialAccountId: "acc1",
        financialAccount: { name: "Checking" },
        category: null,
        deletedAt,
      }) as never,
      row({
        id: "in",
        type: "TRANSFER",
        amount: 100,
        isTransferLeg: true,
        transferPairId: "pair1",
        financialAccountId: "acc2",
        financialAccount: { name: "Savings" },
        category: null,
        deletedAt,
      }) as never,
    ]);

    const rows = await getDeletedTransactions("u1");

    expect(rows).toHaveLength(1);
    // All-accounts collapse keeps the outflow leg as canonical.
    expect(rows[0].id).toBe("out");
    expect(rows[0].deletedAt).toEqual(deletedAt);
  });
});

describe("getDeletedTransactionCount", () => {
  it("counts only soft-deleted rows scoped to the user", async () => {
    count.mockResolvedValue(3 as never);

    const result = await getDeletedTransactionCount("u1");

    expect(result).toBe(3);
    expect(count).toHaveBeenCalledWith({
      where: { userId: "u1", deletedAt: { not: null } },
    });
  });
});
