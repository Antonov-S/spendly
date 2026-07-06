"use server";

import { aiJsonRespond } from "@/lib/ai/respond";
import { runAiFeature, withAiTelemetry, type AiResult } from "@/lib/ai/run";
import { AiNoMatchError, AiParseError } from "@/lib/ai/errors";
import { track } from "@/lib/analytics/track";
import { getBudgetSuggestInputs } from "@/lib/db/budget-suggest";
import {
  buildBudgetSuggestionFacts,
  hasSuggestSignal,
  toBudgetSuggestions,
  type BudgetSuggestions,
} from "@/lib/budget-suggest";
import {
  parseSuggestionNotes,
  validateSuggestionNotes,
} from "@/lib/ai/budget-suggest";
import {
  SUGGEST_INSTRUCTIONS,
  BUDGET_SUGGEST_PROMPT_VERSION,
  buildSuggestInput,
} from "@/lib/ai/prompts/budget-suggest";
import { suggestBudgetsSchema } from "@/lib/validations/ai";
import { BUDGET_SUGGEST_MAX } from "@/lib/system-constants";

export type SuggestBudgetsResult = AiResult<BudgetSuggestions>;

/** Reason label for the D5 `ai_phrasing_degraded` event (the run.ts mapper is private). */
function reasonLabelForThrow(
  error: unknown
): "parse_failed" | "timeout" | "ai_error" {
  if (error instanceof AiParseError) return "parse_failed";
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return "ai_error";
}

/**
 * Propose per-category budget amounts for the viewed period from the user's own
 * spending history. **Read-only — accepting a row goes through `createBudget`;
 * the AI never writes.** Every suggested ceiling is deterministic
 * (`buildBudgetSuggestionFacts`, D1); the model only phrases a rationale, which
 * `validateSuggestionNotes` guards against the facts. Pro-gated, rate-capped, and
 * fail-open via `runAiFeature`: no eligible history → `reason: "no_match"`.
 *
 * D5 — inner graceful degradation: the amounts don't need the model, so a
 * phrasing failure must not sink the suggestions. Only the AI call is guarded;
 * fetcher/fact errors above still propagate (→ ai_error, outer fail-open).
 */
export async function suggestBudgets(input: {
  month: number;
  year: number;
}): Promise<SuggestBudgetsResult> {
  const parsed = suggestBudgetsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Couldn't suggest budgets right now.",
      reason: "ai_error",
    };
  }
  const { month, year } = parsed.data;

  return runAiFeature({
    feature: "budget_suggest",
    promptVersion: BUDGET_SUGGEST_PROMPT_VERSION,
    burstLimit: "aiSuggest", // shared 20/h policy, own bucket via `${feature}:${userId}`
    failOpenMessage: "Couldn't suggest budgets right now.",
    run: async ({ userId, signal }) => {
      const inputs = await getBudgetSuggestInputs(userId, month, year);
      const facts = buildBudgetSuggestionFacts(inputs, { max: BUDGET_SUGGEST_MAX });
      // Nothing clears the floors (or every historical category is already
      // budgeted) → no_match → quiet "not enough history" card.
      if (!hasSuggestSignal(facts)) {
        throw new AiNoMatchError("Not enough spending history.");
      }

      let notes = new Map<string, string>();
      let aiNotes = false;
      let aiResponse: Awaited<ReturnType<typeof aiJsonRespond>> | null = null;
      try {
        aiResponse = await aiJsonRespond({
          instructions: SUGGEST_INSTRUCTIONS,
          input: buildSuggestInput(facts),
          signal,
        });
        const proposed = parseSuggestionNotes(aiResponse.text, facts); // throws AiParseError on bad JSON
        notes = validateSuggestionNotes(proposed, facts); // drops misquoted notes
        aiNotes = notes.size > 0;

        // Diagnostic: how often the guard actually intervenes. Counts only.
        const dropped = proposed.size - notes.size;
        if (dropped > 0) {
          await track("ai_numeric_guard", {
            feature: "budget_suggest",
            prompt_version: BUDGET_SUGGEST_PROMPT_VERSION,
            dropped_count: dropped,
            kept_count: notes.size,
          });
        }
      } catch (error) {
        // Degrade to deterministic fallback copy — stats without prose (D5). The
        // orchestrator's `ai_result` stays "ok" (the user got a usable result),
        // so this event is the real AI-health signal for this feature.
        await track("ai_phrasing_degraded", {
          feature: "budget_suggest",
          prompt_version: BUDGET_SUGGEST_PROMPT_VERSION,
          reason: reasonLabelForThrow(error),
        });
      }

      const suggestions = toBudgetSuggestions(
        facts,
        notes,
        inputs.categories,
        aiNotes,
        BUDGET_SUGGEST_PROMPT_VERSION
      );
      return aiResponse ? withAiTelemetry(suggestions, aiResponse) : suggestions;
    },
  });
}
