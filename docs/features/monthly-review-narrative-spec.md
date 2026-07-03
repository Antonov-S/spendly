# Monthly Review Narrative (Pro, AI) — Implementation Spec

> **Status: Not started.** This spec implements [POST-MVP-ROADMAP.md](../POST-MVP-ROADMAP.md) §5
> (Delivery Sequence **slot 10**) — the **first "insight" AI assistant** and the first AI feature that
> *reads* the ledger to explain it rather than *pre-filling* a form field. It is sliced independently
> from §6 (Smart Budget Suggestions) so each ships and is measured on its own.
>
> **Reuses, unchanged, the §3 AI foundation** (`feature/ai-auto-categorization`,
> [ai-auto-categorization-spec.md](ai-auto-categorization-spec.md)): the lazy OpenAI client
> (`src/lib/ai/client.ts`), the `aiJsonRespond` Responses-API wrapper (`src/lib/ai/respond.ts`), the
> `runAiFeature` orchestrator (`src/lib/ai/run.ts` — auth → DB Pro gate → rate/cap → timeout →
> telemetry → fail-open), the `getAiProfile` Pro read (`src/lib/db/ai.ts`), the `track()` telemetry
> shim (`src/lib/analytics/track.ts`), the `AiParseError` sentinel (`src/lib/ai/errors.ts`), and the
> `--color-ai` accent. Like §4, **this slice adds only a prompt + parse step + a data-shaping step + a
> UI card** — exactly the seam §3 left open (its D6). No new client, orchestrator, Pro read, rate
> policy, telemetry sink, color, schema, or migration.

> **Goal:** On `/reports`, a **Pro** user gets a short, plain-language summary of how the current month
> compares to the previous one — *"Dining is up 31% vs last month. You're €40 under your Groceries
> budget, but €15 over on Transport. Net cashflow is +€420."* The narrative is **read-only insight**
> (no write path, no ledger change) and **fail-open** (the charts render with or without it). Free users
> see no narrative and no AI call is made.

---

## 1. Why this slice

Reports today answers *"what happened"* with four charts, but the user still has to read the pie, the
bars, and the line and synthesize the story themselves. The Monthly Review Narrative does that synthesis
in one glance — the **Insight layer** of the three-layer model made literal. It is on-thesis: it does not
automate or optimize anything; it surfaces understanding of data the user already captured, and it never
writes to the ledger.

It is the lowest-risk *insight* build because the entire cross-cutting envelope already exists and is
audited in one place (`runAiFeature`), and the numbers it describes come from the **already-shipped,
already-tested Reports/budget fetchers** — this slice does not invent new aggregation math, it reuses
`getCategorySpend` (split-aware) and the budget layer and asks the model only to *phrase* the result.

**The load-bearing decision (D2): the model phrases pre-computed facts; it never computes or invents
numbers.** In a finance app an AI that fabricates a "31%" is worse than no AI. So the deterministic layer
(`buildReviewFacts`, pure + unit-tested) produces every figure — deltas, budget over/under, net cashflow —
and the model receives those facts and returns only English sentences built from them. This is the same
"statistical baseline, AI for phrasing" stance the roadmap recommends for §6.

---

## 2. Scope

### In scope

- **`generateMonthlyReview` server action** (`src/actions/ai/monthly-review.ts`) — a thin wrapper over
  `runAiFeature` that (a) fetches the current- and prior-month figures for the active account scope,
  (b) shapes them into deterministic `ReviewFacts`, (c) hands those facts to the model, and (d) returns
  a `MonthlyReviewNarrative` *insight object*. Never writes.
- **Deterministic fact builder** (`src/lib/reports-review.ts`) — pure `buildReviewFacts(...)` that turns
  two months of category spend + income/expense totals + current-month budget adherence into a compact,
  ranked `ReviewFacts` object (top movers, notable budget statuses, cashflow) — including a
  deterministically-chosen `topInsight` so the model always leads with the single most impactful change
  (D7), a **minimum absolute-change floor** on movers so trivial €2→€4 wobbles are never surfaced (D8),
  and a pure `hasReviewSignal` predicate. Unit-testable with **no** Prisma or SDK mock, same discipline as
  `bucketByMonth` / `summarizeBudgets`.
- **Numeric honesty guard** (`src/lib/ai/review.ts`) — a pure `validateReviewNumbers(summary, facts)` that
  drops any generated line containing a number **not** present in `ReviewFacts` (within a formatting/
  rounding tolerance), so a misquoted figure can never reach the user (D2). If nothing survives it throws
  `AiParseError` (fail-open). This promotes the roadmap's optional "post-generation numeric check" into a
  built v1 safeguard.
- **Review data fetcher** (`src/lib/db/monthly-review.ts`) — `getMonthlyReviewInputs(userId, accountId)`:
  one server-only fetcher that assembles the two-month category spend (reusing `getCategorySpend`), the
  two-month income/expense totals, and the current-month budgets, honoring the `?account=` scope exactly
  like the other Reports fetchers.
