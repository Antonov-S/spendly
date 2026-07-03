# Smart Budget Suggestions (Pro, AI) — Implementation Spec

> **Status: Not started.** This spec implements [POST-MVP-ROADMAP.md](../POST-MVP-ROADMAP.md) §6
> (Delivery Sequence **slot 11**) — the last of the four committed AI capabilities before the
> **Pro Value Review checkpoint**. It is sliced independently from §5 (Monthly Review Narrative)
> so each ships and is measured on its own.
>
> **Reuses, unchanged, the §3 AI foundation** (`feature/ai-auto-categorization`,
> [ai-auto-categorization-spec.md](ai-auto-categorization-spec.md)): the lazy OpenAI client
> (`src/lib/ai/client.ts`), the `aiJsonRespond` Responses-API wrapper (`src/lib/ai/respond.ts`), the
> `runAiFeature` orchestrator (`src/lib/ai/run.ts` — auth → DB Pro gate → rate/cap → timeout →
> telemetry → fail-open), the `getAiProfile` Pro read (`src/lib/db/ai.ts`), the `track()` telemetry
> shim, the `AiParseError`/`AiNoMatchError` sentinels, and the `--color-ai` accent. Like §4 and §5,
> **this slice adds only a prompt + parse step + a data-shaping step + a UI panel** — the seam §3
> left open (its D6). No new client, orchestrator, Pro read, rate policy, telemetry sink, color,
> schema, or migration.

> **Goal:** On `/budgets`, a **Pro** user taps **"Suggest budgets"** and gets per-category budget
> amounts derived from their own spending history — *"Groceries: €220 (you spent €180, €240 and
> €210 over the last three months)"* — each rendered as a **pre-filled, editable, one-tap-accept
> row**. Accepting a row creates the budget through the existing `createBudget` action; nothing is
> ever written by the AI. Free users see nothing (they keep "Use starter budgets") and no AI call
> is made.

---

## 1. Why this slice

Budgets are the control layer, but a new (or lapsed) budgeter faces a cold-start question the app
currently answers only with the fixed `BUDGET_PRESETS` amounts: *"what's a realistic ceiling for
me?"* The user's own ledger already knows. Turning three months of split-aware category spend into
a suggested ceiling removes the "pick a number from thin air" hesitation while keeping every
decision with the user — the same suggest-and-confirm stance as §3/§4, applied to the budgeting
core instead of capture.

**The load-bearing decision (D1): amounts are 100% deterministic; the model only phrases.** This
resolves the roadmap's open decision ("statistical baseline with AI only for phrasing/outliers vs.
fully model-driven") in favor of the baseline — the same stance §5 proved with `buildReviewFacts` +
`validateReviewNumbers`. A pure, unit-tested `buildBudgetSuggestionFacts` computes every suggested
amount from history; the model receives those facts and returns only short rationale sentences,
which a numeric guard verifies against the facts. A hallucinated euro amount can never become a
suggested ceiling, because the ceiling never comes from the model.

A direct consequence worth stating plainly: **the statistics don't need the model.** The AI's
contribution is the rationale prose (why this number, whether a month was a one-off spike). So this
feature's fail-open is one level *softer* than §5's (D5): if phrasing fails, the user still gets
the deterministic suggestions with fallback copy — stats without prose — rather than nothing.

---

## 2. Scope

### In scope

- **`suggestBudgets` server action** (`src/actions/ai/suggest-budgets.ts`) — a thin wrapper over
  `runAiFeature` that (a) fetches the trailing months' category spend + the target period's active
  budgets, (b) shapes them into deterministic `BudgetSuggestionFacts`, (c) asks the model to phrase
  a one-line rationale per suggestion, and (d) returns a `BudgetSuggestions` object. **Never
  writes.**
- **Deterministic fact builder** (`src/lib/budget-suggest.ts`) — pure
  `buildBudgetSuggestionFacts(...)`: per-category monthly spend over the lookback window →
  suggested amount = **median of the months with spend, rounded up to a friendly step** (D2), with
  eligibility floors (D8), a deterministic spike flag, stable ranking + tie-breaks (D7), and a pure
  `hasSuggestSignal` predicate. Unit-testable with **no** Prisma or SDK mock.
- **Data fetcher** (`src/lib/db/budget-suggest.ts`) — `getBudgetSuggestInputs(userId, month, year)`:
  one server-only fetcher assembling per-month split-aware spend (reusing `getCategorySpend`, one
  call per lookback month), the target period's active budget category ids (to exclude), and a
  name/icon/color lookup for the category ids that appear (no N+1).
- **Versioned prompt** (`src/lib/ai/prompts/budget-suggest.ts`) — `SUGGEST_INSTRUCTIONS`,
  `buildSuggestInput`, `BUDGET_SUGGEST_PROMPT_VERSION` (start at `1`) + changelog, mirroring
  `prompts/review.ts`.
