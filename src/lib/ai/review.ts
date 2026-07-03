/**
 * Pure parse + numeric-honesty layer for the Monthly Review Narrative. Kept
 * SDK-free so both functions are unit-testable in isolation (spec §5.2):
 *
 *   parseReviewJson      — defensive `output_text` → normalized `string[]`.
 *   validateReviewNumbers — drops any line whose numbers aren't in `ReviewFacts`,
 *                           making D2 ("the model never invents a figure")
 *                           enforced, not merely instructed.
 */

import { AiParseError } from "@/lib/ai/errors";
import type { ReviewFacts } from "@/lib/reports-review";

/** Up to four short sentences; anything longer than this per line is dropped. */
const REVIEW_MAX_LINES = 4;
const REVIEW_LINE_MAX_CHARS = 240;

/**
 * Money tokens match an allowed amount within one cent (absorbs the round-to-
 * cents already applied in `buildReviewFacts`). Percentage tokens match within
 * ±1 point (absorbs round-direction differences). Documented so future edits
 * stay deterministic — no fuzzy matching beyond these.
 */
export const NUMERIC_GUARD_MONEY_EPSILON = 0.01;
export const NUMERIC_GUARD_PCT_EPSILON = 1;

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

/** The numbers a faithful narrative is allowed to contain, built from the facts. */
interface AllowedNumbers {
  money: number[];
  pct: number[];
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

function withinAny(value: number, allowed: number[], epsilon: number): boolean {
  return allowed.some((a) => Math.abs(a - value) <= epsilon);
}

/**
 * Normalize a numeric token to a plain number. Strips the currency symbol (done
 * by the caller) and unifies thousands/decimal separators so `€1,234.5`,
 * `1.234,5`, and `1234.5` all become `1234.5`. Returns null on anything unparseable.
 */
function normalizeNumberToken(token: string): number | null {
  let t = token.replace(/\s+/g, "").replace(/−/g, "-");
  let sign = 1;
  if (t.startsWith("+")) t = t.slice(1);
  else if (t.startsWith("-")) {
    sign = -1;
    t = t.slice(1);
  }
  if (!t) return null;

  const hasComma = t.includes(",");
  const hasDot = t.includes(".");
  let normalized: string;
  if (hasComma && hasDot) {
    // The rightmost separator is the decimal; the other is a thousands grouping.
    const decSep = t.lastIndexOf(",") > t.lastIndexOf(".") ? "," : ".";
    const thouSep = decSep === "," ? "." : ",";
    normalized = t.split(thouSep).join("").replace(decSep, ".");
  } else if (hasComma) {
    normalized = normalizeSingleSep(t, ",");
  } else if (hasDot) {
    normalized = normalizeSingleSep(t, ".");
  } else {
    normalized = t;
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? sign * n : null;
}

/** A single `,`/`.` reads as decimal when it groups ≤2 trailing digits, else thousands. */
function normalizeSingleSep(t: string, sep: string): string {
  const parts = t.split(sep);
  if (parts.length > 2) return parts.join(""); // repeated → all thousands
  const [head, tail] = parts;
  return tail.length === 1 || tail.length === 2 ? `${head}.${tail}` : head + tail;
}

/** Matches a signed number (with separators) plus an optional trailing `%`. */
const TOKEN_RE = /([+\-−]?\d[\d.,]*\d|[+\-−]?\d)\s*(%?)/g;

function lineNumbersAllowed(line: string, allowed: AllowedNumbers): boolean {
  const cleaned = line.replace(/[€$]/g, "");
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(cleaned)) !== null) {
    const value = normalizeNumberToken(match[1]);
    if (value == null) continue;
    const isPct = match[2] === "%";
    const ok = isPct
      ? withinAny(value, allowed.pct, NUMERIC_GUARD_PCT_EPSILON)
      : withinAny(value, allowed.money, NUMERIC_GUARD_MONEY_EPSILON);
    if (!ok) return false; // one bad number condemns the whole line
  }
  return true;
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
