import type { FavoriteOption } from "@/types/favorites";

export interface FavoritePrefill {
  type: "INCOME" | "EXPENSE";
  amount: string;
  focusAmount: boolean;
  date: string;
  categoryId: string;
  accountId: string | null;
  merchant: string;
  note: string;
}

interface LoadedFavoriteRefs {
  categoryIds: ReadonlySet<string>;
  accountIds: ReadonlySet<string>;
}

export function buildFavoritePrefill(
  favorite: FavoriteOption,
  loaded: LoadedFavoriteRefs,
  today: string
): FavoritePrefill {
  const hasAmount = favorite.amount !== null;
  const categoryId =
    favorite.categoryId && loaded.categoryIds.has(favorite.categoryId)
      ? favorite.categoryId
      : "";
  const accountId =
    favorite.financialAccountId &&
    loaded.accountIds.has(favorite.financialAccountId)
      ? favorite.financialAccountId
      : null;

  return {
    type: favorite.type,
    amount: hasAmount ? String(favorite.amount) : "",
    focusAmount: !hasAmount,
    date: today,
    categoryId,
    accountId,
    merchant: favorite.merchant ?? "",
    note: favorite.note ?? "",
  };
}