- **Pure parse + numeric guard** (`src/lib/ai/budget-suggest.ts`) — `parseSuggestionNotes(raw)`
  (defensive JSON parse → `Map<categoryName, note>`; unmatched names dropped, never invented) and
  `validateSuggestionNotes(notes, facts)` (drops any note whose numbers aren't in the facts). Both
  built on a **shared numeric-guard core extracted from `src/lib/ai/review.ts`** (§5.4) — the one
  behavior-preserving refactor of existing AI code in this slice.
- **UI panel** (`src/components/budgets/budget-suggestions.tsx`) — a Pro-only, AI-accented section
  on `/budgets` (above the list / empty state) with a Sparkles **"Suggest budgets"** button. On
  result: one row per suggestion — category chip, **editable amount input pre-filled** with the
  suggested value, rationale line, per-row **Add** button — plus **Add all**. Accepting calls the
  existing `createBudget`.
- **Outcome telemetry** (`src/actions/ai/track-budget-outcome.ts`) — emits
  `ai_budget_suggest_accepted { prompt_version, edited }` per accepted row and
  `ai_budget_suggest_dismissed { prompt_version, suggested_count, accepted_count }` on explicit
  panel dismissal (mirrors §4's `trackParseOutcome`; flags/counts only, no amounts).
- **Validation** — `suggestBudgetsSchema` added to `src/lib/validations/ai.ts`.
- **Vitest** — unit tests for the fact builder, parse + guard helpers, and the wired action. Mock
  OpenAI + orchestrator deps at the module boundary; no live calls.

### Out of scope

- **An onboarding surface.** The roadmap floats "budgets empty state, onboarding step 2, or both" —
  but at onboarding the user has, by definition, **no transaction history to suggest from** (unless
  they imported first). Deferred as an extension point (§12) until import-first onboarding proves
  common; v1 keeps onboarding's `seedPresetBudgets` untouched. This resolves the roadmap's surface
  question (D3).
- **Multi-period suggestions / "budget plan" generation** — v1 suggests for the **viewed** period
  only (D9).
- **A suggested `rollover` value** — suggestions always create with `rollover: false` (D10); the
  toggle stays a per-budget edit.
- **Adjusting *existing* budgets** ("your Dining budget looks too low") — a different, riskier
  feature (it critiques choices rather than filling a blank); recorded as an extension point (§12).
- **Persisting suggestions** — results live in component state for the session, like §5 (no table).
- **Any new write path, rate-limit policy, Pro-gate read, client, color, or telemetry sink.** All
  reused from §3. **No schema change. No migration. No new `RATE_LIMITS` entry** (§5.3 pattern).

---

## 3. The suggestions contract

`src/actions/ai/suggest-budgets.ts`:

```ts
/** AI-assisted budget proposals. Read-only — accepting goes through createBudget. */
export interface BudgetSuggestions {
  /** Target period the suggestions are for, e.g. "July 2026". */
  periodLabel: string;
  suggestions: BudgetSuggestion[];
  /** False when the model's rationale phrasing failed and fallback copy is used (D5). */
  aiNotes: boolean;
  promptVersion: number;
}

export interface BudgetSuggestion {
  categoryId: string;
  name: string;
  icon: string;   // Lucide name, resolved client-side like BudgetListRow
  color: string;
  /** Deterministic suggested ceiling (D1/D2) — never model-produced. */
  suggestedAmount: number;
  /** One short rationale sentence (model-phrased + numeric-guarded, or fallback). */
  note: string;
}

// Reuses the shared AiResult<T> from runAiFeature.
export type SuggestBudgetsResult = AiResult<BudgetSuggestions>;

export async function suggestBudgets(input: {
  month: number; // the period currently viewed on /budgets
  year: number;
}): Promise<SuggestBudgetsResult>;
```

**"Something to suggest" is the hard requirement.** When the fact builder yields zero eligible
suggestions (no history clearing the floors, or every historical category already has an active
budget this period), the `run` step throws `AiNoMatchError` → `reason: "no_match"` → the panel
shows a quiet "Not enough spending history yet to suggest budgets." — mirroring §4's
amount-required and §5's `hasReviewSignal` contracts. A phrasing failure is **not** a `no_match`;
it degrades per D5.

Budgets are **not account-scoped** (a budget covers a category across all accounts, exactly as
`getBudgets` computes spend), so unlike §5 the action takes no `accountId` — spend history is
aggregated across all accounts, matching what the resulting budget will measure.

---

## 4. Deterministic facts — the load-bearing layer

### 4.1 Data fetch — `src/lib/db/budget-suggest.ts`

```ts
import "server-only";
// getBudgetSuggestInputs assembles, for a target (month, year):
//   - monthlySpend: Map<categoryId, number>[] — one split-aware getCategorySpend
//       per lookback month (oldest → newest), windows from monthBounds()
//   - budgetedCategoryIds: Set<string> — the target period's ACTIVE budgets
//       (archived slots are suggestible again, matching getBudgetFormData)
//   - categories: Map<categoryId, { name, icon, color }> for ids that appear
export async function getBudgetSuggestInputs(
  userId: string,
  month: number,
  year: number
): Promise<BudgetSuggestInputs>;
```

Windows come from the existing period helpers: walk `previousPeriod()` back
`BUDGET_SUGGEST_LOOKBACK_MONTHS` times from the target period and take `monthBounds()` for each —
so the lookback is the N **complete calendar months immediately before the viewed period**, and a
partial in-progress month is never counted as a low month (D9). Per-month figures are required
(the rationale cites them and the spike flag needs them), so this is one `getCategorySpend` call
per lookback month — 3 cheap indexed `groupBy` pairs, same shape `resolveRolloverCarry` already
runs per walked month.

The `null` (uncategorized) key from `getCategorySpend` is **discarded** — a budget requires a
category, so uncategorized spend can never be suggested (documented, tested).

### 4.2 Fact shaping — `src/lib/budget-suggest.ts` (pure)

`buildBudgetSuggestionFacts(inputs, { max }): BudgetSuggestionFacts` produces a compact, ranked,
**already-numeric** structure the model only has to phrase:

```ts
export interface BudgetSuggestionFacts {
  periodLabel: string;              // "July 2026"
  /** Derived from monthly.length — the fact builder is window-agnostic (D12). */
  lookbackMonths: number;
  suggestions: {
    categoryId: string;
    name: string;
    monthly: number[];              // per lookback month, oldest → newest (0 = no spend)
    monthsWithSpend: number;
    median: number;                 // of the months WITH spend
    average: number;                // of the months WITH spend (rationale color)
    suggestedAmount: number;        // roundUpToStep(median) — adaptive step (D2)
    spike: boolean;                 // max month > SPIKE_RATIO × median (deterministic)
    /** Deterministic confidence indicator (D11) — spread of months-with-spend. */
    variability: "consistent" | "variable";
  }[];
}
```

Rules (all deterministic, all unit-tested):

- **Eligibility floors (D8)** — a category is suggestible only if it has spend in at least
  `BUDGET_SUGGEST_MIN_MONTHS_WITH_SPEND` (default **2**) of the lookback months **and** its median
  clears `BUDGET_SUGGEST_MIN_MEDIAN` (default **€10**). One-off purchases and noise categories
  (€3 once in May) never become budget proposals.
- **Exclusions** — categories with an **active** budget in the target period are skipped (the
  archived-slot rule intentionally matches `getBudgetFormData`, so a suggestion for an archived
  slot revives it via `createBudget`'s existing upsert). Uncategorized (`null`) is skipped.
  `getCategorySpend` is EXPENSE-only, so income categories never appear.
- **Suggested amount (D2)** — **median of the months with spend**, rounded **up** to an
  **adaptive step** via a pure `roundUpToStep(median)`: the step scales with the magnitude so
  values look natural at every size (a €740 rent suggestion rounded to €5 reads like false
  precision). Tiers from `BUDGET_SUGGEST_ROUND_STEPS` (system-constants): median **< €100 → €5**,
  **€100–€500 → €10**, **> €500 → €25**. Median (not mean) so a single spike month doesn't inflate
  the ceiling; round **up** so the proposed budget starts with headroom rather than being instantly
  98% consumed (a budget you blow on day one is discouraging, not clarifying). Result is clamped to
  `BUDGET_AMOUNT_MAX` (shared with the manual form).
- **Spike flag** — `max(monthly) > BUDGET_SUGGEST_SPIKE_RATIO × median` (default **1.5**). Purely
  informational: it tells the *prompt* to phrase "one month was unusually high — the suggestion
  ignores the spike"; it never changes the math (the median already resisted it).
- **Variability indicator (D11)** — a deterministic confidence signal per suggestion:
  `variability = "variable"` when the relative spread of the months **with spend**,
  `(max − min) / median`, is ≥ `BUDGET_SUGGEST_VARIABILITY_RATIO` (default **0.5**); else
  `"consistent"`. Like the spike flag it is **purely informational** — it never changes the
  amount — but it calibrates trust: the UI renders it as a small chip ("Consistent spending" /
  "Varies month to month") and the prompt phrases it, so the user knows whether the median stands
  on steady ground or a wide range. Distinct from `spike` (one outlier month) vs. overall spread.
- **Ranking + tie-breaks (D7)** — rank by **average spend descending** (the categories where a
  ceiling matters most come first), cap at `max` (default `BUDGET_SUGGEST_MAX = 8`), stable
  secondary key of **category name ascending** (case-insensitive). Identical inputs always yield
  identical suggestions in identical order — the §5 determinism discipline.
- **`hasSuggestSignal(facts)`** — true iff `suggestions.length > 0`; drives the action's
  `no_match` (§3) so the sparse-history path is one tested rule.

Amounts are rounded via the shared `round2` (`src/lib/money.ts`) before entering the facts.

> **Window-agnostic core (D12).** `buildBudgetSuggestionFacts` never hardcodes the lookback: it
> derives `lookbackMonths` from `monthly.length`, and every rule (floors, median, spike,
> variability, ranking) operates on whatever month array it is handed. Optional
> `opts.weights?: number[]` is reserved in the signature (uniform when omitted; a weighted-median
> path is **not** implemented in v1) so a longer or seasonally weighted window is purely a
> **fetcher + constants change** — the `BudgetSuggestionFacts` shape, the prompt, the numeric
> guard, and the UI contract all stay fixed. `BUDGET_SUGGEST_LOOKBACK_MONTHS` is consumed only at
> the `getBudgetSuggestInputs` call site.

---

## 5. Control flow, prompt, and rate limiting

### 5.1 Control flow — thin over `runAiFeature`

```ts
return runAiFeature({
  feature: "budget_suggest",
  promptVersion: BUDGET_SUGGEST_PROMPT_VERSION,
  burstLimit: "aiSuggest", // shared POLICY (20/h), own BUCKET — key `budget_suggest:${userId}`
  failOpenMessage: "Couldn't suggest budgets right now.",
  run: async ({ userId, signal }) => {
    const inputs = await getBudgetSuggestInputs(userId, month, year);
    const facts = buildBudgetSuggestionFacts(inputs, { max: BUDGET_SUGGEST_MAX });
    if (!hasSuggestSignal(facts)) {
      throw new AiNoMatchError("Not enough spending history.");
    }

    // D5 — inner graceful degradation: the amounts don't need the model, so a
    // phrasing failure must not sink the suggestions. Only the AI call is
    // guarded; fetcher/fact errors above still propagate (→ ai_error, fail-open).
    let notes = new Map<string, string>();
    let aiNotes = false;
    try {
      const raw = await aiJsonRespond({
        instructions: SUGGEST_INSTRUCTIONS,
        input: buildSuggestInput(facts), // facts as JSON — satisfies the "json" guardrail
        signal,
      });
      const parsed = parseSuggestionNotes(raw, facts);       // Map by categoryId
      notes = validateSuggestionNotes(parsed, facts);        // numeric guard (§5.4)
      aiNotes = notes.size > 0;
      const dropped = parsed.size - notes.size;
      if (dropped > 0) {
        await track("ai_numeric_guard", {
          feature: "budget_suggest",
          prompt_version: BUDGET_SUGGEST_PROMPT_VERSION,
          dropped_count: dropped,
          kept_count: notes.size,
        });
      }
    } catch (error) {
      // Degrade to deterministic fallback copy — stats without prose.
      await track("ai_phrasing_degraded", {
        feature: "budget_suggest",
        prompt_version: BUDGET_SUGGEST_PROMPT_VERSION,
        reason: reasonLabelForThrow(error), // "parse_failed" | "timeout" | "ai_error"
      });
    }

    return toBudgetSuggestions(facts, notes, inputs.categories, aiNotes);
  },
});
```

`toBudgetSuggestions` (pure, in `src/lib/budget-suggest.ts`) merges facts + notes + category
lookup into the §3 contract shape, substituting the deterministic fallback note — *"Median of your
last 3 months of Groceries spending."* — for any suggestion whose model note was missing or
guard-dropped. The panel renders identically either way; `aiNotes: false` just switches the caption
(§6).

Everything outside `run` — auth, the **DB-driven** Pro gate, the shared `aiMonthly` COGS cap + the
per-feature burst cap, the timeout, the single `ai_result`, and outer fail-open — is the
orchestrator's, unchanged.

> **D5 telemetry honesty note.** With inner degradation, the orchestrator's `ai_result` reads
> `outcome: "ok"` even when the model call failed — correct from the user's perspective (they got
> a usable result) but blind for prompt tuning. The `ai_phrasing_degraded` event (counts + reason
> only, no PII) restores that visibility: `degraded / (ok results)` is this feature's real AI
> health metric. This is a deliberate, documented deviation from §5, where the narrative *was* the
> AI output and a phrasing failure had nothing left to show.

### 5.2 Prompt — `src/lib/ai/prompts/budget-suggest.ts`

Versioned + changelogged, mirroring `prompts/review.ts`. Strict about **using only the provided
numbers** and about what the model is *not* deciding:

```ts
/** Changelog: v1 — initial: one short rationale sentence per suggested budget;
 *  never invent, recompute, or second-guess the suggested amounts. */
export const BUDGET_SUGGEST_PROMPT_VERSION = 1;

export const SUGGEST_INSTRUCTIONS = [
  "You write one-line rationales for suggested category budgets in a personal-finance app.",
  "You are given pre-computed facts as JSON. The suggested amounts are FINAL — never propose a different amount, and use ONLY the provided numbers.",
  'Respond as JSON: { "notes": [ { "categoryId": "...", "note": "one short sentence" } ] } with exactly one entry per suggestion.',
  "Each note should ground the amount in the monthly figures (e.g. \"You spent €180, €240 and €210 — €220 covers a typical month\").",
  "If `spike` is true, mention that one month was unusually high and that the suggestion ignores the spike.",
  "If `variability` is \"variable\", acknowledge that spending swings month to month; if \"consistent\", you may note the pattern is steady. Never contradict the flag.",
  "Amounts are euros; keep the euro sign. Be concise and neutral — inform, don't advise or moralize.",
].join(" ");

export function buildSuggestInput(facts: BudgetSuggestionFacts): string {
  return JSON.stringify(facts); // the literal word "json" satisfies the json_object guardrail
}
```

`parseSuggestionNotes(raw, facts)` (in `src/lib/ai/budget-suggest.ts`) is defensive: `JSON.parse`
(→ `AiParseError`), accept `notes` as an array of `{ categoryId, note }` (tolerate a `name` key by
matching case-insensitively against the facts), coerce notes to trimmed non-empty strings, drop
over-long lines (`BUDGET_SUGGEST_NOTE_MAX` module cap), **drop any entry whose category isn't in
the facts** (the model can never add a suggestion), and return a `Map<categoryId, string>`. A
missing note for a suggestion is fine — that row gets the fallback (D5).

### 5.3 Rate limiting — reuse `aiSuggest`, no new entry

`burstLimit: "aiSuggest"` + `feature: "budget_suggest"` gives this feature its **own** hourly
bucket (key `budget_suggest:${userId}`) under the shared 20/h policy, while the global `aiMonthly`
COGS ceiling applies as always. One suggestion run is compact facts in, ≤8 one-liners out — a few
hundred tokens on `gpt-5-nano`. **No `RATE_LIMITS` change.**

### 5.4 Numeric guard — extract the shared core from `review.ts`

§5 built the exact machinery this feature needs — token normalization (strip `€`/spaces/thousands
separators, unify decimal separator), the allowed-number set, and the epsilon matching
(`NUMERIC_GUARD_MONEY_EPSILON = 0.01`, `NUMERIC_GUARD_PCT_EPSILON = 1`) — but it lives inside
`validateReviewNumbers`. This slice performs the **one refactor of existing AI code**:

- Extract the generic core to `src/lib/ai/numeric-guard.ts`:
  `lineNumbersAllowed(line, allowed: { amounts: number[]; percents: number[] }): boolean`
  (+ the two epsilon constants and the normalizer, moved verbatim).
- `validateReviewNumbers` (`review.ts`) becomes a thin caller building its facts-specific allowed
  set — **behavior-preserving**, verified by the existing `test/lib/ai/review.test.ts` suite
  passing untouched.
- New `validateSuggestionNotes(notes, facts)` builds its allowed set per note's category —
  `monthly[]`, `median`, `average`, `suggestedAmount` (both signed and absolute, per the §5
  precedent) — plus the global `lookbackMonths` as a bare small integer (so "last 3 months"
  passes), and drops any note whose numbers aren't allowed. Dropped notes fall back per D5; there
  is no all-dropped throw here (unlike §5) because the deterministic result stands on its own.

### 5.5 Responses-API gotchas (carried, still load-bearing)

Same `aiJsonRespond` wrapper, so the §3 "CRITICAL" rules hold unchanged: Responses API (not Chat
Completions — `gpt-5-nano` returns empty content there), `json_object` with manual parse, the
literal word "json" present in the input (it is, via the serialized facts), `AI_REASONING_EFFORT`
already tuned. All encapsulated in `respond.ts`.

---

## 6. UI integration — the `/budgets` suggestions panel

`/budgets` (`budgets-view.tsx` + `budget-empty-state.tsx`) is the single surface (D3). The page
fetches `isPro` once via `getAiProfile(userId)` folded into the existing `Promise.all`, threads it
to `BudgetsView`, which renders `<BudgetSuggestions>` for Pro users **above** the list / empty
state (the empty state itself is untouched — "Use starter budgets" remains the free path and the
Free-user path):

- **Collapsed (initial)** — a slim AI-accented band (`border-ai/25`, Sparkles icon square, matching
  the §5 card): "Budget suggestions" + "Based on your last 3 months of spending — generated
  amounts, you confirm each one." + a **"Suggest budgets"** button (`text-ai`, `hover:bg-ai/10`).
  `useTransition` drives a "Analyzing your spending…" disabled state.
- **On result** — one row per suggestion: category icon square (resolved via the existing
  `icon-map`) + name, a small **variability chip** (D11 — neutral `text-ink-2` "Consistent
  spending" / amber-toned "Varies month to month"; deterministic, so it renders identically in the
  D5 degraded state), the rationale `note` as the meta line, an **editable amount input pre-filled
  with `suggestedAmount`** (the confirm moment made literal — the user can tweak before accepting),
  and a per-row **Add** button. Below the rows: **"Add all"**, a **"Dismiss"** control (§7 — hides
  the results and returns the panel to its collapsed state), and a caption — `aiNotes: true` →
  "AI-phrased — amounts computed from your data."; `aiNotes: false` → "Computed from your data."
  (the D5 degraded state, visibly honest, never blocking).
- **Accept (per row)** — calls the existing `createBudget({ categoryId, amount, month, year,
  rollover: false })` (D4/D10) inside `useTransition`; on success the row leaves the local list, a
  Sonner toast confirms, `router.refresh()` re-renders the real list (the same pattern as
  `BudgetEmptyState`'s seed flow). Then fire-and-forget `trackBudgetAccepted({ promptVersion,
  edited: amount !== suggestedAmount })`. A `DUPLICATE_ERROR` from a race is surfaced as the
  action's friendly message — no special handling.
- **Add all** — iterates the remaining rows through the same `createBudget` sequentially
  (≤ `BUDGET_SUGGEST_MAX = 8` calls; no bulk writer is added — the sole-writer rule outweighs the
  round-trips), toasting one summary ("Added 5 budgets").
- **Period awareness** — the panel receives the viewed `period` prop (like `BudgetEmptyState`);
  stepping the period **clears** any shown suggestions (they were computed for another month) —
  the stale-scope rule from §5, implemented with the same monotonic-token guard (`suggestRunRef`)
  so a slow result can't land on a different period.
- **Errors (fail-open, never block budgeting)** — driven off the result `reason`: `no_match` →
  "Not enough spending history yet to suggest budgets."; `rate_limited` → "You've hit the hourly
  limit — try again shortly."; anything else → "Couldn't suggest budgets right now." The manual
  "New budget" flow and starter presets are always available regardless.

**Decisions (decisions over options):**

- **D1 — Deterministic amounts; the model only phrases rationale.** Resolves the roadmap's
  baseline-vs-model question. Every suggested ceiling comes from `buildBudgetSuggestionFacts`; the
  prompt is told the amounts are final; the numeric guard enforces faithful prose. A finance app
  must never let a model invent a number the user might adopt.
- **D2 — Median of months-with-spend, rounded up to an adaptive step (€5 / €10 / €25 by
  magnitude).** Median resists one-off spikes; rounding *up* gives headroom so a fresh budget
  doesn't open at 98% consumed; the step scales with the amount (`BUDGET_SUGGEST_ROUND_STEPS`) so
  large suggestions don't read as false precision.
- **D3 — One surface: `/budgets`, empty and non-empty alike; onboarding deferred.** At onboarding
  there is no history to compute from — the surface would be a dead button. The single panel
  serves both the cold start (empty state) and the "budget more categories" case.
- **D4 — Accept goes through `createBudget`, per row, amount editable first.** No new write path;
  the AI returns a proposal object and the existing upsert (with its archived-slot revival and
  duplicate handling) does all writing. Editing before accepting *is* the conscious-engagement
  moment.
- **D5 — Phrasing failure degrades to stats-with-fallback-copy, not to nothing.** The deterministic
  layer is independently useful; only the prose is at risk. Softer than §5's fail-open by design,
  with `ai_phrasing_degraded` keeping the failure measurable.
- **D6 — Foundation reuse = "prompt + parse + facts step only."** Third proof of §3's D6 (after
  §4 and §5). The one existing-code touch is the behavior-preserving numeric-guard extraction
  (§5.4).
- **D7 — Fully deterministic output.** Ranking by average spend desc, name-ascending tie-break,
  fixed caps — identical history always yields identical suggestions, so regenerating is legible.
- **D8 — Eligibility floors.** ≥2 of 3 lookback months with spend and a ≥€10 median keep one-off
  purchases and noise categories out of the proposal list.
- **D9 — Target the viewed period; lookback = the complete months before it.** The in-progress
  month is never counted as a deceptively low month; navigating periods re-anchors both target and
  lookback.
- **D10 — `rollover: false`, currency stamped server-side.** Suggestions opt into nothing; the
  rollover toggle remains a deliberate per-budget choice, and `createBudget` already stamps
  `DEFAULT_CURRENCY`.
- **D11 — Deterministic variability indicator.** Each suggestion carries a computed
  `"consistent" | "variable"` confidence signal (relative spread vs.
  `BUDGET_SUGGEST_VARIABILITY_RATIO`), shown as a chip and phrased by the model. It calibrates how
  much to trust the number without ever changing it — and being deterministic, it survives the D5
  degraded state intact.
- **D12 — Window-agnostic fact builder.** `lookbackMonths` is derived from the input array; all
  rules operate on N months and a `weights` seam is reserved in the signature. Longer or
  seasonally weighted lookbacks are a fetcher/constants experiment later — the facts shape, prompt,
  guard, and UI contract never move.

---

## 7. Telemetry

- `runAiFeature` emits the standing **one `ai_result` per generation** (`feature:
  "budget_suggest"`, `prompt_version`, `outcome`, `reason`) — run counts + failure breakdown for
  free.
- **`ai_budget_suggest_accepted { prompt_version, edited }`** — per accepted row, via the thin
  `trackBudgetAccepted` action (fire-and-forget from the panel, exactly the §4 outcome pattern).
  `edited` is a boolean (the amount was changed before accept); **no amounts, no category names —
  the shim's no-PII contract.** This is the roadmap's headline metric: **acceptance rate =
  accepted rows / suggested rows**, and `edited` distinguishes "accepted as-is" from "used as a
  starting point".
- **`ai_budget_suggest_dismissed { prompt_version, suggested_count, accepted_count }`** — fired
  when the user presses the explicit **Dismiss** control on a rendered result set (counts only, no
  amounts/names). This separates two failure stories the acceptance rate alone conflates: a low
  acceptance rate **with** frequent explicit dismissals means the *suggestions* are poor (wrong
  amounts/categories — iterate the formula or floors); low acceptance with few dismissals and few
  generations means *engagement* is low (surface/placement problem). Navigating away is **not** a
  dismissal — only the explicit control emits, keeping the signal clean.
- **`ai_numeric_guard { feature, prompt_version, dropped_count, kept_count }`** — reusing the §5
  event name — fires only when the guard drops ≥1 note.
- **`ai_phrasing_degraded { feature, prompt_version, reason }`** — fires only on the D5 inner
  degradation; the real AI-health signal given `ai_result` stays "ok" in that path (§5.1 note).

**Committed thresholds (per the roadmap's rubric — sign off in §11):** measure over a stable
window at the Pro Value Review; **expand ≥ ~60%** row-acceptance (as-is + edited), **iterate
~30–60%**, **retire < ~30%** or a negative cost/UX read after one prompt iteration.

---

## 8. Files

**New — feature**
- `src/actions/ai/suggest-budgets.ts` — thin `suggestBudgets` over `runAiFeature` (D5 inner
  degradation lives here). `BudgetSuggestions`/`BudgetSuggestion` types are declared in
  `src/lib/budget-suggest.ts` and imported — **never** `export type` from the `"use server"` file
  (Turbopack constraint).
- `src/actions/ai/track-budget-outcome.ts` — `trackBudgetAccepted` + `trackBudgetDismissed`
  outcome telemetry.
- `src/lib/budget-suggest.ts` — pure `buildBudgetSuggestionFacts` + `roundUpToStep` +
  `hasSuggestSignal` + `toBudgetSuggestions` + the fact/contract types.
- `src/lib/db/budget-suggest.ts` — `getBudgetSuggestInputs(userId, month, year)` (server-only;
  reuses `getCategorySpend`, `previousPeriod`, `monthBounds`).
- `src/lib/ai/prompts/budget-suggest.ts` — `SUGGEST_INSTRUCTIONS`, `buildSuggestInput`,
  `BUDGET_SUGGEST_PROMPT_VERSION` + changelog.
- `src/lib/ai/budget-suggest.ts` — pure `parseSuggestionNotes` + `validateSuggestionNotes`.
- `src/lib/ai/numeric-guard.ts` — the shared guard core extracted from `review.ts` (§5.4).
- `src/components/budgets/budget-suggestions.tsx` — the Pro-only panel (`"use client"`).

**New — tests**
- `test/lib/budget-suggest.test.ts` — fact builder: median + adaptive `roundUpToStep` (each tier
  boundary: €87 median → €90, €212 → €220, €740 → €750; exact-multiple stays put), floors
  (1-of-3-months dropped; €8-median dropped), spike flag, variability flag (steady months →
  `consistent`; wide spread → `variable`; boundary at the ratio), active-budget + uncategorized
  exclusion, archived-slot inclusion, ranking + name tie-break, determinism (same inputs →
  identical output), **window-agnosticism** (a 6-month input array yields `lookbackMonths: 6` with
  all rules applied — the D12 seam), `hasSuggestSignal`, `toBudgetSuggestions` fallback-note
  substitution.
- `test/lib/ai/budget-suggest.test.ts` — parse (well-formed, `name`-keyed tolerance, unknown
  category dropped, over-long note dropped, bad JSON → `AiParseError`) + guard (faithful note kept,
  misquoted euro figure dropped, formatting tolerance, no-number note passes).
- `test/lib/ai/numeric-guard.test.ts` — the extracted core (normalization + epsilons), plus the
  untouched `review.test.ts` suite proving the refactor is behavior-preserving.
- `test/actions/ai/suggest-budgets.test.ts` — happy path (facts → prompt → notes merged); sparse
  history → `no_match`; **AI throw → `success: true` with fallback notes + `ai_phrasing_degraded`
  emitted** (the D5 contract); numeric-guard drop → `ai_numeric_guard` emitted; asserts
  `feature`/`burstLimit`/`promptVersion` passed to `runAiFeature`. Mock OpenAI + orchestrator deps
  at the module boundary.

**Modified**
- `src/lib/system-constants.ts` — `BUDGET_SUGGEST_LOOKBACK_MONTHS = 3`,
  `BUDGET_SUGGEST_MIN_MONTHS_WITH_SPEND = 2`, `BUDGET_SUGGEST_MIN_MEDIAN = 10`,
  `BUDGET_SUGGEST_ROUND_STEPS = [{ upTo: 100, step: 5 }, { upTo: 500, step: 10 }, { upTo: Infinity, step: 25 }]`,
  `BUDGET_SUGGEST_SPIKE_RATIO = 1.5`, `BUDGET_SUGGEST_VARIABILITY_RATIO = 0.5`,
  `BUDGET_SUGGEST_MAX = 8`.
- `src/lib/validations/ai.ts` — `suggestBudgetsSchema` (`month` 1–12, `year` bounds matching
  `createBudgetSchema`).
- `src/lib/ai/review.ts` — delegate to the extracted `numeric-guard.ts` core (no behavior change).
- `src/app/budgets/page.tsx` — fetch `getAiProfile(userId)` in the existing `Promise.all`; thread
  `isPro`.
- `src/components/budgets/budgets-view.tsx` — render `<BudgetSuggestions period={…}>` above the
  list/empty state when `isPro`.
- `docs/POST-MVP-ROADMAP.md` — on ship: flip §6 + Delivery-Sequence slot 11 to shipped; the
  tracker's next entry is the **Pro Value Review checkpoint** (all four AI features shipped).
- `docs/project-overview.md` — on ship: a shipped-note under **Budgets** (additive documentation).
- `docs/features/help-faq-route-spec.md` maintenance contract → update the Budgets Help section
  with one line on Pro suggestions.

**Unchanged but reused:** `src/lib/ai/{client,respond,run,errors}.ts`, `src/lib/db/ai.ts`,
`src/lib/db/split-spend.ts` (`getCategorySpend`), `src/lib/budget-period.ts`, `src/lib/money.ts`,
`src/actions/budgets.ts` (`createBudget` — the sole writer), `src/lib/analytics/track.ts`,
`RATE_LIMITS`, `--color-ai`. **No schema change. No migration.**

---

## 9. Testing

Per [coding-standards.md](../coding-standards.md) — cover `src/actions/**` + `src/lib/**`, mock at
the module boundary, no live calls, components out of scope. The layering (orchestrator already
tested in §3 · pure facts · pure parse/guard · wired action) keeps each test isolated; the §5.4
extraction is additionally pinned by the pre-existing `review.test.ts` passing unmodified.

Gates: `npm run test:run` + `npm run build` + lint clean before commit, per
[ai-interaction.md](../ai-interaction.md). Verify live on the `development` Neon branch with the
`demo-pro` seed user (its April–June history should produce Groceries/Dining-class suggestions).

---

## 10. Cost, safety, and philosophy

- **Cost** — one run = compact facts in, ≤8 one-liners out; a fraction of a cent on `gpt-5-nano`,
  on-demand only. The shared `aiMonthly` cap is the runaway rail; well under the ~€0.20–0.30 /
  Pro user / month COGS budget.
- **Honesty (D1)** — the deterministic layer owns every number; the prompt declares the amounts
  final; the numeric guard drops misquoting prose; the caption discloses provenance. Instructed,
  enforced, and disclosed.
- **Confirm-not-auto** — nothing is written by the AI; every budget is created by the user
  pressing Add (with the amount editable first) through the pre-existing `createBudget`. The
  suggest-and-confirm contract §3 established, applied to the control layer.
- **Fail-open, twice over** — orchestrator failures degrade to the manual budget flow; a mere
  phrasing failure degrades only to deterministic copy (D5). Budgeting is never blocked by the
  model.

---

## 11. Open questions for the product owner

1. **Amount formula (D2)** — confirm median-with-adaptive-round-up (recommended) vs. trailing
   mean; the €10 minimum-median floor; and the rounding tiers (€5 under €100 / €10 to €500 / €25
   above).
2. **Surface (D3)** — confirm `/budgets`-only with onboarding deferred (recommended — onboarding
   has no history), vs. also wiring a variant into onboarding step 2 for import-first users.
3. **Add all (D4)** — keep it (recommended; still per-row `createBudget` underneath) or force
   strictly per-row acceptance for maximum deliberateness?
4. **Degradation visibility (D5)** — confirm showing stats-with-fallback-copy when phrasing fails
   (recommended) vs. failing the whole run open like §5.
5. **Acceptance threshold** — sign off ~60% / ~30–60% / <30% expand-iterate-retire on row
   acceptance (as-is + edited) for the Pro Value Review, or set your own numbers.

---

## 12. Alignment checks & extension points

**Alignment:**
- **Suggestion-only; sole writer preserved** — `suggestBudgets` returns a proposal object;
  `createBudget` performs every write with its existing validation/ownership/upsert semantics. ✅
- **Pro gate DB-driven, never JWT; fail-open on every error path.** ✅ (inherited from
  `runAiFeature`.)
- **Numbers deterministic, split-aware, drift-free** — history via the same `getCategorySpend`
  budgets themselves are measured with, so a suggested ceiling and the bar that later tracks it
  agree by construction. ✅
- **Foundation reuse = "prompt + parse + facts step only"** — third proof of §3's D6; the only
  existing-code touch is a behavior-preserving guard extraction. ✅
- **Measurable iteration** — versioned prompt; `ai_result` + acceptance + degradation + guard
  events make the expand/iterate/retire verdict computable at the checkpoint. ✅
- **Constants discipline** — all seven tuning knobs (lookback, floors, rounding tiers, spike +
  variability ratios, cap) in `system-constants.ts`; no magic numbers in components. ✅

**Extension points (intended, not built this slice):**
- **Onboarding step 2 variant** — surface suggestions during onboarding *when the user imported
  history first* (`/import` before budgets exist). Gate on §0 evidence of import-first flows.
- **Existing-budget tune-ups** — "Dining has ended over budget 3 months running — raise to €X?"
  A critique feature with different UX risk; only after the base feature clears its threshold.
- **Rollover-aware phrasing** — mention a category's habitual carry in the rationale once real
  usage shows rollover users adopt suggestions.
- **Seasonal / longer windows** — a longer lookback with month-of-year weighting (December ≠
  July). The D12 seam makes this a fetcher + constants experiment: `buildBudgetSuggestionFacts`
  already accepts N months and reserves `weights`; the facts shape, prompt, guard, and UI never
  change. Strictly evidence-gated.
