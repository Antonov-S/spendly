# Cash-Flow Forecast — Implementation Spec

> **Goal:** Project the balance forward from **active recurring templates + pending drafts** —
> *"you'll dip to €240 around the 28th, before salary."* Forward-looking **awareness**, not
> optimization or automation: it only projects items the user already set up, it never writes
> anything, and it renders as a small dependency-free line/area on the Dashboard.

Implements [POST-MVP-ROADMAP.md](../POST-MVP-ROADMAP.md) **§18 Cash-Flow Forecast** (Delivery
Sequence **slot 14** — the next unshipped slot; slots 1–13 are all shipped). Branch:
`feature/cash-flow-forecast`. Follows the patterns in
[entity-crud-architecture.md](./entity-crud-architecture.md); the pure-builder-over-existing-data
approach mirrors the shipped insights strip
([dashboard-insights-strip-spec.md](./dashboard-insights-strip-spec.md)) and the deterministic
engine of [subscription-detection-spec.md](./subscription-detection-spec.md).

---

## 0. Sequencing notes — read before building

- **Zero AI, zero writes, zero schema.** This is a pure read-side projection over data the app
  already owns (templates, drafts, derived balance). No `runAiFeature`, no prompt, no
  `--color-ai` accent, no Server Action mutation, no migration. If the diff contains a write
  path or an OpenAI import, the slice is off-spec.
- **The Pro Value Review checkpoint does not block this slice.** It gates §13 (AI expansion);
  §18 is a non-AI enhancement and proceeds independently — the same reasoning the §9 and §10
  specs recorded.
- **On-thesis check.** The projection is built exclusively from structures the user consciously
  created (templates) or is being asked to confirm (drafts). It predicts nothing from history,
  learns nothing, and nags about nothing — it answers one question the current dashboard can't:
  *"given what I've already scheduled, where is my balance heading?"* That is state-adjacent
  awareness, the explicit framing the roadmap gives it.
- **Calm by default.** The card is informational. No alerts, no push, no red-badge pressure —
  the one visual escalation is the semantic `danger` color when the projected balance crosses
  below zero (color encoding is strictly semantic; a real projected negative balance *is* the
  danger state). A "projected dip" notification-bell item is explicitly deferred (§13).

---

## 1. Why this slice

The recurring system knows the future — that is its whole point. Templates carry
`nextOccurrence` + `cadence`, drafts carry `suggestedDate` + `suggestedAmount`, and
`advanceNextOccurrence` can step any date forward with correct month-end clamping. Today that
knowledge is only consumed *reactively* (mint a draft when a date arrives). This slice consumes
it *proactively*: fold the scheduled series into the derived balance and show the trajectory.

The value chain: a user who set up Rent (−€900, monthly), Netflix (−€13, monthly), and Salary
(+€2400, monthly) has already told Spendly everything needed to answer "will I clear the 28th?"
— the dashboard just never says so. The hero balance answers *where am I*; the sparkline answers
*where have I been this month*; the forecast completes the triad with *where am I heading*.

---

## 2. Scope

### In scope

- A pure, deterministic **projection engine** (`src/lib/forecast.ts`): fold pending drafts +
  future template occurrences over a fixed horizon into a daily balance series, a low point,
  and an end-of-horizon balance (§4).
- A **`ForecastPanel` card on `/dashboard`** (right column, below `GoalsWidget`): a small
  dependency-free SVG area/line + a low-point line + an end-of-horizon line (§8).
- A lean **fetcher** (`src/lib/db/forecast.ts`) that reads scheduled items only — the balance
  itself is composed in-process from `summary.totalBalance` the page already fetches (§6, D6).
- One constant — `FORECAST_HORIZON_DAYS = 30` (§5).
- Vitest coverage for the engine and the fetcher (§11).

### Out of scope (explicit)

- **No writes, no actions, no schema change, no migration.** Read-only end to end.
- **No Pro gate** (D4). Deterministic, zero COGS, and directly serves the core-awareness
  promise — the same stance as subscription detection and the notification bell.
- **No horizon picker.** One fixed 30-day window in v1 (D2 — decisions over options). 60/90-day
  variants are a constants-plus-UI seam, not a v1 requirement.
