"use server";

import { track } from "@/lib/analytics/track";
import { BUDGET_SUGGEST_PROMPT_VERSION } from "@/lib/ai/prompts/budget-suggest";

/**
 * Fire-and-forget telemetry for Smart Budget Suggestions outcomes. Lives as
 * server actions because `track` is server-only and the panel is a client
 * component. Neither touches the ledger; the panel's own `createBudget` call is
 * the sole writer. Flags/counts ONLY — no amounts or category names cross the
 * shim's no-PII contract.
 */

/**
 * One accepted row → the headline acceptance metric. `edited` distinguishes
 * "accepted as-is" from "used as a starting point" (the user changed the amount
 * before Add).
 */
export async function trackBudgetAccepted(input: {
  edited: boolean;
  promptVersion?: number;
}): Promise<void> {
  await track("ai_budget_suggest_accepted", {
    feature: "budget_suggest",
    prompt_version: input.promptVersion ?? BUDGET_SUGGEST_PROMPT_VERSION,
    edited: input.edited,
  });
}

/**
 * Explicit Dismiss on a rendered result set — separates "suggestions were poor"
 * (low acceptance WITH dismissals) from "engagement was low" (few generations,
 * few dismissals). Navigating away is NOT a dismissal — only the explicit control
 * emits, keeping the signal clean.
 */
export async function trackBudgetDismissed(input: {
  suggestedCount: number;
  acceptedCount: number;
  promptVersion?: number;
}): Promise<void> {
  await track("ai_budget_suggest_dismissed", {
    feature: "budget_suggest",
    prompt_version: input.promptVersion ?? BUDGET_SUGGEST_PROMPT_VERSION,
    suggested_count: input.suggestedCount,
    accepted_count: input.acceptedCount,
  });
}
