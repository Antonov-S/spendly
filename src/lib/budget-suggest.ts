/**
 * Deterministic layer of Smart Budget Suggestions (Pro AI) — the load-bearing
 * decision D1: every suggested ceiling is computed HERE, from the user's own
 * history; the model only phrases rationales (which a numeric guard verifies).
 * Pure — no Prisma, no SDK, no server-only — so every rule is unit-testable.
 *
 * The shared contract types also live here (never `export type` from the
 * `"use server"` action — Turbopack constraint).
 */

import { BUDGET_AMOUNT_MAX } from "@/lib/constants";
import { round2 } from "@/lib/money";
import {
  BUDGET_SUGGEST_MIN_MEDIAN,
  BUDGET_SUGGEST_MIN_MONTHS_WITH_SPEND,
  BUDGET_SUGGEST_ROUND_STEPS,
  BUDGET_SUGGEST_SPIKE_RATIO,
  BUDGET_SUGGEST_VARIABILITY_RATIO,
} from "@/lib/system-constants";

/** Display attributes for a suggestible category (icon = raw Lucide name). */
export interface BudgetSuggestCategory {
  name: string;
  icon: string;
  color: string;
}

/** Assembled by `getBudgetSuggestInputs` (src/lib/db/budget-suggest.ts). */
export interface BudgetSuggestInputs {
  /** Target period label, e.g. "July 2026". */
  periodLabel: string;
  /** Split-aware spend per lookback month, oldest → newest (no null key). */
  monthlySpend: Map<string, number>[];
  /** Category ids with an ACTIVE budget in the target period (excluded). */
  budgetedCategoryIds: Set<string>;
  /** Lookup for every category id appearing in `monthlySpend`. */
  categories: Map<string, BudgetSuggestCategory>;
}

export interface BudgetSuggestionFact {
  categoryId: string;
  name: string;
  /** Spend per lookback month, oldest → newest (0 = no spend). */
  monthly: number[];
  monthsWithSpend: number;
  /** Median of the months WITH spend. */
  median: number;
  /** Average of the months WITH spend (rationale color). */
  average: number;
  /** roundUpToStep(median) — deterministic, never model-produced (D1/D2). */
  suggestedAmount: number;
  /** max month > SPIKE_RATIO × median — informational only. */
  spike: boolean;
  /** Deterministic confidence indicator (D11) — spread of months-with-spend. */
  variability: "consistent" | "variable";
}

export interface BudgetSuggestionFacts {
  periodLabel: string;
  /** Derived from monthlySpend.length — the builder is window-agnostic (D12). */
  lookbackMonths: number;
  suggestions: BudgetSuggestionFact[];
}

/** AI-assisted budget proposal row. Read-only — accepting goes through createBudget. */
export interface BudgetSuggestion {
  categoryId: string;
  name: string;
  /** Lucide name, resolved client-side like BudgetListRow. */
  icon: string;
  color: string;
  /** Deterministic suggested ceiling (D1/D2) — never model-produced. */
  suggestedAmount: number;
  /** One short rationale sentence (model-phrased + numeric-guarded, or fallback). */
  note: string;
  variability: "consistent" | "variable";
}

export interface BudgetSuggestions {
  /** Target period the suggestions are for, e.g. "July 2026". */
  periodLabel: string;
  suggestions: BudgetSuggestion[];
  /** False when the model's rationale phrasing failed and fallback copy is used (D5). */
  aiNotes: boolean;
  promptVersion: number;
}

/**
 * Round a median UP to the adaptive step of the first tier it fits (D2) —
 * headroom over false precision — clamped to the manual form's ceiling. Tier
 * edges are exact multiples of both adjacent steps, so inclusivity is moot.
 */
export function roundUpToStep(median: number): number {
  const tier =
    BUDGET_SUGGEST_ROUND_STEPS.find((t) => median <= t.upTo) ??
    BUDGET_SUGGEST_ROUND_STEPS[BUDGET_SUGGEST_ROUND_STEPS.length - 1];
  const stepped = Math.ceil(round2(median) / tier.step) * tier.step;
  return Math.min(stepped, BUDGET_AMOUNT_MAX);
}

