/**
 * Categorization prompt — versioned so §9 telemetry can compare a reworded
 * prompt's acceptance rate against its predecessor. Bump CATEGORY_PROMPT_VERSION
 * on ANY wording edit and add a changelog line below.
 *
 * Changelog:
 *   v1 — initial: pick one category from the provided list; coarse confidence;
 *        conservative merchant cleanup.
 */
export const CATEGORY_PROMPT_VERSION = 1;

/** System instructions. The candidate list + transaction details go in `input`. */
export const CATEGORY_INSTRUCTIONS = [
  "You categorize a personal-finance transaction.",
  "Choose the single best category from the provided list ONLY — never invent a category.",
  'Respond as JSON: { "category": <name from the list, or null>, "confidence": "high" | "low", "merchant": <cleaned merchant or null> }.',
  "Use null category and low confidence when you are unsure.",
  'Only return a non-null "merchant" when it is a materially cleaner version of the input (e.g. "AMZN MKTP US*2H4..." -> "Amazon"); otherwise return null.',
].join(" ");

/** Build the user `input` payload from the candidate names + transaction fields. */
export function buildCategoryInput(args: {
  candidateNames: string[];
  type: "INCOME" | "EXPENSE";
  merchant: string | null;
  note: string | null;
  amount: number | null;
}): string {
  return JSON.stringify({
    categories: args.candidateNames,
    transaction: {
      type: args.type,
      merchant: args.merchant,
      note: args.note,
      amount: args.amount,
    },
  });
}
