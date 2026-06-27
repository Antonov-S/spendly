"use server";

import { track } from "@/lib/analytics/track";
import { TRANSACTION_PARSE_PROMPT_VERSION } from "@/lib/ai/prompts/transaction";

/**
 * Parse-owned fields whose post-parse edits we measure. NAMES only — never the
 * values (which are PII/financial and must not cross the telemetry shim).
 */
export type ParsedField =
  | "type"
  | "amount"
  | "date"
  | "category"
  | "merchant"
  | "note";

/**
 * Fire-and-forget telemetry for whether a parse-originated entry was confirmed
 * and how heavily it was edited first. Lives as a server action because `track`
 * is server-only and the drawer is a client component. Does NOT touch the
 * ledger. Emitted on Save (confirmed = true in v1); discarding without saving
 * emits nothing, mirroring trackCategoryOutcome.
 */
export async function trackParseOutcome(input: {
  confirmed: boolean; // reserved; v1 only emits on Save (confirmed = true)
  editedFields: ParsedField[]; // which drafted fields the user changed before Save
  promptVersion?: number;
}): Promise<void> {
  await track("ai_parse_confirmed", {
    feature: "transaction_parse",
    prompt_version: input.promptVersion ?? TRANSACTION_PARSE_PROMPT_VERSION,
    edited: input.editedFields.length > 0, // headline metric
    edited_field_count: input.editedFields.length, // how heavy the edit was
    edited_fields: input.editedFields.join(","), // WHICH fields — next-iteration signal
  });
}
