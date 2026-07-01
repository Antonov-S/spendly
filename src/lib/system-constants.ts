import type { LucideIcon } from "lucide-react";

/**
 * System-level constants: semantic colors, thresholds, breakpoints, and the
 * shared type/enum definitions they describe. App-level UI data (nav arrays,
 * etc.) lives in constants.ts.
 */

/** Strictly semantic color encoding (see Design System in project-overview.md). */
export const SEMANTIC_COLORS = {
  success: "#1D9E75", // positive / in budget
  warning: "#EF9F27", // warning threshold
  danger: "#E24B4A", // over budget / loss
  neutral: "#888780", // neutral information
  info: "#378ADD" // links / informational accents
} as const;

/** Budget progress bar state thresholds (fraction of limit spent). */
export const BUDGET_THRESHOLDS = {
  warning: 0.6, // >= 60% -> amber
  danger: 1.0 // >= 100% -> red
} as const;

/**
 * Fraction of a budget's limit spent at or above which it is flagged "at risk"
 * on the Dashboard insights strip. Distinct from BUDGET_THRESHOLDS (the
 * green/amber/red progress-bar states): a budget can be "at risk" (>= 80%)
 * while still in the amber band (60–<100%). Includes over-budget rows.
 */
export const BUDGET_AT_RISK_THRESHOLD = 0.8;

/**
 * Max months `resolveRolloverCarry` walks back when deriving a budget's carried
 * remainder. Carry only flows through a consecutive run of rollover-enabled
 * budgets, so this is a defensive ceiling on a pathological chain, not the
 * expected depth (typical runs are 1–3 months). Derive-on-read bound — keep
 * small; raising it only adds queries for users with very long chains.
 */
export const ROLLOVER_MAX_LOOKBACK_MONTHS = 24;

/** Credentials auth security policy. */
export const BCRYPT_SALT_ROUNDS = 12;
export const PASSWORD_MIN_LENGTH = 8;

/** Email verification: token lifetime and sender identity. */
export const VERIFICATION_TOKEN_TTL_HOURS = 24;
export const EMAIL_FROM = "onboarding@resend.dev";

/**
 * Password-reset token lifetime. Shorter than verification (24h) because the
 * link grants the ability to take over the account.
 */
export const PASSWORD_RESET_TOKEN_TTL_HOURS = 1;

/**
 * Days a soft-deleted account is retained before permanent purge. The account
 * is deactivated immediately (sign-in blocked) but data is preserved during
 * this grace period so deletion can be reversed.
 */
export const ACCOUNT_DELETION_GRACE_PERIOD_DAYS = 30;

/**
 * Whether email-verification enforcement is active. Defaults to on: only the
 * literal string "false" disables it, so an unset or empty value keeps
 * verification enabled and production stays safe without extra config.
 */
export const EMAIL_VERIFICATION_ENABLED =
  process.env.EMAIL_VERIFICATION_ENABLED !== "false";

/**
 * Auth rate-limit policy. Each entry is a sliding-window budget: at most
 * `limit` requests per `window` (Upstash Duration string). Keyed per-endpoint
 * so a burst of logins can't exhaust the register budget and vice versa.
 */
