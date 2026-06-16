import type { LucideIcon } from "lucide-react";

/** Visual category reference used across transaction and budget rows. */
export interface CategoryRef {
  name: string;
  /** Hex accent color (semantic per category). */
  color: string;
  icon: LucideIcon;
}

/** A single row in the recent-transactions table. */
export interface TransactionRow {
  id: string;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  description: string;
  category: CategoryRef;
  /** Pre-formatted, display-ready date label (e.g. "Today", "Jun 1"). */
  dateLabel: string;
  account: string;
  /** Signed amount in the display currency. Negative = expense. */
  amount: number;
  /** True for income, drives the green accent. */
  isIncome: boolean;
}

/** A single budget progress row in the budgets panel. */
export interface BudgetRow {
  id: string;
  category: CategoryRef;
  spent: number;
  limit: number;
}

/**
 * Serializable budget row for the client `/budgets` view. Unlike `BudgetRow`
 * (server-only, carries a resolved Lucide component), `icon` is the raw name
 * string so the row can cross the server→client boundary; the client resolves
 * it at render time (same approach as `FeedTransaction`).
 */
export interface BudgetListRow {
  id: string;
  category: { name: string; color: string; icon: string };
  spent: number;
  limit: number;
}

/** Editable shape for pre-filling the budget drawer on a row click. */
export interface BudgetEditable {
  id: string;
  categoryId: string;
  amount: number;
  month: number;
  year: number;
}

/** Hero balance + monthly metric strip values for the dashboard header. */
export interface DashboardSummary {
  periodLabel: string;
  totalBalance: number;
  balanceDelta: number;
  income: number;
  expenses: number;
  cashflow: number;
}

/** Budget panel summary block (remaining / total / days left). */
export interface BudgetSummary {
  remaining: number;
  total: number;
  daysLeft: number;
  categoryCount: number;
  /** True when the period's budgets span >1 currency — total is approximate. */
  hasMixedCurrencies: boolean;
}

/** A savings goal row in the goals widget. */
export interface GoalRow {
  id: string;
  name: string;
  /** Hex accent color for the progress bar. */
  color: string;
  saved: number;
  target: number;
  /** Past target date with progress < 100% — surfaces as overdue. */
  overdue?: boolean;
}

