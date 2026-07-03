/**
 * Pure parse + numeric-honesty layer for the Monthly Review Narrative. Kept
 * SDK-free so both functions are unit-testable in isolation (spec §5.2):
 *
 *   parseReviewJson      — defensive `output_text` → normalized `string[]`.
 *   validateReviewNumbers — drops any line whose numbers aren't in `ReviewFacts`,
 *                           making D2 ("the model never invents a figure")
 *                           enforced, not merely instructed.
 *
 * The generic token/epsilon machinery lives in `@/lib/ai/numeric-guard`
 * (extracted for reuse by Smart Budget Suggestions); this module keeps only the
 * `ReviewFacts`-specific allowed-number set and the review parse rules.
 */

import { AiParseError } from "@/lib/ai/errors";
import {
  lineNumbersAllowed,
  type AllowedNumbers,
} from "@/lib/ai/numeric-guard";
import type { ReviewFacts } from "@/lib/reports-review";

/** Up to four short sentences; anything longer than this per line is dropped. */
const REVIEW_MAX_LINES = 4;
const REVIEW_LINE_MAX_CHARS = 240;

/** Coerce a value (array or single) into ≤4 trimmed, non-empty, sane-length lines. */
function coerceLines(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || trimmed.length > REVIEW_LINE_MAX_CHARS) continue;
    out.push(trimmed);
    if (out.length >= REVIEW_MAX_LINES) break;
  }
  return out;
}

/**
 * Defensive parse of the model's `output_text`. Accepts `{ summary: [...] }`,
 * `{ summary: "one line" }`, or a bare `"..."` string. Throws `AiParseError`
 * only when the payload is not valid JSON, or when nothing survives coercion
 * (garbage in). Never returns `[]` on success.
 */
export function parseReviewJson(raw: string): string[] {
  const text = raw?.trim();
  if (!text) throw new AiParseError("Empty AI output.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiParseError("AI output was not valid JSON.");
  }

  let lines: string[];
  if (typeof parsed === "string") {
    lines = coerceLines(parsed);
  } else if (parsed && typeof parsed === "object") {
    lines = coerceLines((parsed as Record<string, unknown>).summary);
  } else {
    lines = [];
  }

  if (lines.length === 0) {
    throw new AiParseError("AI output contained no usable summary lines.");
  }
  return lines;
}

function collectAllowed(facts: ReviewFacts): AllowedNumbers {
  const money: number[] = [];
  const pct: number[] = [];
  // Prose expresses direction in WORDS ("up", "over") and the magnitude as a
  // positive number, so allow both the signed value and its absolute value.
  const pushMoney = (n: number): void => {
    money.push(n, Math.abs(n));
  };
  pushMoney(facts.netCashflow);
  pushMoney(facts.totalIncome);
  pushMoney(facts.totalExpenses);
  for (const m of facts.movers) {
    pushMoney(m.current);
    pushMoney(m.previous);
    if (m.deltaPct != null) {
      const p = Math.round(m.deltaPct * 100);
      pct.push(p, Math.abs(p));
    }
  }
  for (const b of facts.budgetNotes) {
    pushMoney(b.spent);
    pushMoney(b.effectiveLimit);
    pushMoney(b.remaining);
  }
  return { money, pct };
}

/**
 * Drop every line containing a number that isn't in `facts` (within tolerance).
 * A faithful phrasing loses nothing; a misquoted "38%" has that line removed.
 * A line with no numbers passes. If NOTHING survives, throw `AiParseError` so the
 * whole call fails open to the charts rather than showing an empty card (D2).
 */
export function validateReviewNumbers(
  summary: string[],
  facts: ReviewFacts
): string[] {
  const allowed = collectAllowed(facts);
  const kept = summary.filter((line) => lineNumbersAllowed(line, allowed));
  if (kept.length === 0) {
    throw new AiParseError("No numerically-faithful summary lines survived.");
  }
  return kept;
}