export const RATE_LIMITS = {
  login: { limit: 5, window: "15 m" },
  register: { limit: 3, window: "1 h" },
  forgotPassword: { limit: 3, window: "1 h" },
  resetPassword: { limit: 5, window: "15 m" },
  resendVerification: { limit: 3, window: "15 m" },
  // The export pair is the heaviest authenticated read and a download link is
  // trivially re-triggerable. Keyed per-userId (not IP); both /api/export/csv
  // and /api/export/json share this one budget.
  export: { limit: 10, window: "1 m" },
  // AI feature budgets. Both fail open (no Redis -> allowed).
  //  - aiSuggest: per-FEATURE burst cap, keyed `${feature}:${userId}` — each AI
  //    feature gets its own hourly burst budget (auto-categorize, NL capture, …).
  //  - aiMonthly: ONE GLOBAL per-user monthly cost ceiling, keyed by userId only,
  //    SHARED across every AI feature. The COGS rail; runAiFeature always checks
  //    it regardless of which feature is calling.
  aiSuggest: { limit: 20, window: "1 h" },
  aiMonthly: { limit: 500, window: "30 d" },
  // Data import: per-userId budget shared by inspectCsv / previewImport /
  // commitImport. A few inspect/preview cycles plus the commit fit comfortably;
  // a script hammering import does not. Fail-open when Upstash is unconfigured.
  import: { limit: 5, window: "1 m" }
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

/**
 * OpenAI model for all AI features. Cheap + reliable; a config knob so the
 * model is swappable without touching call sites (provider-behind-interface).
 */
export const AI_MODEL = process.env.AI_MODEL || "gpt-5-nano";

/**
 * Reasoning effort for the gpt-5 family (Responses API). Tuned against measured
 * latency + category-inference quality on `gpt-5-nano`:
 *  - `medium` (the default) infers categories well but takes 5–11s → breaches
 *    AI_TIMEOUT_MS and fails calls open intermittently.
 *  - `minimal` is fast (~1s) but inference collapses: it invents off-list names
 *    ("Vets"/"Healthcare") and mis-maps (gym/pharmacy → Groceries).
 *  - `low` is the sweet spot: category quality matches `medium` (vet → Pets,
 *    pharmacy → Health) at ~2–3s, comfortably under the timeout.
 * A knob so it can be raised if a future feature genuinely needs reasoning.
 */
export const AI_REASONING_EFFORT = "low";

/** Max free-text chars sent to the model per AI call (truncate before sending). */
export const AI_INPUT_MAX_CHARS = 2000;

/**
 * Per-call AI timeout. On timeout the action fails open to the manual picker.
 * `low`-effort gpt-5-nano calls land ~2–3s but occasionally spike toward ~7s, so
 * 12s gives headroom for outliers; the ceiling only bites on a genuinely stuck
 * call (rare), where waiting a few extra seconds beats a false fail-open.
 */
export const AI_TIMEOUT_MS = 12000;

/**
 * Max absolute starting balance accepted by the account form (UI + Zod guard).
 * Signed: liability accounts may open negative, so the bound is `±` this value.
 * DB column is `Decimal(12,2)` (max ±9,999,999,999.99) — this sits well inside it.
 */
export const STARTING_BALANCE_MAX = 100_000_000;

/**
 * Max goal target / contribution magnitude (UI + Zod guard). Mirrors
 * `BUDGET_AMOUNT_MAX`; DB column is `Decimal(12,2)` so this sits well inside it.
 */
export const GOAL_AMOUNT_MAX = 1_000_000;

/**
 * Max length of a user's display name (UI + Zod guard on `updateProfile`).
 * Matches the goal-name ceiling used elsewhere; `name` is a presentation label,
 * not an identifier (no uniqueness constraint).
 */
export const PROFILE_NAME_MAX = 80;

/**
 * Transaction free-text field caps (Zod guards + the import normalizer's D9
 * truncation). Single-sourced here so the drawer validation and the importer
 * agree on the same ceilings.
 */
export const MERCHANT_MAX = 120;
export const NOTE_MAX = 500;

/**
 * Max length of a category name (Zod guard + the import resolver's D9 bound:
 * category text longer than this is invalid for creation and falls back to null
 * rather than minting a truncated category).
 */
export const CATEGORY_NAME_MAX = 50;

/**
 * Max length of a tag name (Zod guard). Shorter than a category name — tags are
 * terse labels (`reimbursable`, `vacation-2026`), not descriptive buckets.
 */
export const TAG_NAME_MAX = 32;

/**
 * Max tags assignable to a single transaction. A write guardrail against
 * unbounded join rows — enforced both client-side (the picker disables "Add" at
 * the cap) and server-side (the Zod `tagIds` array bound). Tag *count* itself is
 * unlimited; only per-transaction assignments are capped.
 */
export const TAG_MAX_PER_TRANSACTION = 12;

/**
 * How many tag chips a feed row renders before collapsing the remainder into a
 * non-interactive `+N` pill. Keeps row height bounded no matter how many tags a
 * transaction carries; the full feed and the dashboard rows share this constant.
 */
export const TAG_CHIPS_VISIBLE_MAX = 3;

/**
 * Min in-scope transactions before the Reports *trend* charts (income vs
 * expenses, cashflow) render instead of the "Add N more transactions to see
 * spending trends" nudge. Drives the canonical nudge copy (`Add ${N - count}…`).
 * The category + balance charts gate on data *presence*, not this count.
 */
export const REPORTS_MIN_TRANSACTIONS = 15;

/**
 * Free-tier reporting ceiling (months). Free is allowed the 1- and 3-month
 * windows; Pro unlocks the full 12-month window.
 */
export const REPORTS_FREE_MAX_MONTHS = 3;

/**
 * Max entries listed in a chart's accessibility summary (`aria-label`) before
 * it appends "and N more". Keeps the screen-reader summary readable rather than
 * enumerating every month/account.
 */
export const ARIA_SUMMARY_MAX = 3;

/**
 * Minimum number of Help sections before the `/help` page renders an in-page
 * table of contents. Below this a TOC is just noise above a short, already-
 * scannable page; at or above it, the extra navigation earns its place. The
 * section anchor ids exist regardless of whether the TOC renders.
 */
export const HELP_TOC_MIN_SECTIONS = 5;

/**
 * Bump on ANY structural change to the JSON export envelope (data-export-spec
 * §6.2): renaming/removing a key, changing a field's type/units, or changing
 * the date/number encoding. Lets a future importer detect format generations.
 */
export const EXPORT_JSON_SCHEMA_VERSION = 1;

/** Download filename stem: `spendly-export-YYYY-MM-DD.<ext>`. */
export const EXPORT_FILENAME_PREFIX = "spendly-export";

/**
 * Hard cap on transactions per export (data-export-spec D8 / §7.2). The fetcher
 * takes `cap + 1` so overflow is detectable: CSV truncates with a marker row,
 * JSON returns 413. A safety rail (MVP ceiling is ≤10K tx/user), not the
 * expected path.
 */
export const EXPORT_MAX_TRANSACTIONS = 10_000;

/* ── Data import (data-import-spec §9) ────────────────────────────────────── */

/**
 * Hard cap on data rows accepted per import (mirrors EXPORT_MAX_TRANSACTIONS;
 * can diverge later). Over this → whole-import structural error, no writes (S4).
 */
export const IMPORT_MAX_ROWS = 10_000;

/** Reject an upload larger than this before any parsing (cheap first guard, S4). */
export const IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Rows shown in the preview sample table. */
export const IMPORT_PREVIEW_SAMPLE_SIZE = 20;

/** Max per-row issues listed in the preview before "and N more". */
export const IMPORT_MAX_ISSUES = 50;

/**
 * Per-cell hard truncation during the CSV scan — an abuse bound (S7), distinct
 * from the per-field product caps (merchant/note in D9). Counts total accumulated
 * characters of one field, so a never-closed quote can't grow an unbounded cell.
 */
export const IMPORT_MAX_CELL_CHARS = 10_000;

/**
 * Skipped-row share at/above which the preview shows the loud "most rows won't
 * import — check your mapping / date format" warning (T5). Non-blocking.
 */
export const IMPORT_HIGH_SKIP_RATIO = 0.8;

/** Responsive breakpoints (px) mirroring the sidebar behavior in the spec. */
export const BREAKPOINTS = {
  mobile: 768, // < 768: hamburger overlay + bottom nav
  tablet: 1024 // 768–1024: icon-only sidebar
} as const;

/** A single navigation entry (sidebar or mobile bottom nav). */
export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Optional alert dot (e.g. budget at risk). */
  alert?: boolean;
}

/** Transaction type toggle in the create/edit drawer. */
export const TRANSACTION_TYPES = ["Income", "Expense", "Transfer"] as const;
export type TransactionTypeLabel = (typeof TRANSACTION_TYPES)[number];