- **No account scoping.** The projection extends the hero balance, which aggregates all active
  accounts; scoping one without the other would make the card contradict the number beside it
  (D5).
- **No Reports placement.** Reports is period-scoped *history* behind a Free/Pro history gate;
  a forecast is period-independent *future*. Putting it there would either dodge or abuse the
  period selector (D1).
- **No history-based inference.** The projection uses scheduled items only — never "you usually
  spend €X on groceries." Inferred spending is a different (and off-thesis-adjacent) feature.
- **No insights-strip / notification-bell integration.** A "projected dip below zero" pill is
  the obvious follow-up but needs its own severity/dedup thinking; deferred (§13).
- **No telemetry.** Nothing to measure through the no-op shim — the card has no accept/dismiss
  action (the Trash/§10-panel precedent: deterministic free features ship uninstrumented until
  §0 lands a real sink).

---

## 3. Inputs — exact data contract

### 3.1 Starting balance

`summary.totalBalance` from the dashboard's existing `getDashboardSummary` — **not** a new
query. It is the projection's **anchor**: the fold begins from exactly the number rendered in the
hero block beside it (`points[0]` equals it whenever nothing is due today, and steps off it when
something is — see §4.2 day-0 semantics). Recomputing the balance here would risk drift and
duplicate work (D6).

> **Known, accepted imprecision:** `totalBalance` already includes any *future-dated* ledger
> rows the user hand-entered (the aggregate has no date ceiling). Windowing the forecast's
> start to `date <= today` would fix that theoretical wrinkle at the cost of the card visibly
> disagreeing with the hero number it extends. Consistency wins; documented, not a bug.

### 3.2 Scheduled items (the fetcher's job, §6)

| Source | Predicate | Fields |
|---|---|---|
| **Active templates** | `userId`, `isActive: true`, `financialAccount: { isArchived: false }` | `type`, `amount` (→ `Number`, positive magnitude), `cadence`, `nextOccurrence`, `hasPendingDraft` (via `drafts: { where: { status: "PENDING" }, select: { id: true }, take: 1 }` — the `generatePendingDrafts` pattern) |
| **Pending drafts** | `status: "PENDING"`, `recurringTemplate: { userId, financialAccount: { isArchived: false } }` | `suggestedDate`, `suggestedAmount` (→ `Number`, positive magnitude), template `type` |

- Paused templates are excluded — pausing is the user saying "this isn't happening right now."
- Archived-account items are excluded on both reads: archived accounts can't receive
  transactions, so nothing scheduled against one can ever land (and `archiveFinancialAccount`
  already pauses its active templates — the filter is belt-and-braces).
- No `Decimal` crosses the pure boundary: the fetcher maps amounts to `Number(...)` magnitudes;
  sign is derived from `type` inside the engine, exactly as `confirmDraft` derives it at write
  time.

---

## 4. The projection engine — deterministic rules

> Pure function, injectable `today`, no I/O, no randomness. Identical input → identical output
> (the `buildNotificationItems` / `buildRecurringSuggestions` determinism contract).

### 4.1 Event expansion

Build the flat list of **signed events** inside the window `[today, today + FORECAST_HORIZON_DAYS]`
(both ends inclusive, `today` = `startOfUtcDay(now)`):

1. **Each pending draft** contributes one event at `max(startOfUtcDay(suggestedDate), today)`
   with signed amount `type === "EXPENSE" ? -amount : +amount`. An overdue draft is due *now*
   — it lands on day 0, matching the assumption that the user will confirm it (§4.3).
2. **Each active template** contributes an event per occurrence, stepping with the existing
   `advanceNextOccurrence(date, cadence)` from a **starting date** that depends on whether a
   pending draft already represents the head of the series:
   - `hasPendingDraft === false` → start at `nextOccurrence`.
   - `hasPendingDraft === true` → start at `advanceNextOccurrence(nextOccurrence, cadence)`.

   **This skip rule is load-bearing.** While a draft is PENDING the template's `nextOccurrence`
   is *not yet advanced* (`confirmDraft`/`dismissDraft` advance it) — so a template with a
   pending draft would otherwise project the same occurrence the draft already contributes,
   double-counting it. Verified against `src/actions/recurring.ts` + the partial unique index
   (at most one PENDING draft per template).
