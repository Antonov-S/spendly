# Pro Value Review — Measurement & Report — Implementation Spec

> **✅ Shipped — measurement tooling (`feature/pro-value-review`, merged 2026-07-07).** Everything
> this spec commits to build is live: `src/lib/analytics/review-metrics.ts` (pure
> `buildProValueReviewReport` + frozen `AI_REVIEW_THRESHOLDS`), the read-only
> `scripts/ai-review-report.ts`, `docs/reviews/pro-value-review-template.md`, Part B token/model
> telemetry (`ai_result` + `input_tokens`/`output_tokens`/`model`, emitted centrally by
> `runAiFeature`), `AI_REVIEW_WINDOW_DAYS = 28`, and the roadmap ✦-row note. §8's open questions
> were resolved at build time: D3 thresholds approved as written; Part B shipped now; template
> author "Project owner". **One deviation (repo wins):** `aiJsonRespond` now returns
> `{ text, usage?, model }` instead of a bare string, so the four AI actions were touched to read
> `response.text` and wrap their result in `withAiTelemetry(...)` — the orchestrator remains the
> single `ai_result` emit site and feature behavior is unchanged. Beyond spec: the script also
> prints a "Feature context" table (D6 guard-health/panel-yield/repeat-rate ride-alongs). 1074
> tests, build + lint clean. **The checkpoint itself remains open:** the originally implied
> earliest review date was **2026-08-03** (D1 window from the 2026-07-06 telemetry go-live), but
> the roadmap trigger was **revised 2026-07-07 to be condition-based** — the app deploys via
> Vercel CI but is not publicly launched (no public domain, no real users), so the D1 window now
> starts at the §20 soft/official launch, not at telemetry go-live: run the review after ≥ 28
> days of **real production/beta telemetry** with enough usage to judge the AI features (too
> small a sample → record
> "insufficient data" and extend). Run the script, record
> `docs/reviews/pro-value-review-<YYYY-MM>.md`, and update the roadmap ✦ row with the verdict —
> until then §13 stays parked. See POST-MVP-ROADMAP §20 (Public Launch Readiness).
>
> This spec implements the [POST-MVP-ROADMAP.md](../POST-MVP-ROADMAP.md)
> **✦ Pro Value Review checkpoint** — the one unshipped row in the Delivery Sequence. Every
> committed feature (slots 1–15) has shipped, and §0 telemetry (`feature/product-analytics`) went
> live on 2026-07-06, which the roadmap names as the checkpoint's unblocking event ("unblocked
> pending a measurement window").
>
> The checkpoint itself is **"not a feature — a gate."** What *is* implementable — and what this
> slice builds — is everything that makes the gate runnable and objective instead of a judgment
> call: the **committed metric definitions** (grounded in the event registry that actually exists),
> the **committed thresholds**, a **pure, unit-tested metrics module**, and a **read-only report
> script** that turns the `AnalyticsEvent` table into a per-feature verdict table with one command.
> The review then runs as an operator step once the measurement window has elapsed, and its outcome
> is recorded back into the roadmap.

> **Goal:** After a defined measurement window of §0 data, answer three questions with numbers,
> not intuition: **(1)** Is AI driving Pro (adopters vs. non-adopters)? **(2)** What is the
> per-feature verdict — expand / iterate / retire — for each of the four AI capabilities
> (§3 Auto-Categorization, §4 NL Quick Capture, §5 Monthly Review, §6 Budget Suggestions)?
> **(3)** Is actual AI COGS per Pro user inside the ~€0.20–0.30/month budget? The outcome gates
> §13 (later-stage AI assistants): only an explicit "expand AI" verdict grows the AI surface.

---

## 1. Why this slice

The roadmap's cross-cutting notes are explicit: *"Every AI feature ships instrumented and is
judged on explicit thresholds — define them in each spec before building, then act on the numbers,
not intuition."* All four AI features shipped instrumented through the `track()` shim, and §0 made
those events persist. But three gaps stand between "events exist in a table" and "a decision can be
made":

