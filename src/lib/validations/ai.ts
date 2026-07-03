import { z } from "zod";

/**
 * Input to the `suggestCategory` AI action. TRANSFER is rejected at the type
 * level — transfers have no category. Free-text length is enforced by the
 * action's `clip()` (truncate to AI_INPUT_MAX_CHARS before the call) rather than
 * a hard schema cap, so over-long input is truncated regardless, never rejected.
 */
export const suggestCategorySchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  merchant: z.string().nullish(),
  note: z.string().nullish(),
  amount: z.number().finite().nullish(),
});

export type SuggestCategoryInput = z.infer<typeof suggestCategorySchema>;

/**
 * Input to the `parseTransaction` AI action (NL Quick Capture). Free-text length
 * is enforced by the action's `clip()` (truncate to AI_INPUT_MAX_CHARS before the
 * call) like suggestCategory — over-long input is truncated, never rejected.
 */
export const parseTransactionSchema = z.object({
  text: z.string().min(1, "Type what you spent."),
});

export type ParseTransactionInput = z.infer<typeof parseTransactionSchema>;

/**
 * Input to the `generateMonthlyReview` AI action (Pro Monthly Review Narrative).
 * The only input is the active account scope — the window is fixed month-over-
 * month server-side (spec D3), independent of the Reports period pills. `nullish`
 * mirrors "all accounts" (no `?account=`).
 */
export const monthlyReviewSchema = z.object({
  accountId: z.string().nullish(),
});

export type MonthlyReviewInput = z.infer<typeof monthlyReviewSchema>;