3. Occurrences **before `today`** (an overdue template that hasn't minted a draft yet — draft
   generation only runs on `/recurring` load) are **clamped to day 0**: they are due now and
   the projection assumes scheduled items happen (§4.3). Stepping continues from the *unclamped*
   date so the series' rhythm is preserved.
4. Occurrences **after the horizon end** stop the template's loop. The loop is bounded by
   construction: even a DAILY template emits ≤ `FORECAST_HORIZON_DAYS + 1` events; an overdue
   MONTHLY template a year behind emits ≤ ~13 clamped events. No cap constant needed.
5. DAILY and YEARLY cadences are **included** — unlike §10's detection bands, these are items
   the user explicitly scheduled; a YEARLY insurance premium landing inside the window is
   exactly the surprise the card exists to surface.

### 4.2 Series fold

- `startBalance` is the pre-forecast **anchor** — today's current balance from
  `summary.totalBalance`, *before* any scheduled (pending/future) event has landed.
- The fold records the **end-of-day** balance for each day: start a running `balance =
  startBalance`, then for each day `d` in `0..FORECAST_HORIZON_DAYS` apply `balance += sum(signed
  events clamped to day d)` and set `points[d] = { date: today + d, balance: round2(balance) }`.
- **Day-0 semantics (explicit, no ambiguity):** `points[0]` is the balance at the *end* of today
  — `startBalance` **plus** any overdue/today events (§4.1.1, §4.1.3), **not** the bare anchor.
  When nothing is due today (the common case) `points[0] === startBalance`, so the line visibly
  starts at the hero number; when something *is* due now, the first point already reflects it —
  the honest read. `startBalance` itself is never a plotted point; it is the scalar the fold
  begins from.
- Output (`ForecastResult`, all serializable):

```ts
export interface ForecastPoint {
  date: Date;        // UTC midnight
  balance: number;   // round2
}

export interface ForecastResult {
  points: ForecastPoint[];        // length = FORECAST_HORIZON_DAYS + 1
  low: ForecastPoint;             // min balance; earliest day wins a tie
  end: ForecastPoint;             // points[points.length - 1]
  /** Scheduled events inside the window — 0 means "nothing to project" (§8 hides the card). */
  eventCount: number;
}

export function buildCashflowForecast(input: {
  startBalance: number;
  templates: ReadonlyArray<{
    type: RecurringType;
    amount: number;               // positive magnitude
    cadence: RecurringCadence;
    nextOccurrence: Date;
    hasPendingDraft: boolean;
  }>;
  drafts: ReadonlyArray<{
    type: RecurringType;
    amount: number;               // positive magnitude
    suggestedDate: Date;
  }>;
  now?: Date;                     // injectable; defaults to new Date()
  horizonDays?: number;           // defaults to FORECAST_HORIZON_DAYS
}): ForecastResult
```

Reuses `advanceNextOccurrence` + `startOfUtcDay` + `round2` — **no new date or money math**.
Internal structure mirrors the notifications builder: small module-private helpers
(`expandTemplateEvents`, `signedAmount`) assembled by one exported function.

### 4.3 The core assumption — drafts get confirmed

The projection assumes every scheduled item lands: pending drafts are treated as future (or
immediate) transactions, and template occurrences as certain. This is the only honest v1 choice
— modeling confirmation probability would be inference, and the alternative (excluding drafts)
would show a salary-day cliff *disappear* the moment the draft is minted, which is exactly
backwards. The card's caption states the assumption plainly (§8).

---

## 5. Constants (`src/lib/system-constants.ts` — projection policy is system-level tuning)

```ts
/* ── Cash-flow forecast (cash-flow-forecast spec §4) ── */

/** Days projected forward from today on the dashboard forecast card. */
export const FORECAST_HORIZON_DAYS = 30;
```

One knob, deliberately. 30 days covers one full monthly cycle (every MONTHLY template fires
exactly once), which is where the "dip before salary" insight lives. The engine takes
`horizonDays` as a defaulted parameter so tests pin boundaries explicitly and a future 60/90
toggle is a UI-plus-constant change with zero algorithm change (the §10 config-seam pattern).

---

## 6. DB layer (`src/lib/db/forecast.ts`, `server-only`)