1. **No committed metric definitions.** "Acceptance rate" means something different per feature
   (§3 has accept/override events; §4 has an edit-diff; §5 is an insight with no accept action;
   §6's per-suggestion denominator only surfaces on dismissal). Left undefined, the review becomes
   the judgment call the roadmap forbids.
2. **No way to compute them.** Nobody is going to hand-write SQL against `props` JSON at review
   time and get it consistent across reviews. The computation must be pure, tested, and re-runnable
   so review N and review N+1 measure the same thing.
3. **No cost telemetry.** The "Cost reality" question currently has no in-app data source at all —
   `ai_result` records outcomes, not tokens.

This slice closes all three **now**, while the measurement window is still accruing — so that when
the window closes, the review is one command plus one written verdict, not a project.

---

## 2. Scope

### In scope

- **D-decisions below**: measurement window, per-feature acceptance definitions, committed
  thresholds, adopter/activity definitions, and the known-bias notes (opt-out, small N).
- **Pure metrics module** `src/lib/analytics/review-metrics.ts` — takes plain event rows
  (`{ name, props, userId, createdAt }`) + a user-plan snapshot and returns the full
  `ProValueReviewReport` structure. No Prisma, no I/O — fully unit-tested.
- **Read-only report script** `scripts/ai-review-report.ts` — fetches the window's
  `AnalyticsEvent` rows + a minimal `User` projection, runs the pure module, prints the report
  (per-feature funnel, acceptance, reliability, adoption/Pro overlap, verdict per committed
  thresholds). Mirrors `scripts/prune-analytics.ts` conventions (dotenv, host printout, dev-branch
  marker) — but it is **read-only**, so no `--apply`/`--production` gating is needed.
- **Token/cost telemetry (Part B, small)** — extend the `ai_result` registry entry with
  `input_tokens` / `output_tokens` (`"number"`) and `model` (`"string"` — the resolved model
  slug, D9), surface usage + model from the Responses API in `aiJsonRespond`, and thread them
  through `runAiFeature`'s success emit. Counts and a config slug only — squarely inside the
  no-PII / no-financial-values contract. This starts the COGS clock now; earlier weeks
  of the window fall back to the OpenAI dashboard (operator step).
- **Review procedure + verdict template** — `docs/reviews/pro-value-review-template.md` and the
  rule that the completed review lands as `docs/reviews/pro-value-review-<YYYY-MM>.md`, with the
  roadmap's ✦ row updated to record the outcome.

### Out of scope

- **Any change to the four AI features themselves.** This slice measures; iteration/retirement is
  the *outcome* of the review, executed as its own later slice per feature.
- **An in-app admin dashboard / UI.** One operator runs this occasionally; a script is the right
  altitude. (Revisit only if reviews become recurring enough to justify it.)
- **New user-facing surface, schema model, or migration.** `AnalyticsEvent` and `User.isPro`
  already hold everything needed. Part B is a registry + emit change only.
- **Session stitching / funnels beyond user-level.** Events carry `userId` + `createdAt`, not
  session ids. All rates below are defined at run-level or user-level, never session-level.
- **Automated verdicts acted on by code.** The script *prints* the rubric verdict; a human records
  and owns the decision.

---

## 3. Decisions

**D1 — Measurement window: 28 days, starting at telemetry go-live (2026-07-06).** A four-week
window smooths weekly rhythm (salary/rent cycles drive both capture and budget behaviour) and is
the shortest window the roadmap's "stable window" wording plausibly means. The script takes
`--days N` and `--from YYYY-MM-DD` overrides so later reviews can re-run on any window; the
constant `AI_REVIEW_WINDOW_DAYS = 28` (system-constants) is the default. **The review must not run
early** — the script prints a loud warning when the window's data span is shorter than the
requested window.

**D2 — Acceptance is defined per feature, from the events that actually exist** (see §4). Where a
clean per-suggestion denominator doesn't exist (§6), the committed measure is **user-level**
(users-with-≥1-accept / users-with-≥1-ok-run) — honest and deterministic beats precise-looking and
made-up. §5 has no accept action by design, so it is judged on **engagement bands**, not
acceptance (the roadmap's own success metrics for §5 are "view/expand rate; repeat visits").

**D3 — Thresholds: adopt the roadmap rubric as committed numbers.** Expand **≥ 60%**, iterate
**30–60%**, retire **< 30%**, applied to each feature's committed acceptance measure (§4). For §5
the engagement bands are: expand ≥ **40%** of active Pro users generate ≥ 1 summary in the window
*and* ≥ **25%** of generators regenerate or return in a later week; iterate 15–40%; retire < 15%.
The roadmap calls its percentages "placeholders to be calibrated" — this spec freezes them as the
*starting* commitment; the first review may recalibrate **in writing, in the verdict doc, before
looking at the numbers per-feature** (never after, to fit a wished-for verdict).

**D4 — Adopter = a user with ≥ 1 `ai_result { outcome: "ok" }` event in the window.** A served
suggestion is adoption of the surface even if that particular suggestion was overridden.
Non-adopter = an active Pro user (see D5) with zero such events. The Pro-signal comparison
(adopters vs. non-adopters) uses **activity retention as the proxy**: distinct active days (days
with ≥ 1 event of any kind) and week-over-week presence. Stripe conversion correlation
(`upgrade_to_pro_clicked` → later `isPro`) is reported as a count, not a rate — at current scale
it will be anecdote, and the report must label it as such.

**D5 — Active user = ≥ 1 analytics event of any kind in the window.** This is the denominator for
adoption shares. Known bias, stated in the report header: opted-out users (`analyticsOptOut`) and
pre-consent drops are invisible to *all* metrics — rates are computed over consenting users only.

**D6 — Reliability is part of every feature's verdict, not a separate report.** For each feature,
the fail breakdown of `ai_result` (`timeout` / `ai_error` / `parse_failed` / `rate_limited` /
`no_match`) is printed next to acceptance: a feature with great acceptance but a high
timeout/ai_error share is an "iterate (reliability)" candidate regardless of its acceptance band.
Guard health rides along: `ai_numeric_guard` drop ratios (§5/§6) and `ai_phrasing_degraded` counts
(§6) — a guard that fires often means the prompt, not the feature, needs iteration.

**D7 — COGS: measured going forward, estimated backward.** Part B's token props make cost
computable in-app from its deploy date (tokens × per-model price — D9; prices as script-local
constants, since this is an operator report, not product logic). For the window slice before Part B lands, the
operator reads the OpenAI dashboard and enters the figure into the verdict doc by hand. The budget
line it is checked against: **≤ ~€0.20–0.30 / Pro user / month** (roadmap cross-cutting note).

**D8 — Pro status is a report-time snapshot.** `AnalyticsEvent` stores no plan snapshot, and
`User.isPro` has no history — so event-time Pro evaluation is **impossible with existing data**,
and this spec does not add plan-change telemetry to get it. The committed rule: a user's
Pro/Free classification for the whole window is `User.isPro` **as read when the script runs**.
Two mitigations keep this honest: (1) run the report promptly at window close (report-time ≈
window-end); (2) the data-coverage block (D10) counts users with an `upgrade_to_pro_clicked`
event inside the window — the visible marker for "plan may have changed mid-window" — so the
reviewer can judge how much snapshot skew is even possible. At current scale that count will
usually be zero or single digits; if it ever isn't, adding a plan snapshot to future events is
the fix, decided at that review.

**D9 — Token telemetry carries the model.** Token counts alone can't survive a model swap
(`AI_MODEL` is deliberately a knob) or per-feature model divergence: the same token volume costs
differently per model, and pricing changes over time. So Part B's `ai_result` extension includes
`model` (the resolved model slug, e.g. `"gpt-5-nano"`) alongside the token counts, and the
script's price table is keyed **per model** (script-local constants with a "prices as of <date>"
comment — operator report, not product logic). Any `(model, tokens)` pair with no price entry is
reported as unpriced volume, never silently priced at a wrong rate.

**D10 — Every report opens with a data-coverage block.** The verdict is only as auditable as its
inputs, so the script prints (and the template records) before any metric: total active users and
active Pro users (D5 denominators, absolute numbers); the opt-out caveat (rates cover consenting
users only — opted-out users are invisible, their count is unknowable from this table by design);
the token-telemetry coverage start date (first `ai_result` row carrying token props) and the share
of the window it covers, **rolled up into an explicit `costMeasurement` verdict** —
`measured` / `partial` / `manual-estimate-required` — so it is immediately visible whether the
COGS section rests on measured data, needs a manual top-up for part of the window, or is entirely
a manual OpenAI-dashboard estimate. A non-`measured` verdict states its cause(s) separately,
because they call for different remedies: incomplete time coverage (dashboard backfill for the
pre-Part-B slice) vs. unpriced volume (`unpricedModels` + `unpricedTokenShare` — fixed by adding
a D9 price-table entry and re-running); the D8 mid-window-upgrade count; and the actual data span vs.
the requested window (the D1 short-window warning, restated as a number).

**D11 — The verdict is recorded, not just computed.** The review produces
`docs/reviews/pro-value-review-<YYYY-MM>.md` (from the template), and the roadmap's ✦ checkpoint
row + §13's promotion criterion are updated with the outcome: **(a) expand** (promote from §13),
**(b) iterate** (per-feature rework slices), or **(c) hold** (let the non-AI backlog carry the
next cycle). Until that doc exists, the checkpoint is open and §13 stays parked.

---

## 4. Metrics model — grounded in the real registry

Every metric below names only events and props that exist in `src/lib/analytics/events.ts` today.
`ai_result.feature` is the join key: `category_suggest` (§3), `transaction_parse` (§4),
`monthly_review` (§5), `budget_suggest` (§6).

### 4.1 §3 Auto-Categorization (`category_suggest`)

| Measure | Definition |
|---|---|
| Served | count `ai_result { feature: category_suggest, outcome: ok }` |
| Accepted / Overridden | counts of `ai_category_accepted` / `ai_category_overridden` |
| **Acceptance (committed)** | `accepted / (accepted + overridden)` |
| Abandonment (context) | `served − (accepted + overridden)` — suggestion served, transaction never saved (or drawer closed); reported, not judged |

### 4.2 §4 NL Quick Capture (`transaction_parse`)

| Measure | Definition |
|---|---|
| Served | count `ai_result { feature: transaction_parse, outcome: ok }` |
| Confirmed | count `ai_parse_confirmed` |
| Clean confirm | `ai_parse_confirmed` with `edited: false` **or** `edited_field_count ≤ 1` — the roadmap's "confirmed without heavy edits"; one touched field (typically category) is a light edit, two or more is heavy |
| **Acceptance (committed)** | `clean confirms / served` |

### 4.3 §5 Monthly Review (`monthly_review`) — engagement, not acceptance

| Measure | Definition |
|---|---|
| Generators | distinct users with ≥ 1 `ai_result { feature: monthly_review, outcome: ok }` |
| **Engagement (committed)** | `generators / active Pro users` (D5 denominator) |
| Repeat | share of generators with ok-runs in ≥ 2 distinct ISO weeks of the window |
| Guard health | Σ `ai_numeric_guard.dropped_count` vs. Σ `kept_count` for the feature |

### 4.4 §6 Budget Suggestions (`budget_suggest`)

| Measure | Definition |
|---|---|
| Runs | count `ai_result { feature: budget_suggest, outcome: ok }` |
| Accepts | count `ai_budget_suggest_accepted` (with `edited` share reported) |
| Panel yield (context) | from `ai_budget_suggest_dismissed` rows: Σ `accepted_count` / Σ `suggested_count` — only defined over explicitly-dismissed panels; reported with that caveat, never the headline |
| **Acceptance (committed)** | user-level: `users with ≥ 1 accept / users with ≥ 1 ok run` (D2) |
| Phrasing health | `ai_phrasing_degraded` count (deterministic-fallback share) |

### 4.5 Cross-feature (the "Is AI driving Pro?" section)

- Adopters vs. non-adopters (D4) among active Pro users: distinct active days, distinct active
  weeks, and per-cohort counts of core product actions (`transaction_created`, `budget_created`)
  — activity as the retention proxy.
- `no_match` is broken out from real failures everywhere (it is a designed degrade, not an error).
- Per-feature `rate_limited` counts — evidence for whether the shared `aiSuggest` 20/h bucket is
  ever actually hit.
- **Small-N rule:** any rate whose denominator is < 10 users (or < 20 runs) is printed with an
  explicit `⚠ n=<denominator>` marker and excluded from automatic verdict wording — the script
  prints "insufficient data" rather than a band.

---

## 5. Deliverables

### 5.1 Pure metrics module — `src/lib/analytics/review-metrics.ts`

```ts
export interface ReviewEventRow {
  name: string;
  props: Record<string, unknown> | null;
  userId: string;
  createdAt: Date;
}

export interface ReviewUserRow {
  id: string;
  isPro: boolean; // report-time snapshot (D8) — the module never sees plan history
}

export interface ReviewCoverage {
  activeUsers: number;
  activeProUsers: number;
  requestedWindowDays: number;
  actualSpanDays: number; // first→last event in window (D1 warning as a number)
  tokenCoverageFrom: Date | null; // first ai_result row carrying token props
  tokenCoverageShare: number; // 0–1 of the window with measured (vs. manual) cost data
  // Derived verdict on the COGS section's evidence quality, so the operator never
  // has to interpret the share: "measured" (share = 1 and all volume priced),
  // "partial" (0 < share < 1 — manual estimate needed for the uncovered slice —
  // and/or some measured volume unpriced), "manual-estimate-required" (share = 0,
  // or measured volume exists but is entirely unpriced per D9).
  costMeasurement: "measured" | "partial" | "manual-estimate-required";
  // Why a report is not fully "measured" — the two causes need different operator
  // remedies (dashboard backfill vs. a price-table entry), so they are reported
  // separately. Both zero/empty ⇔ costMeasurement === "measured".
  unpricedModels: string[]; // model slugs seen in token rows with no D9 price entry
  unpricedTokenShare: number; // 0–1 of measured token volume belonging to those models
  midWindowUpgradeClicks: number; // users with upgrade_to_pro_clicked in-window (D8 skew marker)
}

export interface ProValueReviewReport {
  coverage: ReviewCoverage; // printed first (D10)
  /* per-feature blocks + cross-feature block, §4 shapes */
}

export function buildProValueReviewReport(
  events: ReviewEventRow[],
  users: ReviewUserRow[],
  window: { from: Date; to: Date }
): ProValueReviewReport;

export function verdictForRate(rate: number | null, n: number): "expand" | "iterate" | "retire" | "insufficient";
```

Pure and window-agnostic (the window is metadata for the report header; filtering happens in the
script's query). All D3 thresholds live here as exported constants
(`AI_REVIEW_THRESHOLDS`), so the tests pin them and a recalibration is a visible diff.

### 5.2 Report script — `scripts/ai-review-report.ts`

Read-only. Follows `prune-analytics.ts` conventions: `dotenv/config`, prints target host +
dev/production marker (transparency only — no mutation gate needed), then:

1. Resolve window: `--from` / `--days` args, defaulting to `AI_REVIEW_WINDOW_DAYS` ending now.
2. One `analyticsEvent.findMany` (select `name, props, userId, createdAt`, window-scoped) + one
   `user.findMany` (select `id, isPro` for the userIds seen). Bounded by retention (≤ 180 days of
   rows exist at all) — no pagination needed at current scale.
3. `buildProValueReviewReport(...)` → the **data-coverage block first** (D10), then formatted
   console tables + the D3 verdict line per feature, with the D1 short-window warning and §4.5's
   small-N markers. The COGS section prices `(model, tokens)` pairs against the script's
   per-model table (D9) and reports unpriced volume separately.

### 5.3 Part B — token telemetry (additive)

- Registry: add `input_tokens: "number"`, `output_tokens: "number"`, `model: "string"` to
  `ai_result` (D9 — a model slug like `"gpt-5-nano"` passes the existing `STRING_PROP_PATTERN`;
  it is configuration, not user data).
- `aiJsonRespond` returns `{ text, usage?, model }` (the Responses API exposes
  `usage.input_tokens` / `usage.output_tokens` and echoes the resolved `model`);
  `runAiFeature`'s success emit threads them through. Fail path emits without them (absent props
  are simply omitted — the sink already strips undefined).
- No behaviour change to any feature; existing emit sites untouched (the props are added inside
  the orchestrator, the single place `ai_result` is emitted).

### 5.4 Review template — `docs/reviews/pro-value-review-template.md`

Sections: **data coverage** (the D10 block verbatim from the script: active users / active Pro
users, opt-out caveat, token-telemetry coverage start + measured-vs-manual cost share and the
`costMeasurement` verdict, mid-window-upgrade count, actual span vs. requested window) →
per-feature table (measure, value, band, verdict) → reliability/guard notes → Pro-signal section →
COGS vs. budget → **Decision** (expand / iterate / hold, with the specific §13 promotions or
per-feature iteration slices named) → roadmap edits made.

---

## 6. Files

| File | Change |
|---|---|
| `src/lib/analytics/review-metrics.ts` | **New** — pure report builder + thresholds (§5.1) |
| `scripts/ai-review-report.ts` | **New** — read-only report script (§5.2) |
| `src/lib/analytics/events.ts` | `ai_result` gains `input_tokens` / `output_tokens` / `model` (§5.3, D9) |
| `src/lib/ai/respond.ts` | surface Responses-API `usage` + resolved `model` (§5.3) |
| `src/lib/ai/run.ts` | thread usage + model into the success `ai_result` emit (§5.3) |
| `src/lib/system-constants.ts` | `AI_REVIEW_WINDOW_DAYS = 28` |
| `docs/reviews/pro-value-review-template.md` | **New** — verdict template (§5.4) |
| `docs/POST-MVP-ROADMAP.md` | ✦ row: note that the measurement tooling shipped and the review date it unlocks |

No schema change, no migration, no new route, no UI, no new `RATE_LIMITS` entry, no Pro gate.

## 7. Testing

- `test/lib/analytics/review-metrics.test.ts` — the bulk: per-feature acceptance math from
  synthetic event rows (each §4 definition gets a worked fixture), `no_match` exclusion, small-N
  → `insufficient`, D3 band edges (60/30 boundaries), §5 engagement + repeat-week logic,
  adopter/non-adopter cohort split, empty-window report, and the D10 coverage block
  (token-coverage share from mixed with/without-token rows, mid-window-upgrade count, actual
  span vs. requested window, and the `costMeasurement` tri-state at its edges: full-coverage →
  `measured`, mixed rows → `partial`, no token rows or all-unpriced volume →
  `manual-estimate-required`; plus the cause split — full time coverage with one unpriced model →
  `partial` with that slug in `unpricedModels` and the right `unpricedTokenShare`, and both
  fields empty/zero exactly when the verdict is `measured`).
- `test/lib/ai/run.test.ts` — extend: success emit carries token + model props when `usage`
  present, omits them when absent; fail emit unchanged.
- `test/lib/analytics/events.test.ts` — extend: new `ai_result` token props sanitize as numbers;
  `model` sanitizes as a string and a slug like `"gpt-5-nano"` passes the pattern.
- Script stays thin glue (out of Vitest scope, per house rules); the pure module carries the
  logic precisely so this is true.

## 8. Open questions for the product owner

1. **Sign off D3 as-frozen** (60 / 30–60 / 30 acceptance; 40 / 15–40 / 15 engagement for §5) — or
   set your own numbers *now*, before the window closes.
2. ~~**Review date** — the window opened 2026-07-06 (telemetry go-live); D1 puts the earliest
   honest review at ~2026-08-03. Confirm, or extend if traffic is thin.~~ **Resolved
   (2026-07-07 roadmap revision):** condition-based, not calendar-based — the D1 window starts at
   the §20 soft/official launch (the app was not yet live at telemetry go-live); insufficient
   sample at review time → record "insufficient data" and extend.
3. **Part B now or later?** Recommended now (starts the COGS clock); skipping it makes the first
   review's cost section fully manual (OpenAI dashboard only).
4. **Who is "the operator"?** Single-owner project, presumably you — but the verdict doc should
   name its author and date.

## 9. Alignment checks

- **"Not a feature — a gate"**: no user-facing surface is added; the product is untouched except
  two invisible telemetry props. The slice makes the gate *runnable*, it does not decorate it.
- **No-PII contract**: token counts are counts; the report is operator-side console output over
  data the app already stores.
- **Decisions over options**: D1–D11 freeze the definitions before the numbers exist — the
  entire point of the checkpoint discipline.
- **§13 stays parked** until the verdict doc exists and says "expand." This spec changes nothing
  about that gate except making it decidable.
