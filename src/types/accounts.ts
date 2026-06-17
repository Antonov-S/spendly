/** The six financial account kinds, as stored on `FinancialAccount.type`. */
export type AccountTypeValue =
  | "CHECKING"
  | "SAVINGS"
  | "CREDIT_CARD"
  | "CASH"
  | "INVESTMENT"
  | "OTHER";

/**
 * Serializable account row for the `/accounts` management list. `balance` and
 * `startingBalance` are plain numbers (Prisma `Decimal` is converted in
 * `mapAccountRow`); `icon` stays a raw Lucide name resolved at render time.
 */
export interface AccountListRow {
  id: string;
  name: string;
  type: AccountTypeValue;
  currency: string;
  /** Derived: startingBalance + SUM(transaction amounts). */
  balance: number;
  startingBalance: number;
  color: string | null;
  /** Raw Lucide icon name (resolved at render time). */
  icon: string | null;
  isArchived: boolean;
}

/**
 * Pre-fill shape for the edit drawer. `type` and `startingBalance` are shown but
 * immutable in MVP; only name/color/icon are editable.
 */
export interface EditableAccount {
  id: string;
  name: string;
  type: AccountTypeValue;
  startingBalance: number;
  currency: string;
  color: string | null;
  icon: string | null;
}
