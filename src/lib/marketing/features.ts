import {
  Zap,
  Wallet,
  Target,
  RefreshCw,
  BarChart3,
  Download,
  type LucideIcon,
} from "lucide-react";

/**
 * Landing-page feature grid. Each entry maps to one card and corresponds to a
 * real, shipped MVP capability — no aspirational features (principle #6, "never
 * UI without backing function"). Accent colors come from the semantic / category
 * palette so the icon squares match the dashboard.
 */
export interface MarketingFeature {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Hex accent for the icon square (tinted bg + colored glyph). */
  color: string;
}

export const FEATURES_SECTION = {
  eyebrow: "Features",
  title: "Everything you need to track with intention",
  subtitle:
    "Spendly keeps the conscious moment of every transaction — fast to capture, clear to review, honest about where you stand.",
} as const;

export const FEATURES: MarketingFeature[] = [
  {
    icon: Zap,
    title: "Fast manual entry",
    description:
      "Log a transaction in under five seconds — type, amount, category, done. Awareness without the busywork.",
    color: "#1D9E75",
  },
  {
    icon: Wallet,
    title: "Monthly budgets",
    description:
      "Set a spending ceiling per category and watch a clear progress bar keep you honest as the month unfolds.",
    color: "#EF9F27",
  },
  {
    icon: Target,
    title: "Honest goals",
    description:
      "Track savings goals with manual contributions and steady, visible progress toward what matters.",
    color: "#378ADD",
  },
  {
    icon: RefreshCw,
    title: "Recurring drafts",
    description:
      "Recurring expenses become drafts you confirm — never silent autopilot entries you stop noticing.",
    color: "#7F77DD",
  },
  {
    icon: BarChart3,
    title: "Clear reports",
    description:
      "See where your money goes with spending, cashflow, and income-vs-expense charts over time.",
    color: "#F97316",
  },
  {
    icon: Download,
    title: "Your data, exportable",
    description:
      "Export everything to CSV or JSON anytime. Your financial history is yours — on every plan.",
    color: "#888780",
  },
];
