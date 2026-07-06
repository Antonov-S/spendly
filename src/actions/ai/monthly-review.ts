"use server";

import { aiJsonRespond } from "@/lib/ai/respond";
import { runAiFeature, withAiTelemetry, type AiResult } from "@/lib/ai/run";
import { AiNoMatchError } from "@/lib/ai/errors";
import { track } from "@/lib/analytics/track";
import { getMonthlyReviewInputs } from "@/lib/db/monthly-review";
import { buildReviewFacts, hasReviewSignal } from "@/lib/reports-review";
import { parseReviewJson, validateReviewNumbers } from "@/lib/ai/review";
import {
  REVIEW_INSTRUCTIONS,
  MONTHLY_REVIEW_PROMPT_VERSION,
  buildReviewInput,
} from "@/lib/ai/prompts/review";
import { monthlyReviewSchema } from "@/lib/validations/ai";

/** A generated month-over-month summary. Read-only insight — never written. */
export interface MonthlyReviewNarrative {
  /** 1–4 short, plain-language sentences built from pre-computed facts. */
  summary: string[];
  /** The month the narrative describes, e.g. "July 2026" — for the card header. */
  periodLabel: string;
  /** Echoed so any later feedback telemetry tags the right prompt version. */
  promptVersion: number;
}

export type MonthlyReviewResult = AiResult<MonthlyReviewNarrative>;

/** How many facts of each kind the model is asked to phrase. Call-site tuning. */
const MAX_MOVERS = 3;
const MAX_BUDGET_NOTES = 2;

/**
 * Generate a plain-language summary of how this calendar month compares to last,
 * for the active account scope. **Read-only insight — never writes.** The
 * deterministic `buildReviewFacts` owns every figure; the model only phrases
 * them, and `validateReviewNumbers` then drops any line whose numbers aren't in
 * the facts (D2). Pro-gated, rate-capped, and fail-open via `runAiFeature`: a
 * sparse month → `reason: "no_match"`; every other error degrades to the charts.
 */
export async function generateMonthlyReview(input: {
  accountId?: string | null;
}): Promise<MonthlyReviewResult> {
  const parsed = monthlyReviewSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Couldn't generate a summary right now.",
      reason: "ai_error",
    };
  }
  const accountId = parsed.data.accountId ?? undefined;

  return runAiFeature({
    feature: "monthly_review",
    promptVersion: MONTHLY_REVIEW_PROMPT_VERSION,
    burstLimit: "aiSuggest", // shared 20/h policy, own bucket via `${feature}:${userId}`
    failOpenMessage: "Couldn't generate a summary — your charts are below.",
    run: async ({ userId, signal }) => {
      const inputs = await getMonthlyReviewInputs(userId, accountId);
      const facts = buildReviewFacts(inputs, {
        maxMovers: MAX_MOVERS,
        maxBudgetNotes: MAX_BUDGET_NOTES,
      });
      // Nothing worth narrating → no_match → quiet "not enough data" card.
      if (!hasReviewSignal(facts)) {
        throw new AiNoMatchError("Not enough month-over-month data.");
      }

      const response = await aiJsonRespond({
        instructions: REVIEW_INSTRUCTIONS,
        input: buildReviewInput(facts),
        signal,
      });
      const parsedLines = parseReviewJson(response.text); // throws AiParseError on bad JSON
      const summary = validateReviewNumbers(parsedLines, facts); // drops misquoted lines

      // Diagnostic: how often the D2 guard actually intervenes. Counts only — no
      // financial values or line text (the shim's standing no-PII contract).
      const dropped = parsedLines.length - summary.length;
      if (dropped > 0) {
        await track("ai_numeric_guard", {
          feature: "monthly_review",
          prompt_version: MONTHLY_REVIEW_PROMPT_VERSION,
          dropped_count: dropped,
          kept_count: summary.length,
        });
      }

      return withAiTelemetry(
        {
          summary,
          periodLabel: facts.periodLabel,
          promptVersion: MONTHLY_REVIEW_PROMPT_VERSION,
        } satisfies MonthlyReviewNarrative,
        response
      );
    },
  });
}
