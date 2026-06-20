import type { ReportPeriod } from "@/lib/report-period";

/** One category's expense total for the spending-by-category donut. */
export interface CategorySlice {
  categoryId: string | null; // null = Uncategorized
  name: string;
  icon: string; // raw Lucide name, resolved client-side
  color: string;
  total: number; // abs(sum of EXPENSE amounts)
}

/** One month's income/expense totals (also the cashflow source: net = income − expenses). */
export interface MonthBucket {
  month: number; // 1–12
  year: number;
  income: number; // sum of positive amounts
  expenses: number; // abs(sum of negative amounts)
}

/** End-of-month balances across all in-scope accounts for one month. */
export interface BalancePoint {
  month: number;
  year: number;
  balances: {
    accountId: string;
    name: string;
    color: string;
    balance: number;
  }[];
}

/** Everything the page hands the view (after the Pro clamp). */
export interface ReportData {
  categories: CategorySlice[];
  monthly: MonthBucket[];
  balanceHistory: BalancePoint[];
  txCount: number;
  /** The window actually queried (already clamped for Free). */
  effective: ReportPeriod;
  /** True when a Free user's 12m request was clamped to 3m — drives the banner + pill highlight. */
  clamped: boolean;
  isPro: boolean;
}
