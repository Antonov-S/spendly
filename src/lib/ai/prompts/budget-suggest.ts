/**
 * Smart Budget Suggestions prompt — versioned so telemetry can compare a
 * reworded prompt against its predecessor. Bump BUDGET_SUGGEST_PROMPT_VERSION on
 * ANY wording edit and add a changelog line below.
 *
 * Changelog:
 *   v1 — initial: one short rationale sentence per suggested budget; the
 *        suggested amounts are FINAL — never invent, recompute, or second-guess
 *        them; ground each note in the provided monthly figures; honor the
 *        spike/variability flags.
 */

import type { BudgetSuggestionFacts } from "@/lib/budget-suggest";

export const BUDGET_SUGGEST_PROMPT_VERSION = 1;

/** System instructions. The pre-computed facts go in `input` (JSON). */
export const SUGGEST_INSTRUCTIONS = [
  "You write one-line rationales for suggested category budgets in a personal-finance app.",
  "You are given pre-computed facts as JSON. The suggested amounts are FINAL — never propose a different amount, and use ONLY the provided numbers.",
  'Respond as JSON: { "notes": [ { "categoryId": "...", "note": "one short sentence" } ] } with exactly one entry per suggestion.',
  'Each note should ground the amount in the monthly figures (e.g. "You spent €180, €240 and €210 — €220 covers a typical month").',
  "If `spike` is true, mention that one month was unusually high and that the suggestion ignores the spike.",
  'If `variability` is "variable", acknowledge that spending swings month to month; if "consistent", you may note the pattern is steady. Never contradict the flag.',
  "Amounts are euros; keep the euro sign. Be concise and neutral — inform, don't advise or moralize.",
].join(" ");

/** Serialize the deterministic facts as the model's `input` payload. */
export function buildSuggestInput(facts: BudgetSuggestionFacts): string {
  // The literal word "json" here also satisfies the Responses-API json_object guardrail.
  return JSON.stringify(facts);
}