- **Versioned prompt** (`src/lib/ai/prompts/review.ts`) — `REVIEW_INSTRUCTIONS`, `buildReviewInput`, and
  `MONTHLY_REVIEW_PROMPT_VERSION` (start at `1`) + changelog, mirroring `prompts/category.ts`.
- **Pure parse helper** (`src/lib/ai/review.ts`) — `parseReviewJson(raw)` → normalized `string[]` of
  summary lines (defensive: accepts `{ summary: [...] }`, `{ summary: "..." }`, or a bare string; throws
  `AiParseError` on non-JSON; drops empty/over-long lines). Unit-testable without the SDK.
- **UI card** (`src/components/reports/monthly-review.tsx`) — a Pro-only card at the top of the Reports
  view with a **"Generate summary"** button (Sparkles, AI accent). On click it calls the action, shows a
  loading state, and renders the returned lines. Hidden entirely for Free users and when there is not
  enough data to compare (§6).
- **Validation** — `monthlyReviewSchema` added to `src/lib/validations/ai.ts`.
- **Vitest** — unit tests for `buildReviewFacts` (deltas, budget over/under, sparse months, split-aware
  totals passthrough), `parseReviewJson` (all defensive shapes), and `generateMonthlyReview` (Pro gate
  via the mocked orchestrator path, empty-scope → `no_data`, fail-open, facts→prompt wiring). Mock OpenAI
  + the `runAiFeature` deps at the module boundary. No live calls.

### Out of scope

- **§6 Smart Budget Suggestions** — separate slice; reuses this foundation and the budget layer, not this
  prompt.
- **Persisted/cached narratives** — v1 generates **on demand** (D1) and holds the result in component
  state for the session; there is **no `AiSummary` table**. A cache is a documented extension point
  (§12), gated on §0 evidence that per-load auto-generation is wanted.
- **Auto-generate on page load** — rejected in v1 (D1); it would bill a call on every Reports visit. The
  explicit button is the deliberate, billable action, consistent with §3/§4.
- **A dashboard narrative** — v1 lives on `/reports` only (the analysis surface; Dashboard is state).
- **Helpfulness feedback (thumbs up/down)** — a natural follow-on for tuning; recorded as an extension
  point (§12), not built here. v1 telemetry is the `ai_result` the orchestrator already emits.
- **Any new write path, rate-limit policy, Pro-gate read, client, color, or telemetry sink.** All reused
  from §3. **No schema change. No migration. No new `RATE_LIMITS` entry** (see §5.3).

---

## 3. The narrative contract

`src/actions/ai/monthly-review.ts`:

```ts
/** A generated month-over-month summary. Read-only insight — never written. */
export interface MonthlyReviewNarrative {
  /** 1–4 short, plain-language sentences built from pre-computed facts (§4). */
  summary: string[];
  /** The month the narrative describes, e.g. "July 2026" — for the card header. */
  periodLabel: string;
  /** Echoed so any later feedback telemetry tags the right prompt version. */
  promptVersion: number;
}

// Reuses the shared AiResult<T> from runAiFeature.
export type MonthlyReviewResult = AiResult<MonthlyReviewNarrative>;

export async function generateMonthlyReview(input: {
  accountId?: string | null; // honors the global topbar account scope, like the charts
}): Promise<MonthlyReviewResult>;
```

**"Enough to compare" is the hard requirement.** A month-over-month narrative is meaningless without at
least the current month having spend and a prior month to compare against. When `buildReviewFacts`
determines there is nothing worth narrating (no expenses this month, or no prior-month baseline at all),
the `run` step throws `AiNoMatchError` → `runAiFeature` maps it to `reason: "no_match"` → the card shows a
quiet "Not enough data yet to summarize this month." This mirrors §4's amount-required contract and the
reserved use of `AiNoMatchError` (an empty result is genuinely useless here). Everything softer — a
category with no prior data, a missing budget — is handled *inside* the facts as a normal case, not an
error.

---

## 4. Deterministic facts — the load-bearing layer

### 4.1 Data fetch — `src/lib/db/monthly-review.ts`

```ts
import "server-only";
// getMonthlyReviewInputs assembles, for the active account scope:
//   - currentSpend / priorSpend : Map<categoryId|null, number> via getCategorySpend
//       (split-aware; the SAME helper budgets + Reports use, so figures never drift)
//   - currentTotals / priorTotals : { income, expenses } via a scoped groupBy
//   - budgets : the current month's budgets with split-aware spent + effective limit
//       (reuse getBudgets — already rollover- AND split-aware)
//   - a name/icon lookup for the category ids that appear, resolved once (no N+1)
export async function getMonthlyReviewInputs(
  userId: string,
  accountId: string | undefined
): Promise<ReviewInputs>;
```

Windows come from the existing budget-period helpers: `currentPeriod()` + `monthBounds()` for this month,
`previousPeriod()` + `monthBounds()` for last month (both already shipped, already tested by
`feature/budget-rollover`). Category spend uses `getCategorySpend(userId, window, { accountFilter })` so a
split transaction is attributed to its lines exactly as everywhere else. Account scope is resolved with
the same rule as `reportTxWhere` (all-accounts → active only; explicit `?account=` honored even if
archived).