function median(sortedValues: number[]): number {
  const mid = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 1
    ? sortedValues[mid]
    : (sortedValues[mid - 1] + sortedValues[mid]) / 2;
}

/**
 * Shape per-month category spend into ranked, already-numeric suggestion facts
 * the model only has to phrase. All rules are deterministic: identical inputs
 * always yield identical suggestions in identical order (D7).
 *
 * `opts.weights` is a reserved seam (D12) for a future weighted-median window —
 * uniform when omitted; NOT implemented in v1.
 */
export function buildBudgetSuggestionFacts(
  inputs: BudgetSuggestInputs,
  opts: { max: number; weights?: number[] }
): BudgetSuggestionFacts {
  const lookbackMonths = inputs.monthlySpend.length;

  const categoryIds = new Set<string>();
  for (const monthMap of inputs.monthlySpend) {
    for (const id of monthMap.keys()) categoryIds.add(id);
  }

  const suggestions: BudgetSuggestionFact[] = [];
  for (const categoryId of categoryIds) {
    // Active budgets are excluded (archived slots stay suggestible — the
    // createBudget upsert revives them); unknown ids (e.g. the fetcher-dropped
    // uncategorized key) can't be suggested.
    if (inputs.budgetedCategoryIds.has(categoryId)) continue;
    const category = inputs.categories.get(categoryId);
    if (!category) continue;

    const monthly = inputs.monthlySpend.map((m) => round2(m.get(categoryId) ?? 0));
    const withSpend = monthly.filter((v) => v > 0);
    if (withSpend.length < BUDGET_SUGGEST_MIN_MONTHS_WITH_SPEND) continue;

    const sorted = [...withSpend].sort((a, b) => a - b);
    const med = round2(median(sorted));
    if (med < BUDGET_SUGGEST_MIN_MEDIAN) continue;

    const avg = round2(withSpend.reduce((sum, v) => sum + v, 0) / withSpend.length);
    const max = sorted[sorted.length - 1];
    const min = sorted[0];

    suggestions.push({
      categoryId,
      name: category.name,
      monthly,
      monthsWithSpend: withSpend.length,
      median: med,
      average: avg,
      suggestedAmount: roundUpToStep(med),
      spike: max > BUDGET_SUGGEST_SPIKE_RATIO * med,
      variability:
        (max - min) / med >= BUDGET_SUGGEST_VARIABILITY_RATIO
          ? "variable"
          : "consistent",
    });
  }

  // Rank where a ceiling matters most: average spend descending, stable
  // case-insensitive name tie-break, capped (D7).
  suggestions.sort(
    (a, b) =>
      b.average - a.average ||
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  );

  return {
    periodLabel: inputs.periodLabel,
    lookbackMonths,
    suggestions: suggestions.slice(0, opts.max),
  };
}

/** True iff there is anything to suggest — drives the action's `no_match` (§3). */
export function hasSuggestSignal(facts: BudgetSuggestionFacts): boolean {
  return facts.suggestions.length > 0;
}

/**
 * Merge facts + guarded notes + category lookup into the action contract.
 * A suggestion whose model note is missing or guard-dropped gets the
 * deterministic fallback — stats without prose (D5); the panel renders
 * identically either way.
 */
export function toBudgetSuggestions(
  facts: BudgetSuggestionFacts,
  notes: Map<string, string>,
  categories: Map<string, BudgetSuggestCategory>,
  aiNotes: boolean,
  promptVersion: number
): BudgetSuggestions {
  return {
    periodLabel: facts.periodLabel,
    aiNotes,
    promptVersion,
    suggestions: facts.suggestions.flatMap((s) => {
      // The builder only emits ids present in the lookup; a miss here means
      // mismatched inputs, and inventing display attributes would be worse
      // than dropping the row.
      const category = categories.get(s.categoryId);
      if (!category) return [];
      return {
        categoryId: s.categoryId,
        name: s.name,
        icon: category.icon,
        color: category.color,
        suggestedAmount: s.suggestedAmount,
        note:
          notes.get(s.categoryId) ??
          `Median of your last ${facts.lookbackMonths} months of ${s.name} spending.`,
        variability: s.variability,
      };
    }),
  };
}
