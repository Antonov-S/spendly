/**
 * Pure parse + numeric-honesty layer for Smart Budget Suggestions. Kept SDK-free
 * so both functions are unit-testable in isolation (spec §5.4). Unlike the
 * Monthly Review guard, a note is OPTIONAL per suggestion — the deterministic
 * amounts stand on their own — so nothing here throws on an empty result set;
 * a missing or dropped note simply falls back to deterministic copy (D5).
 */

import { AiParseError } from "@/lib/ai/errors";
import {
  lineNumbersAllowed,
  type AllowedNumbers,
} from "@/lib/ai/numeric-guard";
import type { BudgetSuggestionFacts } from "@/lib/budget-suggest";

/** A rationale longer than this is dropped (a "one short sentence" bound). */
const BUDGET_SUGGEST_NOTE_MAX = 240;

/**
 * Defensive parse of the model's `output_text` into a `Map<categoryId, note>`.
 * Accepts `{ notes: [ { categoryId | name, note } ] }`. Tolerates a `name` key
 * by matching case-insensitively against the facts. Drops entries whose category
 * isn't in the facts (the model can never ADD a suggestion), whose note is not a
 * trimmed non-empty string, or that exceed the length cap. Throws `AiParseError`
 * ONLY when the payload isn't valid JSON — an otherwise-empty map is valid (every
 * row just gets the fallback note).
 */
export function parseSuggestionNotes(
  raw: string,
  facts: BudgetSuggestionFacts
): Map<string, string> {
  const text = raw?.trim();
  if (!text) throw new AiParseError("Empty AI output.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiParseError("AI output was not valid JSON.");
  }

  const notes = new Map<string, string>();
  const entries =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>).notes
      : undefined;
  if (!Array.isArray(entries)) return notes;

  const byId = new Map(facts.suggestions.map((s) => [s.categoryId, s]));
  const byName = new Map(
    facts.suggestions.map((s) => [s.name.toLowerCase(), s.categoryId])
  );

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;

    // Prefer categoryId; tolerate a name key resolved case-insensitively.
    let categoryId: string | undefined;
    if (typeof record.categoryId === "string" && byId.has(record.categoryId)) {
      categoryId = record.categoryId;
    } else if (typeof record.name === "string") {
      categoryId = byName.get(record.name.toLowerCase());
    }
    if (!categoryId || notes.has(categoryId)) continue;

    if (typeof record.note !== "string") continue;
    const note = record.note.trim();
    if (!note || note.length > BUDGET_SUGGEST_NOTE_MAX) continue;

    notes.set(categoryId, note);
  }

  return notes;
}

/** The numbers a faithful note for one suggestion may contain. */
function allowedForSuggestion(
  suggestion: BudgetSuggestionFacts["suggestions"][number],
  lookbackMonths: number
): AllowedNumbers {
  const money: number[] = [];
  const push = (n: number): void => {
    money.push(n, Math.abs(n));
  };
  for (const m of suggestion.monthly) push(m);
  push(suggestion.median);
  push(suggestion.average);
  push(suggestion.suggestedAmount);
  // "your last 3 months" — a bare small integer reads as a money token.
  money.push(lookbackMonths);
  return { money, pct: [] };
}

/**
 * Drop any note whose numbers aren't in that suggestion's facts (within the
 * shared money/pct tolerance). A faithful phrasing loses nothing; a misquoted
 * euro figure has its note removed — that row falls back to deterministic copy.
 * No all-dropped throw (unlike Monthly Review): the amounts stand on their own.
 */
export function validateSuggestionNotes(
  notes: Map<string, string>,
  facts: BudgetSuggestionFacts
): Map<string, string> {
  const kept = new Map<string, string>();
  const byId = new Map(facts.suggestions.map((s) => [s.categoryId, s]));
  for (const [categoryId, note] of notes) {
    const suggestion = byId.get(categoryId);
    if (!suggestion) continue;
    const allowed = allowedForSuggestion(suggestion, facts.lookbackMonths);
    if (lineNumbersAllowed(note, allowed)) kept.set(categoryId, note);
  }
  return kept;
}