> **Scope decision (D3): the narrative is fixed to "this calendar month vs last," independent of the
> Reports period pills.** The pills (1m / 3m / 12m) drive the *charts*; a "Monthly Review" is definitionally
> month-over-month, so it does not read `?period=`. It **does** read `?account=` (same scope as the charts).
> This keeps the feature focused and its facts unambiguous, and sidesteps the "narrate 12 months of noise"
> failure mode.

### 4.2 Fact shaping — `src/lib/reports-review.ts` (pure)

`buildReviewFacts(inputs: ReviewInputs, opts: { maxMovers, maxBudgetNotes }): ReviewFacts` produces a
compact, ranked, **already-numeric** structure the model only has to phrase:

```ts
export interface ReviewFacts {
  periodLabel: string;                 // "July 2026"
  netCashflow: number;                 // income − expenses, current month
  totalIncome: number;
  totalExpenses: number;
  /** The single most impactful fact, chosen deterministically (D7) — the model
   *  is instructed to lead with this so the output order is stable. */
  topInsight: { kind: "mover" | "budget" | "cashflow"; ref: string } | null;
  /** Biggest category movers vs last month, ranked by absolute change. */
  movers: {
    name: string;
    current: number;
    previous: number;
    deltaPct: number | null;           // null when previous == 0 (new spend — see below)
    direction: "up" | "down" | "new";
  }[];
  /** Notable current-month budget statuses (over first, then closest to the edge). */
  budgetNotes: {
    name: string;
    spent: number;
    effectiveLimit: number;
    remaining: number;                 // effectiveLimit − spent (may be negative)
    status: "over" | "under";
  }[];
}
```

Rules (all deterministic, all unit-tested):

- **Movers** — join current vs prior category spend by id; `deltaPct = (current − previous) / previous`
  when `previous > 0`, else `direction: "new"` with `deltaPct: null` (a "new this month" fact, never a
  divide-by-zero or a bogus "∞%"). **Discard any mover whose absolute euro change is below
  `REVIEW_MIN_MOVER_DELTA`** (D8, a system-constants floor, e.g. €5) *before* ranking — a €2→€4 doubling
  is statistically large but practically noise. Rank the survivors by absolute euro change (not pct — a
  300% jump on €4 is noise), keep the top `maxMovers` (default 3). A category that vanished (spent last
  month, €0 this month) is a legitimate `direction: "down"` mover if its drop clears the floor.
- **Top insight (D7)** — after movers + budget notes are ranked, pick the single most impactful fact by a
  deterministic priority: the largest **over-budget** overspend, else the largest-euro **mover**, else a
  materially non-zero **cashflow**, else `null`. Recorded as `topInsight` and named in the prompt as the
  line to lead with, so the narrative's ordering does not drift call-to-call for the same data.
- **Budget notes** — from the current month's budgets: `over` = `spent > effectiveLimit`, else `under`;
  rank over-budget first (largest overspend), then under-budget closest to its limit; keep the top
  `maxBudgetNotes` (default 2). Uses the **effective** (rollover-carry-adjusted) limit already returned by
  `getBudgets`, so the narrative agrees with the /budgets bars.
- **Cashflow** — `netCashflow = totalIncome − totalExpenses` for the current month.
- **Tie-breaking (fully deterministic output)** — every ranking uses a **stable secondary key of category
  name ascending** (case-insensitive) so equal-impact items never reorder run-to-run: movers with an
  identical absolute euro change, budget notes with an identical overspend/remaining, and the `topInsight`
  pick when two candidates of the winning kind tie all fall back to name order. `topInsight` itself is
  chosen by the fixed kind-priority (over-budget > mover > cashflow), then takes the already-name-sorted
  first element of that kind — so identical `ReviewFacts` always yield the identical lead.
- **"Nothing to narrate" signal** — expose a pure predicate `hasReviewSignal(facts)` (there is spend this
  month AND at least one mover or budget note or non-trivial cashflow). The action throws `AiNoMatchError`
  when it is false (§3), so the sparse-month path is a single tested rule, not scattered `if`s.

Amounts are rounded via the shared `round2` (`src/lib/money.ts`) before they enter the facts, so the
model never sees `40.000000004`.

---

## 5. Control flow, prompt, and rate limiting

### 5.1 Control flow — thin over `runAiFeature`

```ts
return runAiFeature({
  feature: "monthly_review",
  promptVersion: MONTHLY_REVIEW_PROMPT_VERSION,
  burstLimit: "aiSuggest", // shared POLICY (20/h), separate BUCKET — key is `${feature}:${userId}` (§5.3)
  failOpenMessage: "Couldn't generate a summary — your charts are below.",
  run: async ({ userId, signal }) => {
    const inputs = await getMonthlyReviewInputs(userId, accountId);
    const facts = buildReviewFacts(inputs, { maxMovers: 3, maxBudgetNotes: 2 });
    if (!hasReviewSignal(facts)) throw new AiNoMatchError("Not enough month-over-month data.");

    const raw = await aiJsonRespond({
      instructions: REVIEW_INSTRUCTIONS,
      input: buildReviewInput(facts),   // facts serialized as JSON — the model only phrases them
      signal,
    });
    const parsed = parseReviewJson(raw);            // string[]; throws AiParseError on bad JSON
    const summary = validateReviewNumbers(parsed, facts); // drops misquoted lines; throws if none survive
    const dropped = parsed.length - summary.length;
    if (dropped > 0) {
      await track("ai_numeric_guard", {
        feature: "monthly_review",
        prompt_version: MONTHLY_REVIEW_PROMPT_VERSION,
        dropped_count: dropped,
        kept_count: summary.length,
      });
    }

    return {
      summary,
      periodLabel: facts.periodLabel,
      promptVersion: MONTHLY_REVIEW_PROMPT_VERSION,
    } satisfies MonthlyReviewNarrative;
  },
});
```

