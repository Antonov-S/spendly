import { round2 } from "@/lib/money";
import { SPLIT_MIN_LINES } from "@/lib/system-constants";

/**
 * A split line as edited in the drawer. `categoryId` is empty while the user is
 * still assigning categories (amounts-first receipt workflow); Save is gated on
 * every line being categorized. `amount` is a positive magnitude.
 */
export interface SplitDraft {
  categoryId: string;
  amount: number;
  note: string;
}

/**
 * Remaining = total − Σ split magnitudes, rounded to the cent. `0` = balanced,
 * `< 0` = over-allocated, `> 0` = under-allocated. Cent-rounded so the drawer
 * indicator never shows floating-point noise like `0.30000000000000004`.
 */
export function splitRemaining(
  total: number,
  lines: { amount: number }[]
): number {
  const allocated = lines.reduce((sum, l) => sum + (l.amount || 0), 0);
  return round2(total - allocated);
}

/**
 * True when a split draft is submittable: at least `SPLIT_MIN_LINES` lines,
 * every line has a category, and the remainder is exactly zero. Mirrors the
 * server-side superRefine (the client gate is UX; the server is authoritative).
 */
export function isSplitBalanced(total: number, lines: SplitDraft[]): boolean {
  if (lines.length < SPLIT_MIN_LINES) return false;
  if (lines.some((l) => !l.categoryId)) return false;
  return splitRemaining(total, lines) === 0;
}

/**
 * Return the lines with the current remainder added to the target line (default:
 * the last line). Powers the drawer's "Distribute remaining" one-click action.
 * Both operands are already cent values, so repeated calls can't accumulate
 * floating-point drift and a second call on a balanced split is a no-op.
 */
export function assignRemainder(
  total: number,
  lines: SplitDraft[],
  targetIndex: number = lines.length - 1
): SplitDraft[] {
  if (lines.length === 0) return lines;
  const remainder = splitRemaining(total, lines);
  if (remainder === 0) return lines;
  const idx =
    targetIndex >= 0 && targetIndex < lines.length
      ? targetIndex
      : lines.length - 1;
  return lines.map((line, i) =>
    i === idx ? { ...line, amount: round2(line.amount + remainder) } : line
  );
}
