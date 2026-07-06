"use server";

import { getUserCategories } from "@/lib/db/categories";
import { aiJsonRespond } from "@/lib/ai/respond";
import { runAiFeature, withAiTelemetry, type AiResult } from "@/lib/ai/run";
import { matchCategoryByName } from "@/lib/ai/category";
import {
  parseDraftJson,
  resolveDraftDate,
  type ParseConfidence,
} from "@/lib/ai/parse";
import { AiNoMatchError } from "@/lib/ai/errors";
import {
  PARSE_INSTRUCTIONS,
  TRANSACTION_PARSE_PROMPT_VERSION,
  buildParseInput,
} from "@/lib/ai/prompts/transaction";
import { parseTransactionSchema } from "@/lib/validations/ai";
import { AI_INPUT_MAX_CHARS } from "@/lib/system-constants";
import { todayDateInputValue } from "@/lib/date";

// Note: `ParseConfidence` is NOT re-exported here — a "use server" module may
// only export async functions at runtime, and Turbopack's server-actions loader
// emits even a `export type { … }` re-export as a runtime binding (→ ReferenceError).
// Consumers that need the type import it from `@/lib/ai/parse` directly.

/**
 * A transaction draft parsed from one line of natural language. Pre-fills the
 * drawer for the user to confirm — never written. `createTransaction` stays the
 * sole writer (spec §3).
 */
export interface ParsedTransactionDraft {
  /** Never TRANSFER in v1. */
  type: "INCOME" | "EXPENSE";
  /** Positive magnitude; sign is derived on save by createTransaction. */
  amount: number;
  /** "YYYY-MM-DD", validated/guarded server-side (calendar date, no UTC). */
  date: string;
  /** Matched to one of the user's categories, or null (manual picker). */
  categoryId: string | null;
  /** Resolved name for display, or null. */
  categoryName: string | null;
  /** Extracted merchant, or null. */
  merchant: string | null;
  /** Leftover descriptive text, or null. */
  note: string | null;
  /** Coarse flag → UI emphasis (non-"high" = "check this draft"). */
  confidence: ParseConfidence;
  /** Echoed so confirm/edit telemetry tags the right prompt version. */
  promptVersion: number;
}

export type ParseResult = AiResult<ParsedTransactionDraft>;

/** Truncate free-text before sending to the model (token control). */
function clip(value: string): string {
  return value.trim().slice(0, AI_INPUT_MAX_CHARS);
}

/**
 * Parse one line of natural language into an unsaved transaction draft (NL Quick
 * Capture). Returns a suggestion object ONLY — never writes. Pro-gated,
 * rate-capped, and fail-open: every error path returns an AiResult whose
 * `reason` the drawer maps to a quiet message, never a blocked form.
 *
 * `amount` is the hard requirement: a draft with no readable amount is useless,
 * so the run step throws AiNoMatchError → `reason: "no_match"` → the drawer fails
 * open. `categoryId` is soft — an unmatched/absent category degrades to null
 * (manual picker), never an error, identical to suggestCategory.
 */
export async function parseTransaction(input: {
  text: string;
}): Promise<ParseResult> {
  const parsed = parseTransactionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Type what you spent.",
      reason: "ai_error",
    };
  }

  const clippedText = clip(parsed.data.text);

  return runAiFeature({
    feature: "transaction_parse",
    promptVersion: TRANSACTION_PARSE_PROMPT_VERSION,
    // Shared POLICY, separate BUCKET (key is `${feature}:${userId}`); the global
    // aiMonthly COGS cap is applied by runAiFeature regardless (spec §5.3).
    burstLimit: "aiSuggest",
    failOpenMessage: "Couldn't read that — add the details manually.",
    run: async ({ userId, signal }) => {
      const categories = await getUserCategories(userId); // system + own
      const response = await aiJsonRespond({
        instructions: PARSE_INSTRUCTIONS,
        input: buildParseInput({
          text: clippedText,
          candidateNames: categories.map((c) => c.name),
          today: todayDateInputValue(), // model resolves "yesterday" against this
        }),
        signal,
      });

      const draft = parseDraftJson(response.text); // throws AiParseError on bad JSON
      if (draft.amount == null) {
        throw new AiNoMatchError("No amount in input.");
      }
      const match = matchCategoryByName(draft.category, categories); // soft

      return withAiTelemetry(
        {
          type: draft.type,
          amount: draft.amount,
          date: resolveDraftDate(draft.date), // guard → today on invalid/absent
          categoryId: match?.id ?? null,
          categoryName: match?.name ?? null,
          merchant: draft.merchant,
          note: draft.note,
          confidence: draft.confidence,
          promptVersion: TRANSACTION_PARSE_PROMPT_VERSION,
        } satisfies ParsedTransactionDraft,
        response
      );
    },
  });
}