Everything outside `run` — auth, the **DB-driven** Pro gate, the shared monthly COGS cap + the burst cap,
the timeout, telemetry, and fail-open — is the orchestrator's, unchanged.

### 5.2 Prompt — `src/lib/ai/prompts/review.ts`

Versioned + changelogged, mirroring `prompts/category.ts`. The instructions are strict about **using only
the provided numbers**:

```ts
/** Changelog: v1 — initial: phrase the provided month-over-month facts into 1–4
 *  short sentences; never invent or recompute figures. */
export const MONTHLY_REVIEW_PROMPT_VERSION = 1;

export const REVIEW_INSTRUCTIONS = [
  "You write a brief, friendly monthly spending summary for a personal-finance app.",
  "You are given pre-computed facts as JSON. Use ONLY those numbers — never invent, estimate, or recompute figures.",
  "Respond as JSON: { \"summary\": [ up to 4 short plain-language sentences ] }.",
  "Lead with the fact named by `topInsight`, then mention other notable movers, budget over/under, and net cashflow.",
  "Amounts are euros; keep the euro sign. Be concise and neutral — inform, don't advise or moralize.",
  "If a mover is marked \"new\", describe it as new spending this month, not a percentage change.",
].join(" ");

export function buildReviewInput(facts: ReviewFacts): string {
  return JSON.stringify(facts); // the literal word "json" also satisfies the json_object guardrail
}
```

`parseReviewJson` (in `src/lib/ai/review.ts`) is defensive: `JSON.parse` (→ `AiParseError` on failure),
accept `summary` as an array or a single string (wrap it), coerce each entry to a trimmed non-empty
string, drop anything over a sane per-line cap, and cap the list at 4. Never returns `[]` on a successful
parse with content; an empty result after coercion throws `AiParseError` (garbage in).

**Numeric honesty guard — `validateReviewNumbers(summary, facts)` (also in `src/lib/ai/review.ts`).** After
parsing, every line is checked against the numbers actually present in `ReviewFacts`: extract each numeric
token from a line and **drop the whole line** if any token is not an allowed figure. A model that phrases
faithfully loses nothing; a model that misquotes a "31%" as "38%" has that line silently removed. If
**no** line survives, throw `AiParseError` so the whole call fails open to the charts rather than showing a
partial/empty card. This makes D2 enforced, not merely instructed — the pure function is unit-tested
independently of the SDK.

**Exact tolerance (documented so future edits stay deterministic).** Two module-local constants in
`review.ts` fix the comparison — no fuzzy matching beyond these:

- **Token normalization** — strip the currency symbol (`€`), spaces, and thousands separators, and unify
  the decimal separator, so `€1,234.5`, `1 234,50`, and `1234.50` all normalize to the number `1234.5`.
  A leading sign (`+`/`−`) is kept.
- **Allowed set** — build the set of allowed numbers once from the facts: every `current` / `previous` /
  `remaining` / `spent` / `effectiveLimit` / `netCashflow` / `totalIncome` / `totalExpenses` amount, plus,
  for each mover, `Math.round(deltaPct * 100)` (the integer percentage the prose is expected to use).
- **Money tokens** match an allowed amount within `NUMERIC_GUARD_MONEY_EPSILON = 0.01` (one cent — absorbs
  the round-to-cents already applied in `buildReviewFacts`). **Percentage tokens** (a number immediately
  followed by `%`) match an allowed percentage within `NUMERIC_GUARD_PCT_EPSILON = 1` (±1 point, absorbing
  round-direction differences). A bare integer that matches neither an amount nor a percentage (e.g. a
  day-of-month the model invented) fails the line.

> **Localization seam (D9, not built in v1).** The app is English + EUR-only today, so the prompt emits
> English and the guard matches a euro/`%` number grammar. `buildReviewInput` and `REVIEW_INSTRUCTIONS`
> are written so a future `locale` argument threads through **without a redesign**: `buildReviewInput(facts,
> locale?)` would add the locale to the payload and the instructions would gain a "respond in <language>"
> line, while `validateReviewNumbers` would key off the locale's number/currency formatting. Recorded as an
> extension point (§12); no locale plumbing ships now.

### 5.3 Rate limiting — reuse `aiSuggest`, no new entry

