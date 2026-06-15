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

/** App-level UI data. Shared types/enums live in system-constants.ts. */

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
 * Whether the "How it works" features section exists yet. While false, the
 * hero's secondary CTA scrolls to the live dashboard preview instead of a
 * not-yet-built `#how-it-works` anchor (no visibly dead button — principle #6).
 * Flip to true when that section ships and repoint the CTA.
 */
export const HOW_IT_WORKS_SECTION_ENABLED = false;
