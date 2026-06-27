/**
 * NL Quick Capture parse prompt — versioned so §9 telemetry can compare a
 * reworded prompt's confirm-without-edit rate against its predecessor. Bump
 * TRANSACTION_PARSE_PROMPT_VERSION on ANY wording edit and add a changelog line.
 *
 * Changelog:
 *   v1 — initial: extract a single transaction; resolve relative dates against
 *        `today`; pick one category from the list or null.
 *   v2 — robustness: extract the amount even when a currency word/symbol is
 *        attached ("15 euro" -> 15); infer category from what was bought and
 *        where (food/drink at a supermarket -> groceries; meal/drinks at a
 *        restaurant/cafe/bar -> dining); treat the store/brand as the merchant;
 *        added a worked example.
 */
export const TRANSACTION_PARSE_PROMPT_VERSION = 2;

/** System instructions. The candidate list + note + today go in `input`. */
export const PARSE_INSTRUCTIONS = [
  "You extract ONE personal-finance transaction from a short note.",
  'Respond as JSON: { "type": "INCOME"|"EXPENSE", "amount": <positive number or null>,',
  '"date": <"YYYY-MM-DD">, "category": <name from the provided list, or null>,',
  '"merchant": <store/payee or null>, "note": <leftover detail or null>,',
  '"confidence": "high"|"low" }.',
  "The amount is the number in the note; extract it even when written with a currency word or symbol",
  '("15 euro", "€15", "15eur", "15.50" all mean the number 15 or 15.5). Return amount as a plain number, never a string.',
  "Default type to EXPENSE unless the text clearly describes income (salary, refund, paid, deposit).",
  "Resolve relative dates (today, yesterday, last friday, the 1st) against the provided `today`.",
  "If no date is mentioned, use `today`. Only return amount null when there is genuinely no number to read.",
  "The store, shop, supermarket, brand or payee named in the note is the merchant.",
  "Infer the category from WHAT was bought and WHERE: food, drinks or everyday goods bought at a supermarket or",
  "store usually means a groceries-type category; a meal, coffee or drinks at a restaurant, cafe or bar usually",
  "means a dining-type category; transit/fuel means transport, and so on.",
  "Choose the single best matching category from the provided list ONLY — never invent one; use null only when no list item fits.",
  'Example: note "15 euro beer Fantastico" with Fantastico a supermarket ->',
  '{ "type": "EXPENSE", "amount": 15, "category": "Groceries", "merchant": "Fantastico", "note": "beer", "confidence": "high" }.',
].join(" ");

/** Build the user `input` payload from today, the candidate names + the raw note. */
export function buildParseInput(args: {
  text: string;
  candidateNames: string[];
  today: string; // YYYY-MM-DD
}): string {
  return JSON.stringify({
    today: args.today,
    categories: args.candidateNames,
    note: args.text,
  });
}
