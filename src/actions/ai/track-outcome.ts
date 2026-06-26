"use server";

import { track } from "@/lib/analytics/track";
import { CATEGORY_PROMPT_VERSION } from "@/lib/ai/prompts/category";

/**
 * Fire-and-forget telemetry for whether the user kept the AI-suggested category.
 * Lives as a server action because `track` is server-only and the drawer is a
 * client component. Does NOT touch the ledger — write-path actions are unchanged.
 * Emitted on Save: accepted = suggested category kept, else overridden.
 */
export async function trackCategoryOutcome(input: {
  accepted: boolean;
  promptVersion?: number;
}): Promise<void> {
  await track(
    input.accepted ? "ai_category_accepted" : "ai_category_overridden",
    {
      feature: "category_suggest",
      prompt_version: input.promptVersion ?? CATEGORY_PROMPT_VERSION,
    }
  );
}
