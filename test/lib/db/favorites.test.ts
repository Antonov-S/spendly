import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FAVORITE_ORDER_BY,
  getManageableFavorites,
  getUserFavorites,
} from "@/lib/db/favorites";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    favorite: { findMany: vi.fn() },
  },
}));

const favoriteFindMany = vi.mocked(prisma.favorite.findMany);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUserFavorites", () => {
  it("scopes by userId, applies shared ordering, and maps Decimal values", async () => {
    favoriteFindMany.mockResolvedValue([
      {
        id: "f1",
        name: "Coffee",
        type: "EXPENSE",
        amount: { toString: () => "3.50" },
        categoryId: "cat1",
        financialAccountId: "acc1",
        merchant: "Cafe",
        note: null,
      },
      {
        id: "f2",
        name: "Groceries",
        type: "EXPENSE",
        amount: null,
        categoryId: null,
        financialAccountId: null,
        merchant: null,
        note: null,
      },
    ] as never);

    const res = await getUserFavorites("u1");

    expect(favoriteFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1" },
        orderBy: FAVORITE_ORDER_BY,
      })
    );
    expect(res).toEqual([
      {
        id: "f1",
        name: "Coffee",
        type: "EXPENSE",
        amount: 3.5,
        categoryId: "cat1",
        financialAccountId: "acc1",
        merchant: "Cafe",
        note: null,
      },
      {
        id: "f2",
        name: "Groceries",
        type: "EXPENSE",
        amount: null,
        categoryId: null,
        financialAccountId: null,
        merchant: null,
        note: null,
      },
    ]);
  });
});

describe("getManageableFavorites", () => {
  it("projects joined names and detects archived stored accounts only", async () => {
    favoriteFindMany.mockResolvedValue([
      {
        id: "f1",
        name: "Coffee",
        type: "EXPENSE",
        amount: "3.50",
        categoryId: "cat1",
        financialAccountId: "acc1",
        merchant: "Cafe",
        note: null,
        category: { name: "Dining" },
        financialAccount: { name: "Cash", isArchived: true },
      },
      {
        id: "f2",
        name: "No account",
        type: "INCOME",
        amount: null,
        categoryId: null,
        financialAccountId: null,
        merchant: null,
        note: "bonus",
        category: null,
        financialAccount: null,
      },
    ] as never);

    const res = await getManageableFavorites("u1");

    expect(favoriteFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1" },
        orderBy: FAVORITE_ORDER_BY,
        select: expect.objectContaining({
          category: { select: { name: true } },
          financialAccount: { select: { name: true, isArchived: true } },
        }),
      })
    );
    expect(res).toEqual([
      {
        id: "f1",
        name: "Coffee",
        type: "EXPENSE",
        amount: 3.5,
        categoryId: "cat1",
        financialAccountId: "acc1",
        merchant: "Cafe",
        note: null,
        categoryName: "Dining",
        accountName: "Cash",
        accountArchived: true,
      },
      {
        id: "f2",
        name: "No account",
        type: "INCOME",
        amount: null,
        categoryId: null,
        financialAccountId: null,
        merchant: null,
        note: "bonus",
        categoryName: null,
        accountName: null,
        accountArchived: false,
      },
    ]);
  });
});
