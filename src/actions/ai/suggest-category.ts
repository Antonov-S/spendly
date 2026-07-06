"use server";

import { getUserCategories } from "@/lib/db/categories";
import { aiJsonRespond } from "@/lib/ai/respond";
import { runAiFeature, withAiTelemetry, type AiResult } from "@/lib/ai/run";
import { parseSuggestionJson, matchCategoryByName } from "@/lib/ai/category";
import {
  CATEGORY_INSTRUCTIONS,
  CATEGORY_PROMPT_VERSION,
  buildCategoryInput,
} from "@/lib/ai/prompts/category";
import { suggestCategorySchema } from "@/lib/validations/ai";
import { AI_INPUT_MAX_CHARS } from "@/lib/system-constants";

/** A category suggestion the drawer pre-selects for the user to confirm. */
export interface CategorySuggestion {
  /** Matched to one of the user's categories, or null (fall open to manual). */
  categoryId: string | null;
  /** Resolved name for display, or null. */
  categoryName: string | null;
  /** Coarse flag driving UI emphasis (high = confident, low = "check it"). */
  confidence: "high" | "low";
  /** Cleaned merchant string, only when materially better; else null. */
  merchant: string | null;
  /** Echoed so accept/override telemetry tags the right prompt version (§9). */
  promptVersion: number;
}

export type SuggestResult = AiResult<CategorySuggestion>;

/** Truncate free-text before sending to the model (token control). */
function clip(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, AI_INPUT_MAX_CHARS);
}

/**
 * Suggest the most likely category for an in-progress transaction. Returns a
 * suggestion object ONLY — never writes (createTransaction/updateTransaction
 * stay the sole writers). Pro-gated, rate-capped, and fail-open: every error
 * path returns an AiResult whose `reason` the drawer maps to a quiet message,
 * never a blocked form. `no_match` degrades to `categoryId: null` rather than
 * throwing — a null-category suggestion is still usable here.
 */
export async function suggestCategory(input: {
  type: "INCOME" | "EXPENSE";
  merchant?: string | null;
  note?: string | null;
  amount?: number | null;
}): Promise<SuggestResult> {
  const parsed = suggestCategorySchema.safeParse(input);
  if (!parsed.success) {
    // Defensive: the drawer hides the button for transfers, so this is a guard.
    return {
      success: false,
      error: "Can't suggest a category for this transaction.",
      reason: "ai_error",
    };
  }

  const { type, merchant, note, amount } = parsed.data;
  const cleanMerchant = clip(merchant);
  const cleanNote = clip(note);

  return runAiFeature({
    feature: "category_suggest",
    promptVersion: CATEGORY_PROMPT_VERSION,
    burstLimit: "aiSuggest", // the global aiMonthly cap is applied by runAiFeature
    failOpenMessage: "Couldn't suggest a category — pick one manually.",
    run: async ({ userId, signal }) => {
      const categories = await getUserCategories(userId); // system + own
      const response = await aiJsonRespond({
        instructions: CATEGORY_INSTRUCTIONS,
        input: buildCategoryInput({
          candidateNames: categories.map((c) => c.name),
          type,
          merchant: cleanMerchant,
          note: cleanNote,
          amount: amount ?? null,
        }),
        signal,
      });

      const suggestion = parseSuggestionJson(response.text); // throws AiParseError on bad JSON
      const match = matchCategoryByName(suggestion.category, categories);

      // no_match is NOT a hard failure for this feature: a confident-but-unmatched
      // name degrades to a null-category suggestion (still usable: manual picker).
      return withAiTelemetry(
        {
          categoryId: match?.id ?? null,
          categoryName: match?.name ?? null,
          confidence: suggestion.confidence,
          merchant: suggestion.merchant,
          promptVersion: CATEGORY_PROMPT_VERSION,
        } satisfies CategorySuggestion,
        response
      );
    },
  });
}
