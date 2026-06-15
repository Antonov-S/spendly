/**
 * AI section copy and the static auto-tagging mock. The AI categorization
 * backend is a real, planned Pro capability that lands in a later spec — this
 * section is the marketing surface only (no live AI call). The mock card is
 * decorative; its merchants/categories are illustrative, not real data.
 */

export const AI_SECTION = {
  badge: "Pro feature",
  title: "AI categorization that keeps you in control",
  subtitle:
    "Spendly suggests a category and tags the moment you type a merchant — you just confirm. The conscious moment stays; the busywork goes.",
  /** Window-chrome label on the decorative mock card. */
  mockTitle: "Auto-tagging",
  /** Footer caption on the mock card, reinforcing confirm-before-apply. */
  mockFooter: "AI-suggested · confirm to apply",
} as const;

/** Capability checklist rendered beside the mock (Lucide Check rows). */
export const AI_CAPABILITIES: string[] = [
  "Suggests a category the moment you type a merchant",
  "Smart tags that learn from how you classify spending",
  "Plain-language insight into where your money went",
  "Flags recurring charges and surfaces them as drafts",
];

/** One auto-tagged transaction row in the decorative mock card. */
export interface AiSampleTag {
  merchant: string;
  /** Pre-formatted signed display amount (mock — not run through formatters). */
  amount: string;
  category: string;
  /** Hex accent for the suggested-category pill. */
  color: string;
}

export const AI_SAMPLE_TAGS: AiSampleTag[] = [
  { merchant: "Whole Foods Market", amount: "−$84", category: "Groceries", color: "#EF9F27" },
  { merchant: "Netflix", amount: "−$16", category: "Subscriptions", color: "#378ADD" },
  { merchant: "Shell", amount: "−$52", category: "Transport", color: "#7F77DD" },
  { merchant: "Blue Bottle Coffee", amount: "−$9", category: "Dining", color: "#D85A30" },
];
