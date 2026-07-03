/**
 * Monthly Review Narrative prompt — versioned so §9 telemetry can compare a
 * reworded prompt against its predecessor. Bump MONTHLY_REVIEW_PROMPT_VERSION on
 * ANY wording edit and add a changelog line below.
 *
 * Changelog:
 *   v1 — initial: phrase the provided month-over-month facts into 1–4 short
 *        sentences; lead with `topInsight`; never invent or recompute figures;
 *        no dates/years in the prose (they live in the card header).
 */

import type { ReviewFacts } from "@/lib/reports-review";

export const MONTHLY_REVIEW_PROMPT_VERSION = 1;

/** System instructions. The pre-computed facts go in `input` (JSON). */
export const REVIEW_INSTRUCTIONS = [
  "You write a brief, friendly monthly spending summary for a personal-finance app.",
  "You are given pre-computed facts as JSON. Use ONLY those numbers — never invent, estimate, or recompute figures.",
  'Respond as JSON: { "summary": [ up to 4 short plain-language sentences ] }.',
  "Lead with the fact named by `topInsight`, then mention other notable movers, budget over/under, and net cashflow.",
  "Amounts are euros: write them exactly as given (keep the euro sign and any cents). Do NOT round.",
  'If a mover is marked "new", describe it as new spending this month, not a percentage change.',
  "Do NOT include dates, years, day numbers, or any figure that is not in the provided facts.",
  "Be concise and neutral — inform, don't advise or moralize.",
].join(" ");

/** Serialize the deterministic facts as the model's `input` payload. */
export function buildReviewInput(facts: ReviewFacts): string {
  // The literal word "json" here also satisfies the Responses-API json_object guardrail.
  return JSON.stringify(facts);
}
