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

/**
 * Default account accent color and icon. Named constants so the create drawer
 * and the onboarding first-account form share one source of truth — reordering
 * the palettes above can never silently change the default.
 */
export const DEFAULT_ACCOUNT_COLOR = ACCOUNT_COLORS[0];
export const DEFAULT_ACCOUNT_ICON = ACCOUNT_ICONS[0];

/** Total steps in the first-run onboarding flow (account → budgets → done). */
export const ONBOARDING_STEP_COUNT = 3;

/**
 * Search-param key marking the onboarding flow as in-progress past Step 1.
 * Once the first account exists the page's reverse guard would bounce the user
 * to /dashboard; this marker (`?step=budgets` | `?step=done`) tells the guard
 * the user is mid-flow so the just-created account doesn't eject them before
 * the optional budgets / confirmation steps.
 */
export const ONBOARDING_STEP_PARAM = "step";
export const ONBOARDING_STEP_VALUES = {
  budgets: "budgets",
  done: "done",
} as const;

/** Copy for the first-run onboarding flow. Keeps strings out of the components. */
export const ONBOARDING_COPY = {
  account: {
    title: "Create your first account",
    subtitle:
      "Add a checking, cash, or card account to start tracking. You can add more later.",
  },
  budgets: {
    title: "Add starter budgets",
    subtitle:
      "Set spending ceilings for a few common categories this month. You can add these anytime from Budgets.",
    primary: "Add starter budgets",
    skip: "Skip for now",
  },
  done: {
    title: "You're all set",
    subtitle: "Your account is ready. Capture a transaction whenever you like.",
    cta: "Go to dashboard",
  },
} as const;

/** Max budget ceiling accepted by the form (UI guard; DB is Decimal(12,2)). */
export const BUDGET_AMOUNT_MAX = 1_000_000;

/**
 * Accent palette cycled across goal cards/rows by index (`Goal` has no color
 * column). Moved here from `db/dashboard.ts` so the page and the dashboard
 * widget share one palette.
 */
export const GOAL_COLORS = [
  "#378ADD",
  "#1D9E75",
  "#7F77DD",
  "#EF9F27",
  "#D4537E",
] as const;

/** Max recurring template amount accepted by the form (UI guard). */
export const RECURRING_AMOUNT_MAX = 1_000_000;

/**
 * Category icon whitelist for the create/edit picker. A tuple so the Zod schema
 * can `z.enum` it. EVERY name must be registered in `icon-map.ts` (a test guards
 * against drift). Superset of the seeded system-category icons so a user's
 * palette feels familiar.
 */
export const CATEGORY_ICONS = [
  "ShoppingCart",
  "UtensilsCrossed",
  "Bus",
  "Home",
  "Zap",
  "Heart",
  "Gamepad2",
  "Briefcase",
  "Laptop",
  "Tv",
  "Shirt",
  "BookOpen",
  "Shield",
  "Gift",
  "Plane",
  "Landmark",
  "PawPrint",
  "TrendingUp",
  "MoreHorizontal",
  "HelpCircle",
] as const;

/** Category accent swatches offered in the drawer (semantic-system aligned). */
export const CATEGORY_COLORS = [
  "#EF9F27",
  "#D85A30",
  "#7F77DD",
  "#1D9E75",
  "#F59E0B",
  "#D4537E",
  "#378ADD",
  "#6366F1",
  "#EC4899",
  "#0EA5E9",
  "#10B981",
  "#888780",
] as const;

/**
 * Default category accent color and icon. Named constants so the create drawer
 * has one source of truth — reordering the palettes above can never silently
 * change the default (mirrors `DEFAULT_ACCOUNT_*`).
 */
export const DEFAULT_CATEGORY_COLOR = CATEGORY_COLORS[0];
export const DEFAULT_CATEGORY_ICON = CATEGORY_ICONS[0];

/**
 * Tag accent swatches offered in the tag drawer. Any valid hex is still accepted
 * by the validator — this palette is just the curated set the UI presents (same
 * relationship as `CATEGORY_COLORS`). Tags have no icon, only an optional color.
 */
export const TAG_COLORS = [
  "#7F77DD",
  "#378ADD",
  "#0EA5E9",
  "#10B981",
  "#1D9E75",
  "#EF9F27",
  "#F97316",
  "#D85A30",
  "#D4537E",
  "#EC4899",
  "#6366F1",
  "#888780",
] as const;

