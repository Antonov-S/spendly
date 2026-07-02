import type { AccountTypeValue } from "@/types/accounts";
import type { TransactionTypeValue } from "@/types/transactions";

/**
 * Serializable shapes for the data-export slice (data-export-spec §6.1). Every
 * Prisma `Decimal` is already a `number` and every `@db.Date`/timestamp a string
 * here — the `src/lib/db/export.ts` fetchers normalize at their boundary so the
 * pure helpers and the HTTP response never see a `Decimal` or `Date` (D2/D3).
 */

/** The four recurring cadences, as stored on `RecurringTemplate.cadence`. */
export type RecurringCadenceValue = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

/**
 * One exported transaction. Carries the §5 CSV columns (`date`, `amount`,
 * `type`, `category`, `account`, `merchant`, `note`) plus the linkage fields the
 * JSON dump adds. Transfers appear as two rows sharing `transferPairId` (D4);
 * `category` is null for an uncategorized row (D5, no "Uncategorized" synthesis).
 */
export interface ExportTransactionRow {
  id: string;
  /** "YYYY-MM-DD" from UTC components (D3). */
  date: string;
  /** Signed: INCOME +, EXPENSE − (D2). */
  amount: number;
  type: TransactionTypeValue;
  /** `category.name`, or null when uncategorized (D5). */
  category: string | null;
  /** `financialAccount.name`. */
  account: string;
  merchant: string | null;
  note: string | null;
  isTransferLeg: boolean;
  transferPairId: string | null;
  financialAccountId: string;
  categoryId: string | null;
  recurringTemplateId: string | null;
  /**
   * Derived convenience field (`splits.length > 0`) — NOT a data-model column;
   * there is no `Transaction.isSplit`. `splits` is the sole source of truth.
   */
  isSplit: boolean;
  /**
   * Split lines (schemaVersion 2). Empty unless the transaction is split;
   * `categoryId` is null when the split's category was deleted (SetNull). CSV
   * ignores this (a split stays one `Split`-labelled row); JSON is lossless.
   */
  splits: ExportSplit[];
  /** ISO 8601 (D3). */
  createdAt: string;
}

/** One split line inside an exported transaction (JSON only). */
export interface ExportSplit {
  categoryId: string | null;
  amount: number;
  note: string | null;
}

export interface ExportAccount {
  id: string;
  name: string;
  type: AccountTypeValue;
  currency: string;
  startingBalance: number;
  /** Derived: startingBalance + SUM(transaction amounts). */
  balance: number;
  color: string | null;
  icon: string | null;
  isArchived: boolean;
  /** ISO 8601. */
  createdAt: string;
}

/** User-owned categories only — system categories are excluded (D6). */
export interface ExportCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  /** ISO 8601. */
  createdAt: string;
}

export interface ExportBudget {
  id: string;
  amount: number;
  currency: string;
  month: number;
  year: number;
  isArchived: boolean;
  categoryId: string;
  /** ISO 8601. */
  createdAt: string;
}

export interface ExportGoalContribution {
  id: string;
  amount: number;
  /** "YYYY-MM-DD" (D3). */
  date: string;
  note: string | null;
  /** ISO 8601. */
  createdAt: string;
}

export interface ExportGoal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  currency: string;
  /** "YYYY-MM-DD" or null (D3). */
  targetDate: string | null;
  isCompleted: boolean;
  /** ISO 8601. */
  createdAt: string;
  contributions: ExportGoalContribution[];
}

export interface ExportRecurringTemplate {
  id: string;
  name: string;
  type: TransactionTypeValue;
  amount: number;
  currency: string;
  cadence: RecurringCadenceValue;
  /** "YYYY-MM-DD" (D3). */
  nextOccurrence: string;
  isActive: boolean;
  financialAccountId: string;
  categoryId: string | null;
  /** ISO 8601. */
  createdAt: string;
}

/**
 * The complete structured dump (the JSON `data` payload). Account-bound entities
 * are scoped to `?account=`; global entities (categories, budgets, goals) are
 * always included in full — the intentional asymmetry of C2/§3.2.
 */
export interface FullExport {
  accounts: ExportAccount[];
  categories: ExportCategory[];
  budgets: ExportBudget[];
  goals: ExportGoal[];
  recurringTemplates: ExportRecurringTemplate[];
  transactions: ExportTransactionRow[];
}

/**
 * Versioned envelope wrapping every JSON export (§6.1). The bare payload is
 * never emitted — `schemaVersion` lets a future importer detect the format
 * generation before parsing (§6.2).
 */
export interface ExportEnvelope<T> {
  schemaVersion: number;
  /** ISO 8601 (D3). */
  exportedAt: string;
  data: T;
}