```ts
export interface ScheduledItems {
  templates: /* §4.2 template input shape */[];
  drafts: /* §4.2 draft input shape */[];
}

export async function getScheduledItems(userId: string): Promise<ScheduledItems> {
  const [templates, drafts] = await Promise.all([ /* §3.2 queries */ ]);
  return { templates: /* map: Number(amount), hasPendingDraft: drafts.length > 0 */,
           drafts:    /* map: Number(suggestedAmount), type from template */ };
}
```

Composition only — no business logic, `userId`-scoped everywhere, select-only projections.
The **fold happens in the page** (D6): `buildCashflowForecast` is called in-process with
`summary.totalBalance`, so the forecast can never disagree with the hero balance and the
fetcher stays balance-agnostic (the insights-strip "derive from what the page already fetched"
stance). A lazy Server Action (the notification-bell pattern) was considered and rejected —
this is page content on one page that already runs a parallel fetch block, not a decoration on
ten (§10 spec's identical reasoning, §5 there).

> **Where the reusable unit lives.** The domain-level computation is entirely in the pure
> `buildCashflowForecast` engine (§4) — that is the isolated, fully-testable, surface-agnostic
> unit any future caller (Reports, a mobile/API surface) would reuse. The dashboard page does
> **not** contain forecast *logic*; it only **composes** the engine with the already-fetched
> `summary.totalBalance` and `getScheduledItems`. That composition deliberately does not become
> its own `getCashflowForecast(userId)` fetcher, because doing so would re-run the hero-balance
> aggregate — duplicating aggregation logic and reintroducing the exact drift D6 exists to
> prevent. A standalone surface without a hero balance in hand would compose the same engine
> with its own balance read; the engine's input shape already supports that with zero change.

**Freshness:** `/dashboard` is `force-dynamic`, and every recurring mutation already calls
`revalidatePath("/dashboard")` — confirming a draft or pausing a template refreshes the
projection with zero new wiring.

---

## 7. Page wiring (`src/app/dashboard/page.tsx`)

- `getScheduledItems(userId)` joins the existing `Promise.all` (8 → 9 fetchers).
- After the fetch: `const forecast = buildCashflowForecast({ startBalance: summary.totalBalance,
  ...scheduled });`
- Render `<ForecastPanel forecast={forecast} />` in the right column **below `GoalsWidget`**,
  inside the existing `accounts.length > 0` branch (the zero-state card already owns the other
  branch). Rationale for the slot: the right column is the glanceable state column (budgets →
  goals → trajectory); the left column stays the ledger.

---

## 8. UI (`src/components/dashboard/forecast-panel.tsx`, server component)

No interactivity → server component, like `BudgetsPanel` / `InsightsStrip`.

- **Hidden when `forecast.eventCount === 0`** — a user with no active templates and no pending
  drafts has nothing to project, and a flat 30-day line is decoration ("never UI without backing
  function"; silence = nothing to act on, the insights-strip precedent). The card renders
  nothing; no nudge copy in v1.
- **Header:** eyebrow-style title `Projected balance` + a quiet meta line
  `Next 30 days · assumes scheduled items are confirmed` (the §4.3 assumption, stated once,
  calmly — horizon text derived from `FORECAST_HORIZON_DAYS`, never hardcoded).
- **Chart:** a small dedicated dependency-free SVG (module-private within the panel, the
  reports-chart convention — not a `Sparkline` reuse, see §12):
  - line + faint area over `points`, **dashed stroke** — the one visual cue that this is a
    projection, not history (the hero sparkline next to it is solid);
  - a dot on `points[0]` ("today");
  - when any point `< 0`: a hairline zero baseline, and the line/area segments below it in
    `--color-danger`; otherwise the neutral grey (`--color-neutral`-family token) — **not**
    success-green, which the hero sparkline owns and which would over-promise about a guess;
  - `role="img"` + a data-summarizing `aria-label` ("Projected balance over the next 30 days:
    from €1,240 to €980, lowest €240 around Jun 28"), decorative shapes `aria-hidden` — the
    shipped reports a11y contract; color is never the only signal (the low point is also text).
- **Facts row** (real DOM text, the load-bearing content — the chart illustrates it):
  - `Lowest: €240 · around Jun 28` — `formatCurrency` + short date; value in `--color-danger`
    when `< 0`, otherwise default ink;
  - `In 30 days: €980` with a signed delta vs. today (`formatSigned` styling conventions).
- Mobile: plain stacked card, nothing special — the SVG scales via `viewBox`.

---

## 9. Edge cases & rules

- **No scheduled items** → `eventCount === 0` → panel absent (§8). The dashboard is unchanged
  for users who never touched recurring — this feature costs them nothing, visually or in
  queries (one cheap indexed read).
- **Overdue template, no draft yet** — occurrence clamps to day 0 (§4.1.3); the moment the user
  visits `/recurring` and a draft is minted, the projection is identical (draft at day 0, first
  template occurrence skipped) — the two states are provably equivalent, which is the point of
  the skip rule.
- **Deeply overdue template** (months behind, drafts never confirmed) — its backlog piles onto
  day 0. Honest: that money is due now if the user confirms the series. The alternative
  (silently dropping overdue occurrences) would understate expenses.
- **Projected balance below zero** — fully supported (the reports balance chart already renders
  negatives); this is the card's highest-value output, styled `danger`, never clamped.
- **INCOME templates** — first-class positive events; the "dip *before salary*" shape only
  exists because salary is projected too.
- **Transfers** — structurally impossible here (templates are INCOME/EXPENSE only) and
  irrelevant anyway: a transfer between two active accounts nets to zero against the aggregated
  all-accounts balance.
- **EUR-only** — amounts fold as raw numbers; currency mixing is impossible in the shipped app
  and the engine takes no currency input (the §10 stance verbatim).
- **`@db.Date` alignment** — every scheduled date is a UTC midnight; `startOfUtcDay(now)` puts
  `today` on the same grid, so day-bucketing is exact integer arithmetic (no DST/timezone
  drift), same as the §10 gap math.

---

## 10. Decisions (resolving the roadmap's open questions)

| # | Decision | Rationale |
|---|---|---|
| **D1** | **Surface: Dashboard**, right column below Goals | Forward-looking *state* ("where am I heading given what's scheduled"), glanceable, refreshed by the revalidation paths recurring mutations already hit. Reports is period-scoped history behind the Free/Pro history gate — a period-independent future chart fits neither its selector nor its gate. |
| **D2** | **Horizon: fixed 30 days** | One full monthly cycle — every MONTHLY template fires exactly once, which is where the dip-before-salary insight lives. No picker in v1 (decisions over options); `horizonDays` param + constant leave the 60/90 seam open. |
| **D3** | **Include pending drafts AND active templates**, with the skip rule | Drafts are the head of each series (assumed confirmed, §4.3); excluding them would make the projection *lose* information the instant a draft is minted. Paused templates excluded — pausing is explicit user intent. |
| **D4** | **Free, not Pro-gated** | Deterministic, zero marginal cost, core-awareness. Matches §9/§10: Pro depth is the AI layer + Reports history, not basic awareness. If the Pro Value Review wants a Pro angle, longer horizons (90/180d) are the natural gate — a seam, not a v1 decision. |
| **D5** | **All active accounts, ignores `?account=`** | The card extends `summary.totalBalance`, which aggregates all active accounts; scoping one but not the other would put two contradicting numbers side by side. |
| **D6** | **Fold in-process on the page from `summary.totalBalance`** | The projection's anchor is *the* hero number — reusing it makes disagreement structurally impossible and adds zero balance queries. Fetcher reads scheduled items only. |
| **D7** | **Hide at `eventCount === 0`** | Never UI without backing function; a flat projected line is decoration. |
| **D8** | **Dashed neutral line; `danger` only below zero** | Color stays strictly semantic: projection ≠ history (dash), and the only *state* a guess can honestly signal is "this path crosses zero." |

### Rejected (considered, decided against — with the seam named)

- **Extending the hero sparkline with a dashed future segment.** Elegant, but the hero
  sparkline is a 104×36 unlabeled accent inside `PageHeader` — it can't carry a low-point
  annotation, an a11y summary, or the assumption caption, and overloading it violates its
  one-glance job. **Seam:** the panel's SVG is self-contained; a future slice could render a
  mini variant into the header without touching the engine.
- **Reusing `<Sparkline>`.** It's `aria-hidden`, solid-stroke, min/max-normalized with no zero
  baseline — three of the four things this chart needs are the things it deliberately doesn't
  do. A module-private SVG in the panel follows the reports-chart precedent instead.
- **Confidence weighting / historical-spend inference.** Off-thesis (inference, not
  awareness) and dishonest at v1 data volumes. The engine's input shape wouldn't change if a
  future slice ever added an "estimated other spending" band — named here so nobody bolts it
  into v1.
- **A `getCashflowForecast` fetcher that owns the balance query.** Duplicates the hero
  aggregate, risks drift, and couples the fetcher to balance semantics it doesn't need (D6).

### Deferred (known follow-ups, not oversights)

- **Horizon toggle (30/60/90)** — constants + a pill row; engine already parameterized.
- **"Projected dip below zero" insight** — an insights-strip pill / notification-bell item
  (`danger` tone) once the card proves the projection is trusted; needs the §9 severity rules.
- **Per-account forecast** — meaningful only after multi-currency (§11) or account-scoped
  dashboards exist.
- **Marking individual template occurrences as "skip this one"** — a write-path feature on the
  recurring side, not a forecast concern.

---

## 11. Testing (Vitest — pure logic + fetcher; components out of scope per standards)

- **`test/lib/forecast.test.ts`** (the bulk):
  - empty inputs → flat series at `startBalance`, `eventCount 0`, `low === end === points[0]`;
  - draft signing (EXPENSE negative / INCOME positive) and overdue-draft clamp to day 0;
  - **the skip rule:** template with `hasPendingDraft: true` starts one step past
    `nextOccurrence`; the equivalent no-draft template produces the *identical* series (the
    §9 equivalence claim, asserted);
  - overdue template with no draft → clamped day-0 events, rhythm preserved from unclamped
    dates; deep backlog bounded and summed on day 0;
  - horizon boundary: an occurrence on exactly day `horizonDays` is included, day
    `horizonDays + 1` is not; DAILY emits `horizonDays + 1` events; YEARLY inside/outside the
    window; MONTHLY month-end clamping inherited from `advanceNextOccurrence` (Jan 31 → Feb 28);
  - `low` = earliest minimum on ties; `end` = last point; all balances `round2`-ed;
  - `points.length === horizonDays + 1`; injectable `now` and `horizonDays`; determinism
    (same input twice → deep-equal output).
- **`test/lib/db/forecast.test.ts`:** where-shapes of both queries (active-only templates,
  archived-account exclusion on both reads, PENDING-only drafts), `Decimal` → `Number`
  magnitude mapping, `hasPendingDraft` derived from the `take: 1` sub-read, parallel
  composition.

`npm run test:run` and `npm run build` must pass before commit.

---

## 12. Implementation order

1. Constant (§5), then `src/lib/forecast.ts` engine + its suite (TDD-friendly, zero I/O).
2. `src/lib/db/forecast.ts` fetcher + suite.
3. `forecast-panel.tsx` (server component + module-private SVG).
4. Page wiring: `Promise.all` extension + in-process fold + render slot (§7).
5. Docs pass (§13), `npm run test:run` + `npm run build`, then manual browser pass on the
   `development` Neon branch (demo-pro seed + a hand-made template set): salary + rent +
   subscription templates produce the dip-then-recover shape; confirming a draft moves the line
   (day-0 event becomes ledger, projection re-anchors on the new hero balance); pausing a
   template removes its series; a user with no templates sees no card; a projected negative
   window renders the zero baseline + danger styling.

---

## 13. Docs to update when shipping

- [POST-MVP-ROADMAP.md](../POST-MVP-ROADMAP.md) — §18 shipped banner + Delivery Sequence row 14
  (next up: slot 15, Quick-Add Favorites §19) + Open question #10 (forecast half) resolved.
- [project-overview.md](../project-overview.md) — Dashboard feature note (the state screen
  gains the projected-balance card; still no analytics) — the "Dashboard is for state" principle
  is *upheld*, worth stating explicitly.
- `/help` — Dashboard/Recurring line: the projection only includes recurring templates and
  pending drafts you created; it assumes drafts get confirmed and never adds anything itself.
- `docs/current-feature.md` — history entry on completion, per the standard workflow.