Passing `burstLimit: "aiSuggest"` with `feature: "monthly_review"` gives this feature its **own** hourly
bucket (key `monthly_review:${userId}`) under the shared 20/h policy, while the global `aiMonthly` COGS
ceiling is applied by `runAiFeature` on every call and shared across all AI features — exactly the §3/§4
pattern. A review call is a few hundred tokens (compact facts in, ≤4 sentences out), well within the
COGS budget. **No `RATE_LIMITS` change is needed.**

### 5.4 Responses-API gotchas (carried, still load-bearing)

Same `aiJsonRespond` wrapper, so the §3 "CRITICAL" rules still hold: Responses API (not Chat Completions —
`gpt-5-nano` returns empty content there), `json_object` format with **manual** parse (no
`zodResponseFormat`), the literal word "json" present in the input (it is, via the JSON-serialized facts +
the instructions), and string normalization after receipt. All encapsulated in `respond.ts`.

---

## 6. UI integration — the Reports narrative card

`ReportsView` ([reports-view.tsx](../../src/components/reports/reports-view.tsx)) already receives `isPro`.
Render a new `<MonthlyReview>` **above the chart grid** (after the optional `<UpgradePrompt />`), **only
when `isPro`**:

- **Standalone AI-accented section (not `ChartCard`).** Because the narrative is a **fixed
  month-over-month** view (D3) that never reads the period pills, it is pulled out of the period-scoped
  chart grid into its own band: an `border-ai/25` section with a Sparkles icon square in the header, titled
  "Monthly review" with a **fixed, self-describing "This month vs last month" subtitle**. This removes the
  "is this a 3/12-month summary?" ambiguity a `ChartCard` sibling would invite (chosen over "show only on
  the 1-month pill" — the card stays visible on every pill because its data is pill-independent). Before
  generation it shows a one-line prompt ("See how this month compares to last — generated by AI.") and a
  Sparkles **"Generate summary"** button (`text-ai`, `hover:bg-ai/10`), matching the §3 Suggest button.
  `useTransition` drives a "Summarizing…" disabled state.
- **On result** — render `summary` as a stacked list of short lines under a concrete `periodLabel` eyebrow
  ("July 2026") so the reader knows exactly which month. A subtle "AI-generated — figures from your data."
  caption reinforces provenance (and that the numbers are real, not model-invented — the D2 promise made
  visible).
- **Generation timestamp (D10)** — stamp a client-side "Generated just now" line beside the caption on
  each result (a relative label off a `generatedAt` set in component state, refreshed on every generate/
  regenerate). Makes repeated regenerations legible — the user can see the card actually re-ran, not
  merely re-rendered. Local UI state only; never persisted.
- **Regenerate** — after a first result, the button becomes "Regenerate" (each press is a fresh call; no
  cache, consistent with §4 D11). Disabled while in flight.
- **Account scope** — the card reads the active `?account=` from the URL (via `useSearchParams`, like the
  period selector) and passes it to the action, so the narrative matches whatever the charts are scoped to.
  Changing the account **clears** any shown narrative (it now describes a different scope) — the user
  re-generates.
- **Errors (all fail-open, never block the charts)** — drive the message off the result `reason`:
  `no_match` → "Not enough data yet to summarize this month."; `rate_limited` → "You've hit the hourly
  limit — try again shortly."; every other reason (`timeout` / `ai_error` / `parse_failed`) → a generic
  "Couldn't generate a summary right now." The charts below are always fully rendered regardless.
- **Stale-result guard** — reuse the monotonic-token pattern (`reviewRunRef`) so a slow generation that
  resolves after the account/period changed is discarded rather than shown against the wrong scope.
- **Data-thin gate** — gate the card on **`isPro` only**. An earlier draft reused the view's
  `hasEnoughForTrends(txCount)` signal, but `txCount` is scoped to the **selected period pill**, which
  coupled a fixed month-over-month card to the chart window — it wrongly vanished on the "This month" (1m)
  pill (current month alone < `REPORTS_MIN_TRANSACTIONS`) and reappeared on 3m/12m. Since the window is
  fixed month-over-month (D3), the card's visibility must be **period-independent**. A genuinely sparse
  month is already handled server-side by `hasReviewSignal` → `no_match` → the card's quiet "Not enough
  data yet to summarize this month." note, so no separate period-scoped visibility gate is needed.

**Decisions (decisions over options):**

- **D1 — On-demand button, not auto-on-load.** An explicit click is a deliberate, billable request; no
  surprise cost on every Reports visit. On-thesis with conscious engagement and consistent with §3/§4.
- **D2 — The model phrases pre-computed facts; it never computes numbers, and the output is numerically
  verified.** Every figure originates in the deterministic `buildReviewFacts` and is passed in; the prompt
  forbids invention **and** `validateReviewNumbers` (§5.2) drops any line whose numbers aren't in the
  facts. This is the single most important correctness rule — a finance narrative that hallucinates a
  percentage is unacceptable — so it is both instructed and enforced, not left to trust.
- **D3 — Fixed month-over-month window, independent of the period pills; honors the account scope.** A
  "Monthly Review" is definitionally this-month-vs-last; the pills drive charts, not the story.
- **D4 — No cache/persistence in v1.** Result lives in component state for the session. A cache table is an
  extension point (§12), promoted only if §0 shows repeat generation of the *same* month is common.
- **D5 — Confirm-not-auto, read-only.** The action returns an insight object; nothing is written and no
  existing writer is touched. Trivially on-thesis (there is no ledger interaction at all).
- **D6 — Foundation reuse = "prompt + parse + facts step only."** No new client, orchestrator, Pro read,
  rate policy, telemetry sink, or color — the second proof (after §4) of §3's D6.
- **D7 — A deterministic `topInsight` fixes the lead.** The fact-builder picks the single most impactful
  fact (over-budget > largest mover > cashflow) and the prompt leads with it, so the summary's ordering is
  stable across regenerations of the same data instead of drifting with the model's whim.
- **D8 — Movers below `REVIEW_MIN_MOVER_DELTA` are discarded.** A minimum absolute-euro floor keeps
  practically-insignificant swings (€2→€4) out of the narrative even when they are large in percentage
  terms — the story stays about money that matters.
- **D9 — English/EUR-only, but the prompt + guard are locale-ready.** No localization ships now;
  `buildReviewInput` / `validateReviewNumbers` are shaped to accept a future `locale` without a redesign
  (§5.2, §12).
- **D10 — Show a "Generated just now" timestamp on each result.** Repeated regenerations are otherwise
  visually ambiguous; a relative timestamp makes the re-run legible. Local state only.

---

## 7. Telemetry

`runAiFeature` already emits **exactly one** `ai_result` per generation (`feature: "monthly_review"`,
`prompt_version`, `outcome`, `reason`) — so generation success/failure and the *reason* breakdown
(`no_match` sparse-month vs `parse_failed` vs `timeout`) are free and diagnosable from day one. Because
generation is on-demand and rendered inline, **a generate = a view**, which is precisely the roadmap §5
success metric ("view/expand rate on the narrative"): it is `ai_result(outcome="ok")` counts per Pro user,
sliceable by `prompt_version`.

One lightweight server-side diagnostic **is** added: when `validateReviewNumbers` removes at least one
line, the action emits `ai_numeric_guard { feature, prompt_version, dropped_count, kept_count }` through
the same shim — **counts only, no financial values or line text** (the shim's standing no-PII contract).
This measures how often the D2 guard actually intervenes: a rising `dropped_count` rate for a given
`prompt_version` is a direct signal that the prompt is drifting toward misquoting and needs a reword,
turning the guard from a silent safety net into a tuning input. It fires only on a non-empty drop (a clean
pass emits nothing, keeping the common path quiet); the all-dropped case still surfaces as the
`ai_result` `parse_failed`/`no_match` path.

Beyond that, no user-facing emitter is added in v1. A helpfulness signal (thumbs) is the natural next
telemetry and is recorded as an extension point (§12) — it would emit `ai_review_rated { prompt_version,
helpful }` through the same shim, **field-name/boolean only, no financial values**.

---

## 8. Files

**New — monthly-review feature**
- `src/actions/ai/monthly-review.ts` — thin `generateMonthlyReview` action over `runAiFeature`.
- `src/lib/db/monthly-review.ts` — `getMonthlyReviewInputs(userId, accountId)` (server-only; reuses
  `getCategorySpend` + the budget layer; `?account=`-scoped).
- `src/lib/reports-review.ts` — pure `buildReviewFacts` + `hasReviewSignal` (+ `ReviewFacts` /
  `ReviewInputs` types, declared here — **not** re-exported from the `"use server"` action, per the
  Turbopack type-reexport constraint).
- `src/lib/ai/prompts/review.ts` — `REVIEW_INSTRUCTIONS`, `buildReviewInput`,
  `MONTHLY_REVIEW_PROMPT_VERSION` + changelog.
- `src/lib/ai/review.ts` — pure `parseReviewJson` + `validateReviewNumbers` (numeric honesty guard).
- `src/components/reports/monthly-review.tsx` — the Pro-only narrative card (`"use client"`), incl. the
  "Generated just now" timestamp (D10).

**New — tests**
- `test/lib/reports-review.test.ts` — `buildReviewFacts` (up/down/new movers, absolute-euro ranking,
  divide-by-zero → `new`, `REVIEW_MIN_MOVER_DELTA` floor, `topInsight` priority, over/under budget notes
  using effective limit, `maxMovers`/`maxBudgetNotes` caps) + `hasReviewSignal` (sparse month → false).
- `test/lib/ai/review.test.ts` — `parseReviewJson` (array, single-string, bare-string, bad JSON →
  `AiParseError`, over-cap trimming, empty-after-coercion → `AiParseError`) + `validateReviewNumbers`
  (faithful passthrough, misquoted-line drop, formatting tolerance, all-dropped → `AiParseError`).
- `test/actions/ai/monthly-review.test.ts` — well-formed mock → narrative with `promptVersion`; sparse
  scope → `reason: "no_match"`; asserts `runAiFeature` invoked with the right `feature` / `burstLimit` /
  `promptVersion`; facts passed to `aiJsonRespond`. Mock OpenAI + the orchestrator deps (`auth`,
  `checkRateLimit`, `getAiProfile`, `track`) at the module boundary.

**Modified**
- `src/lib/system-constants.ts` — add `REVIEW_MIN_MOVER_DELTA` (mover floor, e.g. `5`). This is the one
  genuinely-global tuning knob the feature adds; the `maxMovers`/`maxBudgetNotes` caps stay call-site args.
- `src/lib/validations/ai.ts` — add `monthlyReviewSchema` (`{ accountId: z.string().nullish() }`).
- `src/components/reports/reports-view.tsx` — render `<MonthlyReview>` above the grid when `isPro`
  (and above the `hasEnoughForTrends` threshold); no other change.
- `docs/project-overview.md` — once shipped, a one-line note under **Reports** that the Pro AI Monthly
  Review Narrative has landed (per the roadmap's "Out-of-Scope reconciliation" rule; §5 is an insight
  feature, not an Out-of-Scope item, so this is additive documentation only).
- `docs/POST-MVP-ROADMAP.md` — flip the §5 / Delivery-Sequence slot-10 row to shipped and advance the
  "Next up" tracker to §6 Smart Budget Suggestions (slot 11).

**Unchanged but reused:** `src/lib/ai/{client,respond,run,errors}.ts`, `src/lib/db/ai.ts` (`getAiProfile`),
`src/lib/db/split-spend.ts` (`getCategorySpend`), `src/lib/db/budgets.ts` (`getBudgets`),
`src/lib/budget-period.ts` (`currentPeriod`, `previousPeriod`, `monthBounds`), `src/lib/money.ts`
(`round2`), `src/lib/analytics/track.ts`, `src/lib/system-constants.ts` (`AI_MODEL`, `AI_TIMEOUT_MS`,
`RATE_LIMITS`), `src/app/globals.css` (`--color-ai`). **No schema change. No migration.** The only new
global constant is `REVIEW_MIN_MOVER_DELTA` (D8); the prompt-version lives with the prompt, and the two
`maxMovers`/`maxBudgetNotes` caps stay fact-builder call-site args (promote to `system-constants.ts` only
if a second caller appears).

---

## 9. Testing

Per [coding-standards.md](../coding-standards.md) — cover `src/actions/**` + `src/lib/**`, mock the
provider at the module boundary, **no live calls**; components are out of scope. The split (orchestrator
already tested in §3 · pure fact-builder · pure parser · wired action) keeps each layer isolated:

- **`buildReviewFacts`** — the correctness core: current-vs-prior deltas, `previous == 0` → `direction:
  "new"` / `deltaPct: null` (never `Infinity`), disappeared category → `down`, absolute-euro ranking (a
  large-% small-€ change ranks below a small-% large-€ one), the `REVIEW_MIN_MOVER_DELTA` floor drops a
  €2→€4 mover (D8), the `topInsight` priority (over-budget > largest mover > cashflow > null, D7),
  over/under budget classification against the **effective** limit, and the `maxMovers`/`maxBudgetNotes`
  caps. Split-aware totals are passed through verbatim (the fetcher already attributes splits — the
  fact-builder trusts the `Map`).
- **Determinism + tie-breaking** — equal-impact movers/budgets resolve by category-name ascending; and
  the same `ReviewInputs` twice yields **identical** `movers` order and an **identical** `topInsight`
  (guards the D7 "stable lead" promise regardless of the model's wording).
- **`hasReviewSignal`** — true with a real mover/budget note/cashflow; false for an empty/sparse month
  (drives the action's `no_match`).
- **`parseReviewJson`** — `{ summary: [...] }`, `{ summary: "one line" }`, bare `"..."`, malformed JSON →
  `AiParseError`, over-cap list trimmed to 4, empty-after-coercion → `AiParseError`.
- **`validateReviewNumbers`** — keeps faithful lines verbatim; drops a line whose figure isn't in the
  facts (misquoted `38%`); tolerates formatting variants within tolerance (`€1,234.5` ≡ `1234.50` within
  `NUMERIC_GUARD_MONEY_EPSILON`; a `31%` from `deltaPct` within `NUMERIC_GUARD_PCT_EPSILON`); rejects an
  invented bare integer (a day-of-month) that matches neither an amount nor a percentage; a line with no
  numbers passes; **all** lines dropped → `AiParseError` (D2).
- **`generateMonthlyReview`** — matched narrative (with `promptVersion`) on a well-formed mock; sparse
  scope → `success: false, reason: "no_match"`; asserts the `feature`/`burstLimit`/`promptVersion` passed
  to `runAiFeature` and that `buildReviewFacts` output reaches `aiJsonRespond`; emits `ai_numeric_guard`
  with the right `dropped_count`/`kept_count` when the mock response contains a misquoted line, and
  **not** on a clean pass (assert `track` call presence/absence).
- The `runAiFeature` envelope (Pro gate, rate/cap, timeout→reason, single `ai_result`, fail-open) is
  **already covered** by `test/lib/ai/run.test.ts` from §3 — not re-tested here.

Gates: `npm run test:run` + `npm run build` + lint clean before commit, per
[ai-interaction.md](../ai-interaction.md).

---

## 10. Cost, safety, and philosophy

- **Cost** — one review = compact facts in, ≤4 sentences out; a few hundred tokens on `gpt-5-nano`, a
  fraction of a cent. On-demand (D1) means at most a handful of calls per Reports session, well under the
  §3 COGS budget (~€0.20–0.30 / Pro user / month). The shared `aiMonthly` cap is the runaway rail.
- **Honesty / no hallucinated numbers (D2)** — the deterministic fact layer owns every figure; the model
  only phrases; `validateReviewNumbers` then drops any line whose numbers aren't in the facts, and the UI
  caption states figures come from the user's data. Instructed, verified, and disclosed — the correctness
  posture the finance domain requires.
- **Confirm-not-auto** — read-only insight; there is no ledger interaction and no writer is touched, so the
  conscious-capture rule is satisfied by construction (there is nothing to confirm).
- **Fail-open** — a missing key, a timeout, a parse failure, or an over-cap all degrade to the charts
  rendering without a narrative. Analysis is never blocked.

---

## 11. Open questions for the product owner

The roadmap §5 open decisions; the spec proposes answers and flags what needs sign-off:

1. **Generation model (D1)** — confirm **on-demand button** (recommended; cheap, on-thesis) vs. auto-
   generate on Reports load (bills every visit) vs. a per-month cache (needs a table — deferred, §12).
2. **Hallucination guard strength (D2)** — the spec now ships **both** facts-in/phrasing-out **and** the
   post-generation `validateReviewNumbers` check (drops any line with a figure not in `ReviewFacts`).
   Confirm "drop the offending line" (recommended — honest partial) vs. "fail the whole call on any
   misquote" (stricter — all-or-nothing). Either way a misquoted number never reaches the user.
3. **Window (D3)** — confirm fixed month-over-month (this vs last calendar month), independent of the
   period pills, honoring the account scope.
4. **Tone / length** — confirm ≤4 short, neutral, non-advisory sentences (the app is "clarity, not
   optimization" — the narrative informs, it does not coach).
5. **Acceptance threshold** — sign off the expand/iterate/retire number for this feature. Its natural
   metric is **generation/view rate among Pro Reports visitors** (and, once thumbs ship, helpful-rate),
   not a "suggestion-accept" rate — so calibrate the rubric accordingly at the Pro Value Review checkpoint.
6. **Helpfulness feedback** — add a thumbs up/down now (extra telemetry emitter) or defer to a follow-on
   (recommended defer, §12)?

---

## 12. Alignment checks & extension points

**Alignment:**
- **Read-only insight; no write path** — `generateMonthlyReview` returns a narrative object; nothing is
  persisted, no existing writer is touched. ✅
- **Pro gate DB-driven, never JWT; fail-open on every error/timeout/over-cap → charts still render.** ✅
  (inherited from `runAiFeature`, not re-implemented).
- **Numbers are deterministic, split- and rollover-aware** — the narrative reuses `getCategorySpend` and
  the budget layer, so its figures agree with the charts and `/budgets` bars; the model only phrases. ✅
- **Foundation reuse = "prompt + parse + facts step only":** no new client, orchestrator, Pro read, rate
  policy, telemetry sink, or color — the second proof of §3's D6 (after §4). ✅
- **Measurable iteration:** prompt is versioned + changelogged; every `ai_result` carries `prompt_version`
  and a first-class `reason`, so a reword is comparable and a sparse-month `no_match` is distinguishable
  from a `parse_failed`. ✅
- **Constants discipline:** model, caps, timeout, prompt version, and AI color all live in
  `system-constants.ts` / the prompt module / `globals.css`; the two fact caps are call-site args, not
  magic literals in a component. ✅

**Extension points (intended, not built this slice):**
- **Cached / persisted narratives** — an `AiSummary(userId, periodKey, accountScope, summary, promptVersion,
  createdAt)` row keyed by month would let the same month's review load instantly (and enable auto-on-load
  cheaply). Additive; promote on §0 evidence that repeat generation of the same month is common (D4).
- **Helpfulness feedback** — a thumbs up/down under the card emitting `ai_review_rated { prompt_version,
  helpful }` (boolean only) turns "was it good?" into a directly-optimizable signal for prompt iteration.
- **Dashboard teaser** — a one-line "This month at a glance" derived from the *same* `buildReviewFacts`
  (deterministic, no AI call) could live on the Dashboard state screen, linking to the full Reports
  narrative — reusing the fact layer without a second model call. Gate on demand.
- **Wider windows** — a "quarter in review" or "year in review" would reuse `buildReviewFacts` over a
  different window pair; strictly later, evidence-gated, and kept separate from the fixed monthly default
  (D3).
- **Localization (D9)** — thread a `locale` through `buildReviewInput(facts, locale)` (adds it to the
  payload + a "respond in <language>" instruction) and key `validateReviewNumbers` off the locale's
  number/currency grammar. The seam is deliberately shaped for this now; the plumbing ships only when
  multi-language (and likely multi-currency, §11) is on the table.
```
