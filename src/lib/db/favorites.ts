import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { FavoriteOption, ManageableFavorite } from "@/types/favorites";

export const FAVORITE_ORDER_BY: Prisma.FavoriteOrderByWithRelationInput[] = [
  { sortOrder: { sort: "asc", nulls: "last" } },
  { name: "asc" },
];

type FavoriteRow = {
  id: string;
  name: string;
  type: string;
  amount: { toString(): string } | number | null;
  categoryId: string | null;
  financialAccountId: string | null;
  merchant: string | null;
  note: string | null;
};

function toFavoriteOption(row: FavoriteRow): FavoriteOption {
  return {
    id: row.id,
    name: row.name,
    type: row.type === "INCOME" ? "INCOME" : "EXPENSE",
    amount: row.amount === null ? null : Number(row.amount),
    categoryId: row.categoryId,
    financialAccountId: row.financialAccountId,
    merchant: row.merchant,
    note: row.note,
  };
}

export async function getUserFavorites(
  userId: string
): Promise<FavoriteOption[]> {
  const favorites = await prisma.favorite.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      type: true,
      amount: true,
      categoryId: true,
      financialAccountId: true,
      merchant: true,
      note: true,
    },
    orderBy: FAVORITE_ORDER_BY,
  });

  return favorites.map(toFavoriteOption);
}

export async function getManageableFavorites(
  userId: string
): Promise<ManageableFavorite[]> {
  const favorites = await prisma.favorite.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      type: true,
      amount: true,
      categoryId: true,
      financialAccountId: true,
      merchant: true,
      note: true,
      category: { select: { name: true } },
      financialAccount: { select: { name: true, isArchived: true } },
    },
    orderBy: FAVORITE_ORDER_BY,
  });

  return favorites.map((favorite) => ({
    ...toFavoriteOption(favorite),
    categoryName: favorite.category?.name ?? null,
    accountName: favorite.financialAccount?.name ?? null,
    accountArchived: favorite.financialAccount?.isArchived ?? false,
  }));
}
