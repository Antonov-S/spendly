import { describe, it, expect, vi, beforeEach } from "vitest";
import { getImportTargets, countExistingForDedup } from "@/lib/db/import";
import { prisma } from "@/lib/prisma";
import { dedupKey } from "@/lib/import/dedup";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    financialAccount: { findMany: vi.fn() },
    category: { findMany: vi.fn() },
    tag: { findMany: vi.fn() },
    transaction: { findMany: vi.fn() },
  },
}));

const accountFindMany = vi.mocked(prisma.financialAccount.findMany);
const categoryFindMany = vi.mocked(prisma.category.findMany);
const tagFindMany = vi.mocked(prisma.tag.findMany);
const txFindMany = vi.mocked(prisma.transaction.findMany);

beforeEach(() => {
  accountFindMany.mockReset();
  categoryFindMany.mockReset();
  tagFindMany.mockReset();
  txFindMany.mockReset();
});

describe("getImportTargets", () => {
  it("scopes active accounts and system+own categories to the user", async () => {
    accountFindMany.mockResolvedValue([{ id: "a1", name: "Checking" }] as never);
    categoryFindMany.mockResolvedValue([{ id: "c1", name: "Groceries" }] as never);
    tagFindMany.mockResolvedValue([{ id: "t1", name: "Trip" }] as never);

    const res = await getImportTargets("user-1");

    expect(accountFindMany.mock.calls[0][0]).toMatchObject({
      where: { userId: "user-1", isArchived: false },
      select: { id: true, name: true },
    });
    expect(categoryFindMany.mock.calls[0][0]).toMatchObject({
      where: { OR: [{ userId: null }, { userId: "user-1" }] },
      select: { id: true, name: true },
    });
    expect(tagFindMany.mock.calls[0][0]).toMatchObject({
      where: { userId: "user-1" },
      select: { id: true, name: true },
    });
    expect(res.accounts).toEqual([{ id: "a1", name: "Checking" }]);
    expect(res.categories).toEqual([{ id: "c1", name: "Groceries" }]);
    expect(res.tags).toEqual([{ id: "t1", name: "Trip" }]);
  });
});

describe("countExistingForDedup", () => {
  it("returns an empty map and runs no query for no dates", async () => {
    const res = await countExistingForDedup("user-1", "a1", []);
    expect(res.size).toBe(0);
    expect(txFindMany).not.toHaveBeenCalled();
  });

  it("scopes the query to the user, account, non-deleted, and the batch dates only", async () => {
    txFindMany.mockResolvedValue([] as never);

    await countExistingForDedup("user-1", "a1", ["2026-03-04", "2026-03-04"]);

    const arg = txFindMany.mock.calls[0][0] as {
      where: Record<string, unknown> & { date: { in: Date[] } };
    };
    expect(arg.where).toMatchObject({
      userId: "user-1",
      financialAccountId: "a1",
      deletedAt: null,
    });
    // Distinct dates only (deduped) → one Date in the `in` list.
    expect(arg.where.date.in).toHaveLength(1);
    expect(arg.where.date.in[0]).toBeInstanceOf(Date);
  });

  it("builds a signed-amount dedup-key count map from existing rows", async () => {
    txFindMany.mockResolvedValue([
      {
        date: new Date(Date.UTC(2026, 2, 4)),
        amount: -3,
        type: "EXPENSE",
        merchant: "Cafe",
        note: null,
      },
      {
        date: new Date(Date.UTC(2026, 2, 4)),
        amount: -3,
        type: "EXPENSE",
        merchant: "Cafe",
        note: null,
      },
    ] as never);

    const res = await countExistingForDedup("user-1", "a1", ["2026-03-04"]);
    const key = dedupKey({
      date: "2026-03-04",
      amount: -3,
      type: "EXPENSE",
      merchant: "Cafe",
      note: null,
    });
    expect(res.get(key)).toBe(2);
  });
});
