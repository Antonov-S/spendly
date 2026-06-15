/**
 * Landing-page pricing data. Prices live here as the single source of truth;
 * the "Save X%" yearly hint is derived from them (never hardcoded). CTAs point
 * at /register — real Stripe checkout is a separate post-auth flow.
 */

export type BillingPeriod = "monthly" | "yearly";

/** Pro prices and display currency. Free is rendered from a 0 amount. */
export const PRICING = {
  currency: "$",
  monthly: 3,
  yearly: 25,
} as const;

/**
 * Yearly savings vs paying monthly for a full year, rounded to a whole percent.
 * Derived from PRICING so the "Save X%" hint can never drift from the prices.
 */
export function yearlyDiscountPercent(
  monthly: number = PRICING.monthly,
  yearly: number = PRICING.yearly
): number {
  const fullYear = monthly * 12;
  if (fullYear <= 0) return 0;
  return Math.round(((fullYear - yearly) / fullYear) * 100);
}

export const PRICING_SECTION = {
  eyebrow: "Pricing",
  title: "Simple pricing, generous free tier",
  subtitle:
    "Start free forever. Upgrade to Pro for full history and deeper analytics — cancel anytime.",
} as const;

export interface PricingPlan {
  name: string;
  tagline: string;
  /** Monthly price in whole currency units; 0 means free. */
  monthlyPrice: number;
  /** Yearly price in whole currency units; 0 means free. */
  yearlyPrice: number;
  features: string[];
  cta: { label: string; href: string };
  /** Pro card: green ring + "Most Popular" badge. */
  highlighted: boolean;
  badge?: string;
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    name: "Free",
    tagline: "Everything you need to start tracking",
    monthlyPrice: 0,
    yearlyPrice: 0,
    features: [
      "Unlimited financial accounts",
      "Unlimited transactions",
      "Unlimited budgets & goals",
      "Unlimited recurring templates",
      "Last 3 months of reports",
      "CSV & JSON export",
    ],
    cta: { label: "Get Started Free", href: "/register" },
    highlighted: false,
  },
  {
    name: "Pro",
    tagline: "Full history and deeper analytics",
    monthlyPrice: PRICING.monthly,
    yearlyPrice: PRICING.yearly,
    features: [
      "Everything in Free, plus:",
      "Unlimited reports history",
      "All-time spending analytics",
      "Account balance over time",
      "Early access to new features",
    ],
    cta: { label: "Get Pro", href: "/register" },
    highlighted: true,
    badge: "Most Popular",
  },
];
