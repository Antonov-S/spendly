import {
  ShoppingCart,
  Briefcase,
  Bus,
  UtensilsCrossed,
  Tv,
  Home,
  Heart,
  Shirt,
} from "lucide-react";
import type {
  TransactionRow,
  BudgetRow,
  DashboardSummary,
  BudgetSummary,
  GoalRow,
} from "@/types/dashboard";

/**
 * ⚠️ PLACEHOLDER DATA — visual mockup only.
 * Hardcoded fixtures for the dashboard UI prototype. No DB, no fetching.
 * Replace with real queries when wiring the dashboard to Prisma.
 */

export const MOCK_SUMMARY: DashboardSummary = {
  periodLabel: "June 2026",
  totalBalance: 8560,
  balanceDelta: 1360,
  income: 3200,
  expenses: 1840,
  cashflow: 1360,
};

/** Balance trend over the period — drives the hero sparkline. */
export const MOCK_BALANCE_TREND = [
  7200, 7100, 7350, 7300, 7600, 7500, 7800, 8050, 7950, 8250, 8400, 8560,
];

export const MOCK_GOALS: GoalRow[] = [
  {
    id: "g1",
    name: "Japan trip",
    color: "#378ADD",
    saved: 3400,
    target: 5000,
    overdue: true,
  },
  {
    id: "g2",
    name: "Emergency fund",
    color: "#1D9E75",
    saved: 4200,
    target: 10000,
  },
  {
    id: "g3",
    name: "New laptop",
    color: "#7F77DD",
    saved: 900,
    target: 1500,
  },
];

export const MOCK_TRANSACTIONS: TransactionRow[] = [
  {
    id: "t1",
    type: "EXPENSE",
    description: "Whole Foods",
    category: { name: "Groceries", color: "#EF9F27", icon: ShoppingCart },
    dateLabel: "Today",
    account: "Checking",
    amount: -47,
    isIncome: false,
  },
  {
    id: "t2",
    type: "INCOME",
    description: "Salary",
    category: { name: "Income", color: "#1D9E75", icon: Briefcase },
    dateLabel: "Today",
    account: "Checking",
    amount: 3200,
    isIncome: true,
  },
  {
    id: "t3",
    type: "EXPENSE",
    description: "Metro card",
    category: { name: "Transport", color: "#7F77DD", icon: Bus },
    dateLabel: "Yesterday",
    account: "Cash",
    amount: -60,
    isIncome: false,
  },
  {
    id: "t4",
    type: "EXPENSE",
    description: "Starbucks",
    category: { name: "Dining", color: "#D85A30", icon: UtensilsCrossed },
    dateLabel: "Yesterday",
    account: "Card",
    amount: -8,
    isIncome: false,
  },
  {
    id: "t5",
    type: "EXPENSE",
    description: "Netflix",
    category: { name: "Subscriptions", color: "#378ADD", icon: Tv },
    dateLabel: "Jun 15",
    account: "Card",
    amount: -19,
    isIncome: false,
  },
  {
    id: "t6",
    type: "EXPENSE",
    description: "Rent",
    category: { name: "Housing", color: "#1D9E75", icon: Home },
    dateLabel: "Jun 1",
    account: "Checking",
    amount: -650,
    isIncome: false,
  },
  {
    id: "t7",
    type: "EXPENSE",
    description: "Pharmacy",
    category: { name: "Health", color: "#D4537E", icon: Heart },
    dateLabel: "Jun 12",
    account: "Card",
    amount: -34,
    isIncome: false,
  },
];

export const MOCK_TRANSACTION_COUNT = 62;

export const MOCK_BUDGET_SUMMARY: BudgetSummary = {
  remaining: 820,
  total: 2660,
  daysLeft: 12,
  categoryCount: 7,
};

export const MOCK_BUDGETS: BudgetRow[] = [
  {
    id: "b1",
    category: { name: "Groceries", color: "#EF9F27", icon: ShoppingCart },
    spent: 580,
    limit: 700,
  },
  {
    id: "b2",
    category: { name: "Dining", color: "#D85A30", icon: UtensilsCrossed },
    spent: 220,
    limit: 200,
  },
  {
    id: "b3",
    category: { name: "Transport", color: "#7F77DD", icon: Bus },
    spent: 360,
    limit: 500,
  },
  {
    id: "b4",
    category: { name: "Health", color: "#D4537E", icon: Heart },
    spent: 80,
    limit: 300,
  },
  {
    id: "b5",
    category: { name: "Housing", color: "#1D9E75", icon: Home },
    spent: 650,
    limit: 700,
  },
  {
    id: "b6",
    category: { name: "Subscriptions", color: "#378ADD", icon: Tv },
    spent: 79,
    limit: 100,
  },
  {
    id: "b7",
    category: { name: "Clothing", color: "#888780", icon: Shirt },
    spent: 0,
    limit: 150,
  },
];

/** Accounts for the topbar selector. First entry is the default ("All accounts"). */
export const MOCK_ACCOUNTS = [
  "All accounts",
  "Checking",
  "Savings",
  "Cash",
  "Credit card",
] as const;

/** Category options for the transaction drawer's category selector. */
export const MOCK_CATEGORIES = [
  "Groceries",
  "Dining",
  "Transport",
  "Housing",
  "Utilities",
  "Health",
  "Entertainment",
  "Subscriptions",
  "Salary",
  "Freelance",
] as const;
