/** A saved transaction shortcut for the drawer strip. */
export interface FavoriteOption {
  id: string;
  name: string;
  type: "INCOME" | "EXPENSE";
  /** Major-unit amount, e.g. 3.5 for EUR 3.50; null means prompt on use. */
  amount: number | null;
  categoryId: string | null;
  financialAccountId: string | null;
  merchant: string | null;
  note: string | null;
}

/** Favorite row for the `/settings` management card. */
export interface ManageableFavorite extends FavoriteOption {
  categoryName: string | null;
  accountName: string | null;
  /** True when the stored account exists but is archived. */
  accountArchived: boolean;
}
