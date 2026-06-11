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
  info: "#378ADD", // links / informational accents
} as const;

/** Budget progress bar state thresholds (fraction of limit spent). */
export const BUDGET_THRESHOLDS = {
  warning: 0.6, // >= 60% -> amber
  danger: 1.0, // >= 100% -> red
} as const;

/** Credentials auth security policy. */
export const BCRYPT_SALT_ROUNDS = 12;
export const PASSWORD_MIN_LENGTH = 8;

/** Responsive breakpoints (px) mirroring the sidebar behavior in the spec. */
export const BREAKPOINTS = {
  mobile: 768, // < 768: hamburger overlay + bottom nav
  tablet: 1024, // 768–1024: icon-only sidebar
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
