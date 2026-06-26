import { AiParseError } from "@/lib/ai/errors";
import type { CategoryOption } from "@/types/transactions";

/** Normalized shape parsed out of the model's JSON output. */
export interface ParsedSuggestion {
  /** Lowercased + trimmed category name, or null when the model abstained. */
  category: string | null;
  confidence: "high" | "low";
  /** Cleaned merchant string, or null. Trimmed; never normalized to lowercase. */
  merchant: string | null;
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

function normalizeMerchant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Defensive parse of the model's `output_text`. Accepts the wrapped shape
 * `{ category, confidence, merchant }`, a bare `"name"` string, or noisy
 * variants (`{ tags: [...] }`); normalizes case/whitespace. Throws AiParseError
 * only when the payload is not even valid JSON. A well-formed payload with no
 * usable category yields `category: null` (the caller decides what that means).
 */
export function parseSuggestionJson(raw: string): ParsedSuggestion {
  const text = raw?.trim();
  if (!text) throw new AiParseError("Empty AI output.");

  // A bare quoted string is valid JSON and a legitimate "just the name" answer.
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiParseError("AI output was not valid JSON.");
  }

  if (typeof parsed === "string") {
    return { category: normalizeName(parsed), confidence: "low", merchant: null };
  }

  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    // Prefer `category`; fall back to the first entry of a `tags` array.
    let categoryRaw: unknown = obj.category;
    if (categoryRaw == null && Array.isArray(obj.tags)) {
      categoryRaw = obj.tags[0];
    }
    const confidence = obj.confidence === "high" ? "high" : "low";
    return {
      category: normalizeName(categoryRaw),
      confidence,
      merchant: normalizeMerchant(obj.merchant),
    };
  }

  // Valid JSON but a useless type (number/bool/null) — no category, not an error.
  return { category: null, confidence: "low", merchant: null };
}

/**
 * Case-insensitively match a model-returned name to one of the user's candidate
 * categories. Returns the matched option or null — NEVER invents an id. `name`
 * is expected pre-normalized (lowercased) from `parseSuggestionJson`.
 */
export function matchCategoryByName(
  name: string | null,
  categories: CategoryOption[]
): CategoryOption | null {
  if (!name) return null;
  const target = name.trim().toLowerCase();
  if (!target) return null;
  return categories.find((c) => c.name.trim().toLowerCase() === target) ?? null;
}
