/**
 * Deterministic fact-builder for the Pro AI **Monthly Review Narrative**. This
 * is the load-bearing layer of the feature: it turns two months of category
 * spend + income/expense totals + current-month budget adherence into a compact,
 * ranked, **already-numeric** `ReviewFacts` structure. The model that phrases it
 * (see `src/lib/ai/prompts/review.ts`) only writes English from these numbers —
 * it never computes or invents a figure (spec D2). Pure + deterministic: no
 * Prisma, no SDK, `now`-free — unit-tested like `bucketByMonth` / `summarizeBudgets`.
 */

import { round2 } from "@/lib/money";
import { effectiveLimit } from "@/lib/rollover";
import { REVIEW_MIN_MOVER_DELTA } from "@/lib/system-constants";
import { UNCATEGORIZED } from "@/lib/constants";
import type { BudgetListRow } from "@/types/dashboard";

/**
 * Everything `getMonthlyReviewInputs` assembles for a given account scope. Spend
 * maps are keyed by category id (or `null` for genuinely-uncategorized spend),
 * exactly as `getCategorySpend` returns them. `categoryNames` resolves the ids
 * that appear (null gets the shared "Uncategorized" label here, not in the map).
 */
export interface ReviewInputs {
  currentSpend: Map<string | null, number>;
  priorSpend: Map<string | null, number>;
  currentTotals: { income: number; expenses: number };
  priorTotals: { income: number; expenses: number };
  /** Current-month budgets (rollover- & split-aware) straight from `getBudgets`. */
  budgets: BudgetListRow[];
  /** categoryId → display name for every id appearing in the spend maps. */
  categoryNames: Map<string, string>;
  /** e.g. "July 2026" — the month the narrative describes. */
  periodLabel: string;
}

/** A category whose spend moved materially vs last month. */
export interface ReviewMover {
  name: string;
  current: number;
  previous: number;
  /** null when `previous == 0` (new spend — never a divide-by-zero / bogus ∞%). */
  deltaPct: number | null;
  direction: "up" | "down" | "new";
}

/** A notable current-month budget status against its EFFECTIVE (rollover) limit. */
export interface ReviewBudgetNote {
  name: string;
  spent: number;
  effectiveLimit: number;
  /** effectiveLimit − spent (may be negative when over). */
  remaining: number;
  status: "over" | "under";
}

/** The single most impactful fact — the prompt is told to lead with it (D7). */
export interface ReviewTopInsight {
  kind: "mover" | "budget" | "cashflow";
  /** The referenced category name, or "cashflow". */
  ref: string;
}

/** The compact, ranked, already-numeric structure the model only has to phrase. */
export interface ReviewFacts {
  periodLabel: string;
  netCashflow: number;
  totalIncome: number;
  totalExpenses: number;
  topInsight: ReviewTopInsight | null;
  movers: ReviewMover[];
  budgetNotes: ReviewBudgetNote[];
}

/** Case-insensitive name order — the stable secondary key for every ranking. */
function byName(a: { name: string }, b: { name: string }): number {
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

/**
 * Shape the two months of aggregates into ranked `ReviewFacts`. All numbers are
 * rounded to cents before they enter the facts, so the model never sees
 * `40.000000004`. Rankings use absolute euro change (not percentage — a 300%
 * jump on €4 is noise) with a category-name tie-break so identical inputs always
 * yield an identical order and an identical `topInsight` lead.
 */
export function buildReviewFacts(
  inputs: ReviewInputs,
  opts: { maxMovers: number; maxBudgetNotes: number }
): ReviewFacts {
  const {
    currentSpend,
    priorSpend,
    currentTotals,
    budgets,
    categoryNames,
    periodLabel,
  } = inputs;

  const nameFor = (id: string | null): string =>
    id === null ? UNCATEGORIZED.name : categoryNames.get(id) ?? UNCATEGORIZED.name;

  // ---- Movers: join current vs prior by id, floor, then rank by euro change ----
  const ids = new Set<string | null>([
    ...currentSpend.keys(),
    ...priorSpend.keys(),
  ]);
  const movers: ReviewMover[] = [];
  for (const id of ids) {
    const current = round2(currentSpend.get(id) ?? 0);
    const previous = round2(priorSpend.get(id) ?? 0);
    const change = current - previous;
    // D8: drop practically-insignificant swings BEFORE ranking (€2 → €4 is noise).
    if (Math.abs(change) < REVIEW_MIN_MOVER_DELTA) continue;
    if (previous > 0) {
      movers.push({
        name: nameFor(id),
        current,
        previous,
        deltaPct: (current - previous) / previous,
        direction: change >= 0 ? "up" : "down",
      });
    } else {
      // previous == 0 → new spend this month (never a divide-by-zero).
      movers.push({
        name: nameFor(id),
        current,
        previous,
        deltaPct: null,
        direction: "new",
      });
    }
  }
  movers.sort((a, b) => {
    const d = Math.abs(b.current - b.previous) - Math.abs(a.current - a.previous);
    return d !== 0 ? d : byName(a, b);
  });
  const topMovers = movers.slice(0, opts.maxMovers);

  // ---- Budget notes: over-budget first, then under closest to the limit ----
  const budgetNotes: ReviewBudgetNote[] = budgets.map((b) => {
    const eff = round2(effectiveLimit(b.limit, b.carriedAmount));
    const spent = round2(b.spent);
    return {
      name: b.category.name,
      spent,
      effectiveLimit: eff,
      remaining: round2(eff - spent),
      status: spent > eff ? "over" : "under",
    };
  });
  budgetNotes.sort((a, b) => {
    // Over-budget first; within each group the most negative remaining leads
    // (largest overspend for `over`, closest-to-limit for `under`).
    if (a.status !== b.status) return a.status === "over" ? -1 : 1;
    const d = a.remaining - b.remaining;
    return d !== 0 ? d : byName(a, b);
  });
  const topBudgetNotes = budgetNotes.slice(0, opts.maxBudgetNotes);

  // ---- Cashflow ----
  const totalIncome = round2(currentTotals.income);
  const totalExpenses = round2(currentTotals.expenses);
  const netCashflow = round2(totalIncome - totalExpenses);

  // ---- Top insight (D7): over-budget > largest mover > material cashflow ----
  let topInsight: ReviewTopInsight | null = null;
  const largestOver = topBudgetNotes.find((n) => n.status === "over");
  if (largestOver) {
    topInsight = { kind: "budget", ref: largestOver.name };
  } else if (topMovers.length > 0) {
    topInsight = { kind: "mover", ref: topMovers[0].name };
  } else if (Math.abs(netCashflow) >= REVIEW_MIN_MOVER_DELTA) {
    topInsight = { kind: "cashflow", ref: "cashflow" };
  }

  return {
    periodLabel,
    netCashflow,
    totalIncome,
    totalExpenses,
    topInsight,
    movers: topMovers,
    budgetNotes: topBudgetNotes,
  };
}

/**
 * Is there anything worth narrating? True when there is spend this month AND at
 * least one mover, budget note, or non-trivial cashflow. The action throws
 * `AiNoMatchError` when false, so the sparse-month path is one tested rule rather
 * than scattered guards (spec §3 / §4.2).
 */
export function hasReviewSignal(facts: ReviewFacts): boolean {
  return (
    facts.totalExpenses > 0 &&
    (facts.movers.length > 0 ||
      facts.budgetNotes.length > 0 ||
      Math.abs(facts.netCashflow) >= REVIEW_MIN_MOVER_DELTA)
  );
}
