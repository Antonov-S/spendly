import {
  ShoppingCart,
  UtensilsCrossed,
  Bus,
  Home,
  Gamepad2,
  Tv,
} from "lucide-react";
import type {
  DashboardSummary,
  BudgetRow,
  BudgetSummary,
  GoalRow,
} from "@/types/dashboard";

/**
 * Static marketing snapshot for the public homepage hero (phase-4 dashboard
 * reveal). The landing page is unauthenticated and cannot query a user's live
 * Prisma data the way `/dashboard` does, so this single typed object stands in
 * — typed against the real `@/types/dashboard` shapes and rendered through the
 * real dashboard components, never an invented one-off mock.
 *
 * The numbers are deliberately healthy and budgeting-focused (most budgets in
 * the green, one nearing its limit; goals making steady progress) — they
 * represent what a user gets after registering, not a worst case.
 */

export const MARKETING_SUMMARY: DashboardSummary = {
  periodLabel: "June 2026",
  totalBalance: 12480,
  balanceDelta: 1520,
  income: 4200,
  expenses: 2680,
  cashflow: 1520,
};

/** Balance trend over the period — drives the hero preview sparkline. */
export const MARKETING_BALANCE_TREND = [
  10720, 10850, 10780, 11040, 11260, 11180, 11520, 11740, 11900, 12130, 12360,
  12480,
];

/**
 * Budget usage / top spending categories. Most categories sit in the green
 * (< 60% spent); Housing is the single amber row nearing its limit.
 */
export const MARKETING_BUDGETS: BudgetRow[] = [
  {
    id: "mkt-b1",
    category: { name: "Housing", color: "#1D9E75", icon: Home },
    spent: 1180,
    limit: 1400,
  },
  {
    id: "mkt-b2",
    category: { name: "Groceries", color: "#EF9F27", icon: ShoppingCart },
    spent: 320,
    limit: 600,
  },
  {
    id: "mkt-b3",
    category: { name: "Dining", color: "#D85A30", icon: UtensilsCrossed },
    spent: 180,
    limit: 400,
  },
  {
    id: "mkt-b4",
    category: { name: "Transport", color: "#7F77DD", icon: Bus },
    spent: 140,
    limit: 350,
  },
  {
    id: "mkt-b5",
    category: { name: "Entertainment", color: "#F97316", icon: Gamepad2 },
    spent: 90,
    limit: 250,
  },
  {
    id: "mkt-b6",
    category: { name: "Subscriptions", color: "#378ADD", icon: Tv },
    spent: 48,
    limit: 120,
  },
];

export const MARKETING_BUDGET_SUMMARY: BudgetSummary = {
  // remaining = sum(limit) - sum(spent) = 3120 - 1958
  remaining: 1162,
  total: 3120,
  daysLeft: 15,
  categoryCount: MARKETING_BUDGETS.length,
  hasMixedCurrencies: false,
};

/** Savings goal progress. Steady, healthy progress — no overdue goals. */
export const MARKETING_GOALS: GoalRow[] = [
  {
    id: "mkt-g1",
    name: "Emergency fund",
    color: "#1D9E75",
    saved: 6200,
    target: 10000,
  },
  {
    id: "mkt-g2",
    name: "Japan trip",
    color: "#378ADD",
    saved: 3400,
    target: 5000,
  },
  {
    id: "mkt-g3",
    name: "New laptop",
    color: "#7F77DD",
    saved: 1100,
    target: 1500,
  },
];