/**
 * A tag defaults to name-only (no color) — the user opts into a color. Null is
 * rendered as a neutral chip. Named so the "no color" default has one source of
 * truth (mirrors `DEFAULT_CATEGORY_COLOR`).
 */
export const DEFAULT_TAG_COLOR: string | null = null;

/**
 * Reports period selector options (UI data). `param` is the `?period=` value;
 * `months` is the count of calendar months (including the current one) the
 * window spans and drives the query bounds.
 */
export const REPORT_PERIOD_OPTIONS = [
  { param: "1m", label: "This month", months: 1 },
  { param: "3m", label: "Last 3 months", months: 3 },
  { param: "12m", label: "Last 12 months", months: 12 },
] as const;

/**
 * Single source of truth for the null-category fallback (raw icon name, resolved
 * to a component client-side via `resolveIcon`). Shared by the Reports category
 * breakdown, the dashboard recent-transactions feed (`getRecentTransactions`),
 * and the transactions feed row — so the fallback can never drift between
 * surfaces. Categories deleted via `onDelete: SetNull` leave `categoryId = null`
 * and fall here.
 */
export const UNCATEGORIZED = {
  name: "Uncategorized",
  color: "#D1D5DB",
  icon: "HelpCircle",
} as const;

/**
 * Pseudo-category label shown in place of a single category for a split
 * transaction — the feed row's Category cell and the CSV export's Category
 * column (which keeps a split as one reconciling row, see data-export-spec).
 */
export const SPLIT_LABEL = "Split";

/** Lucide icon name for the split chip (resolved client-side via `resolveIcon`). */
export const SPLIT_ICON = "SplitSquareHorizontal";

/**
 * Max items rendered per notification kind in the topbar panel before
 * collapsing the remainder into a single "+N more →" link-row (§3/§7).
 */
export const NOTIFICATION_GROUP_MAX = 5;

/** Notification badge display cap — a total above this renders as "9+". */
export const NOTIFICATION_BADGE_MAX = 9;

/**
 * CSV export column headers, in output order (data-export-spec §5). Drives both
 * `EXPORT_CSV_HEADER` and the per-row builder, so the header line and the cell
 * order can never drift. Date/Amount/Type are controlled columns; the remaining
 * four are free-text and get formula-injection neutralization.
 */
export const EXPORT_CSV_COLUMNS = [
  "Date",
  "Amount",
  "Type",
  "Category",
  "Account",
  "Merchant",
  "Note",
] as const;

/**
 * Excel delimiter hint emitted as the CSV's first line (before the header) so
 * Excel splits our comma-delimited file into columns on double-click — without
 * it, European-locale Excel (where `,` is the decimal separator) defaults to
 * `;` and dumps each row into one cell. Google Sheets / LibreOffice honor it too.
 * A transport concern: the route stream prepends it after the BOM, so the pure
 * `transactionsToCsv` stays a clean header+rows transform. Strict RFC-4180
 * consumers (a future importer) must skip this non-data line.
 */
export const EXPORT_CSV_EXCEL_HINT = "sep=,";

/**
 * The mappable Spendly fields, in display order (data-import-spec §5.2). Drives
 * the CSV column mapper + `suggestMapping`. `date` and `amount` are required; the
 * rest are optional (an unmapped `type` is derived from the amount sign).
 */
export const IMPORT_FIELDS = [
  "date",
  "amount",
  "type",
  "category",
  "merchant",
  "note",
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number];

/**
 * Whitelisted CSV date input formats (data-import-spec §5.3), auto-detected from
 * the date column and user-overridable in the mapper. Anything outside this set
 * → null → invalid row. `YYYY-MM-DD` is the export's own (zero-config round-trip).
 */
export const IMPORT_DATE_FORMATS = [
  "YYYY-MM-DD",
  "MM/DD/YYYY",
  "DD/MM/YYYY",
  "DD.MM.YYYY",
] as const;

export type ImportDateFormat = (typeof IMPORT_DATE_FORMATS)[number];

/**
 * Category-resolution policy options for the radio control (data-import-spec C2).
 * `CREATE` mints a new user-owned category for an unmatched name; `UNCATEGORIZED`
 * leaves it null.
 */
export const CATEGORY_RESOLUTION_OPTIONS = [
  { value: "CREATE", label: "Create missing categories" },
  { value: "UNCATEGORIZED", label: "Leave unmatched as Uncategorized" },
] as const;

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
