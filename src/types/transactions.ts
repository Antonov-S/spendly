/** The three transaction kinds, as stored on `Transaction.type`. */
export type TransactionTypeValue = "INCOME" | "EXPENSE" | "TRANSFER";

/**
 * Category reference for feed rows. Unlike `CategoryRef` (dashboard), the icon
 * stays a raw Lucide name string so feed rows remain serializable across the
 * server→client boundary (the feed is a client component / server-action
 * payload). The name is resolved to a component at render time via `resolveIcon`.
 */
export interface FeedCategory {
  name: string;
  color: string;
  /** Raw Lucide icon name. */
  icon: string;
}

/** Account option for the global topbar account selector. */
export interface AccountOption {
  id: string;
  name: string;
}

/** Category option for the filter-bar multi-select picker. */
export interface CategoryOption {
  id: string;
  name: string;
  /** Hex accent color. */
  color: string;
  /** Raw Lucide icon name (resolved at render time). */
  icon: string;
}

/**
 * Feed filter state, parsed from URL search params. All fields are optional —
 * an empty object means "all transactions". `type` undefined = the "All" pill.
 */
export interface TransactionFilters {
  type?: TransactionTypeValue;
  /** Inclusive start of the date range (calendar date at UTC midnight). */
  from?: Date;
  /** Inclusive end of the date range (calendar date at UTC midnight). */
  to?: Date;
  categoryIds?: string[];
  /** A specific account from the topbar selector; undefined = all accounts. */
  accountId?: string;
  /** Free-text search across merchant, note, and category name. */
  q?: string;
}

/**
 * A normalized transaction leg as returned by the fetcher, before transfer
 * collapse. Category icons are already resolved to components here so the pure
 * collapse helper stays free of icon-map dependencies.
 */
export interface TransactionLeg {
  id: string;
  type: TransactionTypeValue;
  /** Signed amount: negative = outflow/expense. */
  amount: number;
  currency: string;
  /** Calendar date (stored `@db.Date`, i.e. UTC midnight). */
  date: Date;
  merchant: string | null;
  note: string | null;
  isTransferLeg: boolean;
  transferPairId: string | null;
  financialAccountId: string;
  accountName: string;
  category: FeedCategory | null;
}

/** A single display row in the feed, after transfer pairs are collapsed. */
export interface FeedTransaction {
  id: string;
  type: TransactionTypeValue;
  description: string;
  category: FeedCategory | null;
  date: Date;
  currency: string;
  /** Signed amount. For transfers this is the outflow leg's amount. */
  amount: number;
  accountName: string;
  /** For transfers: the counterparty account ("to" when all-accounts). */
  counterpartyAccountName?: string;
  isTransferLeg: boolean;
  transferPairId?: string;
}

/**
 * A soft-deleted transaction shown in the `/trash` recovery list. It is a feed
 * row plus the deletion timestamp (which drives the "deleted X ago" label and
 * the newest-first ordering).
 */
export interface TrashTransaction extends FeedTransaction {
  /** When the row was soft-deleted. */
  deletedAt: Date;
}

/** Date-bucketed feed section (Today / Yesterday / "MMM D, YYYY"). */
export interface TransactionGroup {
  label: string;
  items: FeedTransaction[];
}

/** A page of feed rows plus the cursor for the next page (id of last row). */
export interface TransactionPage {
  rows: FeedTransaction[];
  nextCursor: string | null;
}

/**
 * Editable shape used to pre-fill the drawer when a feed row is clicked. The
 * `amount` is the positive magnitude (the stored sign is re-derived on save).
 * `date` is a "YYYY-MM-DD" string ready for the date input.
 */
export interface EditableTransaction {
  /** Canonical row id (the clicked leg for transfers). */
  id: string;
  type: TransactionTypeValue;
  /** Positive magnitude. */
  amount: number;
  /** "YYYY-MM-DD". */
  date: string;
  merchant: string | null;
  note: string | null;
  /** Income/expense only. */
  financialAccountId?: string;
  categoryId?: string | null;
  /** Transfer only. */
  transferPairId?: string;
  fromAccountId?: string;
  toAccountId?: string;
}

/** Accounts + categories needed by the drawer's selectors. */
export interface DrawerFormData {
  accounts: AccountOption[];
  categories: CategoryOption[];
  /** Drives the Pro-only "Suggest" (AI categorization) affordance. */
  isPro: boolean;
}
