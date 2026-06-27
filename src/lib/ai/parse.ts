import { AiParseError } from "@/lib/ai/errors";
import { todayDateInputValue } from "@/lib/date";

/**
 * Coarse confidence flag. v1 is "high" | "low"; this alias is the SINGLE place
 * to widen later (e.g. add "medium"). `parseDraftJson` is the single
 * normalization gate, and the UI keys off `=== "high"` (anything else → "check
 * this draft"), so a new tier needs no UI change — see spec §5.2 / D9.
 */
export type ParseConfidence = "high" | "low";

/** Normalized shape parsed out of the model's JSON output (pre category-match). */
export interface ParsedDraft {
  type: "INCOME" | "EXPENSE";
  /** Positive magnitude, or null when no amount could be read (→ AiNoMatchError). */
  amount: number | null;
  /** "YYYY-MM-DD" candidate, or null — guarded by `resolveDraftDate` downstream. */
  date: string | null;
  /** Lowercased + trimmed category name, or null (handed to matchCategoryByName). */
  category: string | null;
  /** Extracted merchant/payee, or null. Trimmed; never lowercased. */
  merchant: string | null;
  /** Leftover descriptive text, or null. Trimmed; never lowercased. */
  note: string | null;
  confidence: ParseConfidence;
}

/**
 * A finite, strictly-positive number (magnitude) or null. Accepts a number or a
 * numeric string — the model is asked for a plain number but sometimes echoes
 * "15" or "15 euro"; `parseFloat` reads the leading number so the draft still
 * gets an amount instead of failing open. Rejects NaN/0/objects/bools.
 */
function normalizeAmount(value: unknown): number | null {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    // Pull the first numeric token out of anywhere in the string, tolerating a
    // leading currency symbol/word and an EU decimal comma ("€15,50" -> 15.5).
    const match = value.replace(",", ".").match(/\d+(?:\.\d+)?/);
    n = match ? parseFloat(match[0]) : NaN;
  } else {
    return null;
  }
  if (!Number.isFinite(n)) return null;
  const magnitude = Math.abs(n);
  return magnitude > 0 ? magnitude : null;
}

/** Lowercased + trimmed string, or null when blank/non-string. */
function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

/** Trimmed non-empty string (original case), or null. */
function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Defensive parse of the model's `output_text` into a normalized draft. Throws
 * AiParseError only when the payload is not even valid JSON. A well-formed
 * payload with `amount: null` is NOT a parse error — it returns `amount: null`
 * and the *action* turns that into AiNoMatchError, keeping "unparseable JSON"
 * and "no amount" distinct in telemetry (spec §3 / §5.2). Mirrors
 * `parseSuggestionJson`'s defensiveness.
 */
export function parseDraftJson(raw: string): ParsedDraft {
  const text = raw?.trim();
  if (!text) throw new AiParseError("Empty AI output.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiParseError("AI output was not valid JSON.");
  }

  // Anything other than an object (number/bool/string/null) has no usable draft.
  if (!parsed || typeof parsed !== "object") {
    return {
      type: "EXPENSE",
      amount: null,
      date: null,
      category: null,
      merchant: null,
      note: null,
      confidence: "low",
    };
  }

  const obj = parsed as Record<string, unknown>;
  return {
    // Income only when the model said so exactly; everything else → EXPENSE.
    type: obj.type === "INCOME" ? "INCOME" : "EXPENSE",
    amount: normalizeAmount(obj.amount),
    date: normalizeText(obj.date),
    category: normalizeName(obj.category),
    merchant: normalizeText(obj.merchant),
    note: normalizeText(obj.note),
    confidence: obj.confidence === "high" ? "high" : "low",
  };
}

/**
 * Guard a model-supplied date: keep it only when it is a literal "YYYY-MM-DD"
 * string, else fall back to today. No UTC coercion — consistent with the
 * calendar-date architecture decision and the drawer's existing date handling.
 */
export function resolveDraftDate(value: string | null | undefined): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return todayDateInputValue();
}
