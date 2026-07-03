/**
 * Shared numeric-honesty core for AI-phrased prose. Extracted verbatim from the
 * Monthly Review guard (`src/lib/ai/review.ts`, spec §5.4) so every AI feature
 * that lets the model phrase pre-computed figures can enforce — not merely
 * instruct — "the model never invents a number". Each feature builds its own
 * facts-specific `AllowedNumbers` set and filters lines through
 * `lineNumbersAllowed`. Kept SDK-free so it is unit-testable in isolation.
 */

/**
 * Money tokens match an allowed amount within one cent (absorbs the round-to-
 * cents already applied by the fact builders). Percentage tokens match within
 * ±1 point (absorbs round-direction differences). Documented so future edits
 * stay deterministic — no fuzzy matching beyond these.
 */
export const NUMERIC_GUARD_MONEY_EPSILON = 0.01;
export const NUMERIC_GUARD_PCT_EPSILON = 1;

/** The numbers a faithful line is allowed to contain, built from a feature's facts. */
export interface AllowedNumbers {
  money: number[];
  pct: number[];
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

export function lineNumbersAllowed(
  line: string,
  allowed: AllowedNumbers
): boolean {
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
