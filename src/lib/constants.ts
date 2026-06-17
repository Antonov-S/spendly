import {
  LayoutDashboard,
  ArrowLeftRight,
  Wallet,
  RefreshCw,
  Target,
  BarChart3,
  Home,
  List,
  MoreHorizontal,
} from "lucide-react";
import type { NavItem } from "@/lib/system-constants";
import type { TransactionTypeValue } from "@/types/transactions";
import type { AccountTypeValue } from "@/types/accounts";

/** App-level UI data. Shared types/enums live in system-constants.ts. */

/** Default page size for the transactions feed ("load more" increment). */
export const TRANSACTIONS_PAGE_SIZE = 50;

/** Debounce before a search keystroke updates the URL (ms). */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Mutually-exclusive type filter pills on the transactions feed.
 * `value: null` is the default "All" (no `type` filter applied).
 */
export const TRANSACTION_TYPE_FILTERS: ReadonlyArray<{
  label: string;
  value: TransactionTypeValue | null;
}> = [
  { label: "All", value: null },
  { label: "Income", value: "INCOME" },
  { label: "Expense", value: "EXPENSE" },
  { label: "Transfer", value: "TRANSFER" },
];

/**
 * Type toggle in the create/edit drawer. Unlike the feed filters there is no
 * "All" option — every transaction has exactly one type.
 */
export const TRANSACTION_TYPE_OPTIONS: ReadonlyArray<{
  label: string;
  value: TransactionTypeValue;
}> = [
  { label: "Income", value: "INCOME" },
  { label: "Expense", value: "EXPENSE" },
  { label: "Transfer", value: "TRANSFER" },
];

/** Account type options for the create drawer select. Type is immutable after create. */
export const ACCOUNT_TYPE_OPTIONS: ReadonlyArray<{
  label: string;
  value: AccountTypeValue;
}> = [
  { label: "Checking", value: "CHECKING" },
  { label: "Savings", value: "SAVINGS" },
  { label: "Credit card", value: "CREDIT_CARD" },
  { label: "Cash", value: "CASH" },
  { label: "Investment", value: "INVESTMENT" },
  { label: "Other", value: "OTHER" },
];

/** Account accent color swatches offered in the create/edit drawer. */
export const ACCOUNT_COLORS = [
  "#1D9E75",
  "#EF9F27",
  "#378ADD",
  "#D4537E",
  "#7F77DD",
  "#888780",
] as const;

/**
 * Account icon whitelist. A tuple (not arbitrary string) so the Zod schema can
 * `z.enum` it and reject icons that have no mapping in `icon-map.ts`. Every name
 * here must be registered in `resolveIcon`.
 */
export const ACCOUNT_ICONS = [
  "Wallet",
  "Landmark",
  "PiggyBank",
  "CreditCard",
  "Banknote",
  "TrendingUp",
] as const;

/** Max budget ceiling accepted by the form (UI guard; DB is Decimal(12,2)). */
export const BUDGET_AMOUNT_MAX = 1_000_000;

/** Max recurring template amount accepted by the form (UI guard). */
export const RECURRING_AMOUNT_MAX = 1_000_000;

/** Cadence options for the recurring template form select. */
export const CADENCE_OPTIONS = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "YEARLY", label: "Yearly" },
] as const;

/**
 * One-tap starter budgets for the empty state (category name → suggested amount).
 * Names must match seeded system categories exactly (a test guards against drift).
 */
export const BUDGET_PRESETS = [
  { categoryName: "Groceries", amount: 400 },
  { categoryName: "Dining", amount: 200 },
  { categoryName: "Transport", amount: 120 },
  { categoryName: "Utilities", amount: 150 },
] as const;

/** Primary sidebar navigation (Help is rendered separately, pinned to bottom). */
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Transactions", href: "/transactions", icon: ArrowLeftRight },
  { label: "Budgets", href: "/budgets", icon: Wallet, alert: true },
  { label: "Recurring", href: "/recurring", icon: RefreshCw },
  { label: "Goals", href: "/goals", icon: Target },
  { label: "Reports", href: "/reports", icon: BarChart3 },
];

/** Mobile bottom navigation: Home, Transactions, Budgets, More (+ floating add). */
export const MOBILE_NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/dashboard", icon: Home },
  { label: "Transactions", href: "/transactions", icon: List },
  { label: "Budgets", href: "/budgets", icon: Wallet },
  { label: "More", href: "/settings", icon: MoreHorizontal },
];

/**
 * Homepage hero "Financial Chaos → Clarity" cube animation. Timings are in ms.
 * Only the desktop + motion-OK render path consumes these — mobile and
 * `prefers-reduced-motion` collapse to the static phase-4 dashboard with no
 * animation, so there is no intermediate fallback to configure.
 */
export const HERO_ANIMATION = {
  /** Cube count on the animated path. 120 is the spec's upper bound. */
  cubeCount: 80,
  /** Edge length of each cube (px); also drives face geometry via CSS var. */
  cubeSizePx: 16,
  /** Phase 2 lays cubes out into this many category columns. */
  groupColumns: 5,
  /** Phase 3 collapses the columns into this many budget bars. */
  budgetRows: 4,
  /** Min viewport width for the animated path; below this -> static frame. */
  desktopMinWidth: 768,
  /** Delay after the hero is first visible before the animation auto-starts. */
  startDelayMs: 700,
  /** Soft fade-in of the cube overlay so the dashboard→chaos start isn't a hard cut. */
  introFadeMs: 280,
  /** Phase 1 — scattered cubes drift (chaos). */
  phase1DriftMs: 2000,
  /** Phase 2 — cubes ease into category columns (structure). */
  phase2GroupMs: 2500,
  /** Phase 3 — columns collapse into budget bars. */
  phase3StackMs: 1500,
  /** Cross-fade from cube bars to the real dashboard underneath. */
  revealMs: 1000,
} as const;

/**
 * Cube colors for the hero animation that aren't part of the semantic palette:
 * the grey of disorder and the muted green of the in-between organizing state.
 * The resolved bar colors reuse SEMANTIC_COLORS (green / amber).
 */
export const HERO_CUBE_COLORS = {
  chaos: "#5b5d63", // muted grey — untracked, disordered
  transition: "#3f7d68", // muted green — organizing toward clarity
} as const;

/**
 * How much of the dashboard the hero preview renders. Kept compact so the
 * preview doesn't dominate the hero. Budgets match the animation's morph-target
 * count, so every rendered bar is also a cube-morph target (perfect alignment).
 */
export const HERO_PREVIEW = {
  budgetRows: HERO_ANIMATION.budgetRows, // 4 — same bars the cubes resolve onto
  goals: 2,
} as const;
