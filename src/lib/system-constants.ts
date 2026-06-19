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
  resendVerification: { limit: 3, window: "15 m" }
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

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

/** Period selector options on the dashboard header. */
export const PERIOD_OPTIONS = ["Week", "Month", "Year"] as const;
export type Period = (typeof PERIOD_OPTIONS)[number];
export const DEFAULT_PERIOD: Period = "Month";

/** Transaction type toggle in the create/edit drawer. */
export const TRANSACTION_TYPES = ["Income", "Expense", "Transfer"] as const;
export type TransactionTypeLabel = (typeof TRANSACTION_TYPES)[number];
