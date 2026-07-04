# Subscription Detection (heuristic v1) — Implementation Spec

> **Goal:** Spot regular spend the user is re-typing by hand — Netflix, rent, gym, salary — and
> **suggest** "make this a recurring template?" on `/recurring`. Pure heuristic, **no AI
> dependency**: group by normalized merchant, detect regular amount/interval patterns, and surface
> user-confirmed suggestions that pre-fill the existing template drawer. **Never auto-create** —
> `createTemplate` stays the sole writer.

Implements [POST-MVP-ROADMAP.md](../POST-MVP-ROADMAP.md) **§10 Subscription Detection — heuristic
first** (Delivery Sequence **slot 13** — the next unshipped slot; slots 1–12 are all shipped).
Branch: `feature/subscription-detection`. Follows the patterns in
[entity-crud-architecture.md](./entity-crud-architecture.md); the deterministic-facts approach
mirrors the shipped [smart-budget-suggestions-spec.md](./smart-budget-suggestions-spec.md), minus
the AI layer entirely.

---

## 0. Sequencing notes — read before building

- **This is the committed v1 scope: heuristic only, zero AI coupling.** The roadmap is explicit —
  *"do **not** reach for the model to ship v1."* No `runAiFeature`, no prompt, no `--color-ai`
  accent, no Pro gate (Delivery Sequence row 13: not Pro-gated). The optional v2 AI assist (fuzzy
  merchant normalization via the §3 foundation) is a separate, evidence-gated slice that only
  exists if v1's precision proves materially insufficient. If a reviewer finds an OpenAI import in
  this diff, the slice is off-spec.
- **The Pro Value Review checkpoint does not block this slice.** It gates §13 (AI expansion); §10
  v1 is a non-AI, non-Pro item and proceeds independently — same reasoning the §9 notifications
  spec recorded.
- **The roadmap's "gate on §0 showing users with enough history" is unmeasurable today** — §0's
  telemetry sink is still the no-op shim. The gate is therefore exercised the only way it can be:
  by the product owner scheduling this slot. The slice is cheap, deterministic, and ships
  instrumented (§11), so it generates its own keep/iterate/retire evidence for when §0 lands.
- **Precision over recall — the governing bias.** A missed subscription costs nothing (the user
  creates the template manually, today's flow). A false "make this recurring?" is noise, and
  recurring noise is nagging — off-brand for a "clarity, not optimization" product. Every
  threshold below is tuned strict; loosening is an iterate-phase decision made on telemetry,
  never a build-phase guess.

---

## 1. Why this slice

The `merchant` field was added to `Transaction` as future-proofing **for exactly this feature**
(project-overview: *"Merchants are optional metadata on transactions, future-proofing subscription
detection"*). The model is ready; nothing reads the pattern yet.

The value chain it completes: a user who types "Netflix €12.99" every month has already done the
conscious-capture work three times — the app now knows enough to offer the *structure* (a
recurring template) that removes the typing while **keeping** the confirm moment (templates
produce drafts, drafts require confirmation). The suggestion is a bridge from the data layer to
the control layer, entirely on-thesis: the user confirms twice (accept the template, then confirm
each draft), and nothing is ever written silently.

It is also the first feature to *read* merchant data structurally — the payoff for stamping
`merchant: template.name` on confirmed drafts and for the import pipeline preserving merchant
text.

---

## 2. Scope

### In scope (heuristic v1 — the committed scope)

- A pure, deterministic **detection engine** (`src/lib/recurring-suggest.ts`): group candidate
  transactions by normalized merchant + type, classify interval regularity into WEEKLY/MONTHLY
  cadence bands, require amount regularity, recency, and a minimum-amount floor, rank and cap
  (§4).
- A **"Suggested" panel on `/recurring`** listing detected patterns — merchant, cadence chip,
  median amount, occurrence evidence — each with **Create template** (opens the existing
  `TemplateFormDrawer` pre-filled, unsaved) and **Dismiss** (§9).
- **Derivation on page load**, in-process, one bounded query — the same cron-free stance as
  `generatePendingDrafts` (§5).
- **One additive schema model** — `RecurringSuggestionMute` — so a dismissed merchant stays
  dismissed (§6). This is the slice's only migration.
- A behavior-preserving **normalizer extraction**: the import resolver's trim → collapse → NFC →
  lower pipeline moves to a shared `normalizeLabelKey` (`src/lib/text.ts`); `normalizeCatKey`
  delegates (§7.1).
- One new Server Action — `muteRecurringSuggestion` — idempotent, Zod-validated, shared by the
  accept and dismiss paths (§8).
- Acceptance telemetry through the existing no-op `track()` shim (§11).
- Vitest coverage for the detection engine, the extraction, the fetcher, and the action (§13).

### Out of scope (explicit)

- **No AI.** v2's fuzzy-merchant assist is a separate evidence-gated slice (§0).
- **No auto-creation of templates or transactions.** The suggestion pre-fills the drawer;
  `createTemplate` remains the sole writer — the same sole-writer contract every AI slice honored.
- **No Pro gate** (Delivery Sequence row 13) and **no rate limit** (derivation is a page-load
  read; the mute action is a trivial auth-guarded upsert — matches `loadMoreTransactions`'
  no-limit stance).
- **No scheduled/batched run, no cron.** Lazy compute on `/recurring` load, exactly like draft
  generation. If detection cost ever matters, the escalation path is a leaner query — not a
  scheduler.
- **No DAILY or YEARLY detection in v1.** Daily same-merchant spend is a habit (coffee), not a
  subscription — suggesting a template for it is noise. Yearly needs ≥ 3 occurrences = 2+ years
  of history, which no user has this early; deferred, not forgotten (§15).
- **No notification-bell integration.** The §9 spec explicitly listed "subscription hints" as a
  non-goal there; the panel on `/recurring` is the surface. Revisit only if telemetry shows the
  panel is missed.
- **No mute-management UI.** A dismissed merchant is not resurrectable in v1 — the cost is that
  the user creates that template manually (today's flow, zero regression). A "muted suggestions"
  list on `/settings` is a cheap follow-up if ever requested (§15).
- **No account scoping.** Detection reads all active accounts, ignoring `?account=` — a
  subscription is a property of the user's ledger, not of the current view filter (same stance as
  budgets and the notification bell).

---

## 3. Candidate rows — exact query contract

Detection reads one bounded window of ledger rows (the *candidate set*). A row qualifies iff
**all** of:

| Rule | Predicate | Why |
|---|---|---|
| Real ledger entry | `deletedAt: null` | soft-deleted rows are invisible everywhere |
| Has a merchant | `merchant: { not: null }` + non-blank after trim | the grouping key; no merchant → no pattern |
| Income or expense | `type: { in: ["INCOME", "EXPENSE"] }`, `isTransferLeg: false` | transfers aren't spend; salary (INCOME) is a first-class pattern |
| Not already templated | `recurringTemplateId: null` | rows born from confirmed drafts are already structured |
| Active account | `financialAccount: { isArchived: false }` | archived accounts can't receive transactions, so a template against one is un-confirmable |
| In the lookback window | `date: { gte: lookbackStart }` — `SUBSCRIPTION_LOOKBACK_MONTHS = 12` before `now` | bounds the query; a year comfortably covers weekly + monthly patterns |

Selected columns only: `merchant`, `amount`, `type`, `date`, `categoryId`,
`financialAccountId` — ordered `date: "asc"` so the pure engine never re-sorts. No `Decimal`
crosses the pure boundary: the fetcher maps `amount` to `Math.abs(Number(amount))` (detection
cares about magnitudes; sign is already encoded in `type`).

Splits and tags are irrelevant here by construction — detection reads the parent row's amount and
merchant only.

---

## 4. Detection rules — the deterministic engine

> All thresholds are named constants (§7.2). Identical input → identical output (same
> determinism contract as `buildBudgetSuggestionFacts`): fixed ranking, fixed tie-breaks, no
> randomness, injectable `now`.

### 4.1 Grouping

Group candidates by **`(normalizeLabelKey(merchant), type)`**. The normalizer is the import
resolver's exact pipeline (trim → collapse internal whitespace → Unicode NFC → lowercase), so
`"  NETFLIX "`, `"netflix"`, and an NFC/NFD-divergent variant land in one group. Including `type`
in the key keeps a merchant's refund (INCOME) from polluting its charge pattern (EXPENSE).

### 4.2 Pattern test — a group is a suggestion iff all six hold

1. **Enough occurrences.** `count >= SUBSCRIPTION_MIN_OCCURRENCES` (**3**) — i.e. at least two
   intervals. Two data points make a coincidence, not a pattern.
2. **A cadence band fits.** Compute consecutive day-gaps from the date-ascending rows (dates are
   `@db.Date` UTC midnights, so gaps are exact integers). The **median gap** selects the candidate
   band from `SUBSCRIPTION_CADENCE_BANDS` — WEEKLY 6–8 days, MONTHLY 26–35 days. Median outside
   every band → no suggestion.
3. **Every interval fits the band.** All gaps within `[minDays, maxDays]` of the selected band —
   no outlier allowance in v1. A same-day duplicate charge (gap 0) or an interleaved one-off
   purchase at the same merchant breaks the chain and correctly kills the suggestion
   (precision-first; the known cost is recall on merchants that mix subscription + ad-hoc spend,
   e.g. Amazon — accepted, revisit on telemetry, §15).
4. **Amounts are regular.** Every magnitude within `± SUBSCRIPTION_AMOUNT_TOLERANCE` (**0.15**,
   relative) of the group's **median magnitude**. Tight enough to exclude groceries; loose enough
   to admit mildly varying utility bills — which are *good* template candidates (the feature is
   "make this a recurring template", not literally "find subscriptions").
5. **The series is alive.** The gap from the **last occurrence to `now`** must be
   `<= maxDays × SUBSCRIPTION_STALE_FACTOR` (**1.5**) for the selected band (monthly ≈ 52 days,
   weekly ≈ 12). A subscription cancelled months ago must not be suggested.
6. **The money matters.** The group's **median magnitude** must be
   `>= SUBSCRIPTION_MIN_AMOUNT` (**€5**) — the same noise-floor philosophy as
   `BUDGET_SUGGEST_MIN_MEDIAN` and `REVIEW_MIN_MOVER_DELTA`: a €1.50 weekly parking fee that
   passes every regularity test is still not worth a template nudge. **Documented trade:**
   micro-subscriptions (iCloud €0.99) fall below the default floor — deliberate, since noise
   risk dominates at small amounts; the constant is the tuning knob if telemetry ever shows
   real micro-sub demand.

### 4.3 Suppression — when a matching group still doesn't surface

- **An existing template already covers it:** the group's merchant key equals
  `normalizeLabelKey(template.name)` for any of the user's templates (active *or* paused —
  paused is a deliberate user state, not an invitation to re-suggest). This catches manually
  created templates whose historical rows predate them (those rows carry no
  `recurringTemplateId`).
- **The user muted it:** a `RecurringSuggestionMute` row exists for `(userId, merchantKey)` (§6).

### 4.4 Suggested template values (all deterministic)

| Field | Rule |
|---|---|
| `name` | the **most recent** occurrence's raw merchant string (preserves the user's casing) |
| `type` | the group's type |
| `amount` | **median** magnitude, `round2`-ed (consistent with budget-suggest's median philosophy — resistant to a one-off promo price) |
| `cadence` | the selected band's cadence |
| `financialAccountId` | the most recent occurrence's account (subscriptions occasionally migrate cards; the newest row is the live one) |
| `categoryId` | the **mode** of the group's `categoryId`s; tie → the most recent row's; may be `null` |
| `nextOccurrence` | `advanceNextOccurrence(lastDate, cadence)` repeated **until `>= today`** (bounded — ≤ ~14 iterations from a 12-month lookback). Starting in the past would make `generatePendingDrafts` immediately mint "overdue" drafts for periods the user likely already entered manually — the suggestion must face forward. |

### 4.5 Ranking and cap

Rank by **median amount desc** (biggest money first — same rationale as budget-suggest's
average-desc), tie-break by merchant name ascending (case-insensitive). Cap at
`SUBSCRIPTION_SUGGEST_MAX = 5` — the panel is a nudge, not an inventory; anything below the cap
line surfaces on a later visit once the top ones are accepted or dismissed.

The **pre-cap qualifying count is preserved** on the result (`detectedCount`, §7.3) — the cap is
a display decision and must not blind telemetry to how much the heuristic actually finds (the
same pre-cap-counts rule the notifications payload codified).

---

## 5. Architectural decision — derive on page load, like draft generation

Three candidate homes for the computation:

1. **Scheduled/batched run** — the roadmap mentions it, but the app is deliberately cron-free
   (`generatePendingDrafts` runs on page load; rollover carry derives on read). A scheduler is an
   infra cliff this feature doesn't need.
2. **Lazy Server Action** (the notification-bell pattern) — right for a *decoration* that must
   never block paint on 10 pages. Wrong here: suggestions are **page content of `/recurring`**,
   one page, already `force-dynamic` with a parallel fetch block.
3. **In-process at page load (chosen):** `getRecurringSuggestions(userId)` joins the existing
   `Promise.all` on `/recurring`. One bounded query + pure in-process math; at MVP volumes
   (≤ 10K tx/user, 12-month window) this is noise next to the fetches already on that page.

**Freshness contract:** recomputed per navigation (the page is `force-dynamic`). Accept/dismiss
call `router.refresh()` via the existing patterns, so the panel updates immediately. No caching,
no invalidation wiring.

---

## 6. The one schema change — `RecurringSuggestionMute`

**Why persistence is justified here when §9 refused it:** the notification panel's items resolve
*on their pages* — acting on the entity removes the item, so no dismissal state was needed. A
false-positive suggestion has **no resolution path**: the historical transactions that form the
group are permanent, correct ledger rows the user will never delete. Without a stored mute,
"Rent — make it recurring?" reappears on every `/recurring` visit for a user who deliberately
wants rent untemplated. That is nagging, and nagging is the one failure mode the roadmap names
for adjacent features. A mute is **user intent**, not derived state — the same class of fact as
`Budget.rollover`.

```prisma
// ─── RecurringSuggestionMute ──────────────────────────
// "Stop suggesting this merchant as a recurring template." Written by both
// suggestion outcomes (accept and dismiss — §9); read only by suggestion
// suppression. merchantKey is the normalized form (normalizeLabelKey).

model RecurringSuggestionMute {
  id          String   @id @default(cuid())
  merchantKey String
  createdAt   DateTime @default(now())

  userId String

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, merchantKey])
}
```

- `User` gains `recurringSuggestionMutes RecurringSuggestionMute[]`.
- The composite unique doubles as the per-user lookup index (leftmost-prefix) — no separate
  `@@index([userId])`.
- Migration: `prisma migrate dev --name add_recurring_suggestion_mutes` — purely additive, no
  existing table touched, applied to the `development` Neon branch first per the database rule.
- Growth is bounded by distinct merchants per user; no purge policy needed.

---

## 7. Pure logic

### 7.1 Normalizer extraction (`src/lib/text.ts`) — behavior-preserving

The merchant key must use the **same** normalization as category resolution — inventing a second
"almost the same" pipeline is how two surfaces drift. Extract, don't duplicate (the
`budgetRiskLevel` / `numeric-guard.ts` precedent):

```ts
// src/lib/text.ts (new)
/** Normalize a user-entered label to its match key:
 *  trim → collapse whitespace runs → Unicode NFC → lowercase. */
export function normalizeLabelKey(name: string): string { ... }
```

`normalizeCatKey` (`src/lib/import/resolve.ts`) becomes a one-line delegate (kept exported —
call sites and its doc-comment contract are untouched). **Proof obligation:** the existing
`test/lib/import/*` suites pass **unmodified**.

### 7.2 Constants (`src/lib/system-constants.ts` — detection policy is system-level tuning)

```ts
/* ── Subscription detection (heuristic v1, subscription-detection spec §4) ── */

/** Months of history scanned for recurring-spend patterns. */
export const SUBSCRIPTION_LOOKBACK_MONTHS = 12;

/** Min occurrences of a merchant before a pattern is considered (≥ 2 intervals). */
export const SUBSCRIPTION_MIN_OCCURRENCES = 3;

/** Cadence bands: the median day-gap picks the band; every gap must fit it.
 *  DAILY (habit, not subscription) and YEARLY (needs 2+ years of history)
 *  are deliberately absent in v1. */
export const SUBSCRIPTION_CADENCE_BANDS = [
  { cadence: "WEEKLY", minDays: 6, maxDays: 8 },
  { cadence: "MONTHLY", minDays: 26, maxDays: 35 },
] as const;

/** Max relative deviation of any amount from the group median. */
export const SUBSCRIPTION_AMOUNT_TOLERANCE = 0.15;

/** The series is stale (not suggested) when last-occurrence → now exceeds
 *  the band's maxDays × this factor. */
export const SUBSCRIPTION_STALE_FACTOR = 1.5;

/** Min median magnitude (EUR) for a group to be suggestible — filters
 *  micro-purchases that pass the regularity tests but aren't worth a nudge. */
export const SUBSCRIPTION_MIN_AMOUNT = 5;

/** Max suggestions surfaced per derivation — ranked median-amount desc. */
export const SUBSCRIPTION_SUGGEST_MAX = 5;
```

**Tunability contract:** these constants are the *only* place detection policy lives — the engine
never hardcodes a threshold, so recalibrating on real telemetry (loosening the amount tolerance,
widening a band, raising the floor) is a one-file constants edit with **zero algorithm change**.
The engine additionally accepts the policy as an injectable parameter (§7.3), so tests exercise
threshold boundaries against explicit configs rather than mirroring whatever the constants
currently say.

### 7.3 Engine (`src/lib/recurring-suggest.ts`)

```ts
/** One detected pattern, drawer-prefill-ready. Serializable — no Prisma types. */
export interface RecurringSuggestion {
  /** Normalized merchant key — the mute/suppression identity. */
  merchantKey: string;
  /** Display name — most recent raw merchant casing. */
  name: string;
  type: RecurringType;
  amount: number;              // median magnitude, round2
  cadence: "WEEKLY" | "MONTHLY";
  nextOccurrence: string;      // "YYYY-MM-DD", ≥ today (§4.4)
  financialAccountId: string;
  categoryId: string | null;
  /** Evidence for the panel copy: "4 charges · last Jun 15". */
  occurrenceCount: number;
  lastDate: Date;
}

export function buildRecurringSuggestions(input: {
  rows: ReadonlyArray<{
    merchant: string;
    amount: number;            // positive magnitude (fetcher maps abs)
    type: RecurringType;
    date: Date;
    categoryId: string | null;
    financialAccountId: string;
  }>;                          // date-ascending (query contract, §3)
  templateNames: ReadonlyArray<string>;  // raw names; engine normalizes
  mutedKeys: ReadonlySet<string>;        // already-normalized keys
  now?: Date;                  // injectable for tests; defaults to new Date()
  /** Detection policy — defaults to the §7.2 constants. Injectable so tests
   *  pin boundaries explicitly and a future per-user/experimental tuning has
   *  a seam (the budget-suggest D12 "window-agnostic" pattern). */
  config?: SubscriptionDetectionConfig;
}): RecurringSuggestionsResult

/** Engine output — mirrors the notifications payload's pre-cap-counts rule. */
export interface RecurringSuggestionsResult {
  /** Ranked + capped, panel-ready (§4.5). */
  suggestions: RecurringSuggestion[];
  /** Qualifying groups after suppression, BEFORE the display cap — the
   *  telemetry denominator for detected-vs-surfaced (§11). Invariant (tested):
   *  suggestions.length === min(detectedCount, SUBSCRIPTION_SUGGEST_MAX). */
  detectedCount: number;
}

/** The §7.2 knobs as one shape: minOccurrences, cadenceBands, amountTolerance,
 *  staleFactor, minAmount, suggestMax. `SUBSCRIPTION_DETECTION_DEFAULTS` is
 *  assembled from the constants and used when `config` is omitted. */
export interface SubscriptionDetectionConfig { ... }
```

Responsibilities (all unit-tested, §13): group by `(key, type)` → apply the six-rule pattern
test (§4.2) → suppress (§4.3) → derive values (§4.4) → rank + cap (§4.5). Internal structure
mirrors the notifications builder: small module-private helpers per stage (`classifyCadence`,
`isAmountRegular`, `isStale`, `resolveSuggestedCategory`) assembled by one exported function —
each rule stays individually reasoned but tested through the builder's output. Reuses
`advanceNextOccurrence` (`src/lib/recurring.ts`) and `round2` (`src/lib/money.ts`); no new date
math, no `Decimal`.

---

## 8. DB layer + action

### 8.1 Fetcher (`src/lib/db/recurring-suggest.ts`, `server-only`)

```ts
export async function getRecurringSuggestions(
  userId: string,
  now: Date = new Date()
): Promise<RecurringSuggestionsResult> {
  const [rows, templates, mutes] = await Promise.all([
    /* candidate query per §3, select-only, date asc, abs-mapped amounts */,
    prisma.recurringTemplate.findMany({ where: { userId }, select: { name: true } }),
    prisma.recurringSuggestionMute.findMany({ where: { userId }, select: { merchantKey: true } }),
  ]);
  const result = buildRecurringSuggestions({ rows, templateNames, mutedKeys, now });
  // track("recurring_suggested", …) when result.detectedCount > 0 — §11
  return result;
}
```

Follows the `deriveNotifications` shape: composition only, injectable `now`, all Prisma access
behind `server-only`, `userId`-scoped everywhere. The telemetry emit lives here (not in the
page) so any future caller of the fetcher inherits the impression event.

### 8.2 Action (`src/actions/recurring.ts` — extend, don't add a file)

```ts
/** Record "stop suggesting this merchant" — shared by accept + dismiss (§9). */
export async function muteRecurringSuggestion(input: {
  merchantKey: string;
  outcome: "accepted" | "dismissed";
  cadence: "WEEKLY" | "MONTHLY";   // telemetry only — never stored
}): Promise<MutationResult>
```

- Auth-guarded; Zod schema (`muteSuggestionSchema` in `src/lib/validations/recurring.ts`):
  `merchantKey` trimmed, `min(1)`, `max(MERCHANT_MAX)`; `outcome`/`cadence` enums.
- The server **re-normalizes** the key through `normalizeLabelKey` before writing — canonical
  storage is guaranteed server-side, never trusted from the client.
- Write is an **idempotent upsert** on `@@unique([userId, merchantKey])` — double-clicks and the
  accept-then-dismiss race are no-ops.
- Emits `recurring_suggestion_accepted` / `recurring_suggestion_dismissed` (§11), then
  `revalidatePath("/recurring")`.
- **No rate limit** (see §2), standard `{ success, error? }` result.

---

## 9. UI

### 9.1 Panel (`src/components/recurring/suggestions-panel.tsx`, client)

Rendered by `RecurringView` **above `TemplatesList`** (and above `RecurringEmptyState` in the
empty case — a user who just imported a year of history has zero templates and the strongest
suggestions; same placement logic as the budget-suggest panel over the `/budgets` empty state).
Renders **nothing** when the list is empty — silence means nothing to act on (insights-strip
precedent). Plain surface styling (`bg-surface`, `border-line`) — **no `--color-ai` accent**;
that color is reserved for AI affordances and this is deterministic math.

Each row: merchant name + cadence chip (`Weekly` / `Monthly` via `formatCadence`) + median amount
(`formatCurrency`) + evidence line (`"4 charges · last Jun 15"` from `occurrenceCount` /
`lastDate`) + two actions:

- **Create template** — opens the existing `TemplateFormDrawer` pre-filled and **unsaved**; the
  user reviews every field and saves through the unchanged `createTemplate`.
- **Dismiss** (quiet `X`) — fires `muteRecurringSuggestion(…, outcome: "dismissed")`, then
  `router.refresh()`.

### 9.2 Drawer prefill (`template-form-drawer.tsx` — additive prop)

`TemplateFormDrawer` gains an optional `prefill?: RecurringSuggestion | null` prop. In the
open-effect's create branch, `prefill` (when present) seeds `name` / `type` / `amount` /
`cadence` / `nextOccurrence` / `accountId` / `categoryId` instead of the blank defaults —
nothing else in the drawer changes; edit mode is untouched. `RecurringView`'s `DrawerState`
carries the selected suggestion alongside `editId`.

### 9.3 Accept must also mute — the rename edge

Suppression-by-template-name (§4.3) breaks if the user renames the template in the drawer before
saving ("NETFLIX.COM" → "Netflix") — the group would resurface as a duplicate suggestion next
visit. So the accept path **also writes the mute**: on the drawer's save-success callback for a
suggestion-born create, the panel fires `muteRecurringSuggestion(…, outcome: "accepted")`
(fire-and-forget; idempotent). Both outcomes converge on the same row — the mute means "stop
suggesting this merchant," whatever the reason — and the accepted/dismissed distinction lives
only in telemetry. Template-name suppression stays as belt-and-braces for templates that predate
this feature.

---

## 10. Page wiring (`src/app/recurring/page.tsx`)

`getRecurringSuggestions(userId)` joins the existing `Promise.all`; the page destructures
`suggestions` from the result (`detectedCount` is telemetry-only and stays server-side) and
threads it into `RecurringView`. The `Suspense` key extends to include `suggestions.length` so accept/dismiss
re-suspend cleanly after `router.refresh()` — same mechanism the page already uses for
templates/drafts. `generatePendingDrafts` ordering is unaffected (suggestions don't read drafts).

---

## 11. Telemetry (through the existing no-op `track()` shim)

| Event | Emitted by | Props (counts/enums only — **no merchant names, no amounts**) |
|---|---|---|
| `recurring_suggested` | `getRecurringSuggestions` (when ≥ 1 detected) | `{ detected, surfaced, weekly, monthly }` — pre-cap qualifying count, capped panel count, per-cadence surfaced counts |
| `recurring_suggestion_accepted` | `muteRecurringSuggestion` | `{ cadence }` |
| `recurring_suggestion_dismissed` | `muteRecurringSuggestion` | `{ cadence }` |

Three engagement measures fall out of this, no extra plumbing:

- **Acceptance rate** = accepted / (accepted + dismissed) — the number the roadmap's
  expand/iterate/retire rubric consumes, and the input to the v2-AI-assist gate ("only if v1's
  heuristic precision is materially insufficient").
- **Shown-but-ignored.** Derivation only runs on a `/recurring` page view, so every
  `recurring_suggested` event **is** an impression of the panel. Repeated impressions with no
  accept/dismiss outcome = the user is seeing suggestions and walking past them — the strongest
  signal that the heuristic's *relevance* (not just its precision) is off. Measured as outcome
  events over impression events per user window; no per-item identity needed.
- **Per-cadence quality.** The per-cadence impression counts give each `cadence`-tagged outcome
  its own denominator, so a weak WEEKLY band can be diagnosed (and tuned via §7.2) independently
  of MONTHLY.
- **Cap pressure.** `detected` vs `surfaced` shows how much the heuristic finds beyond what the
  panel shows. A persistent gap means `SUBSCRIPTION_SUGGEST_MAX` is throttling real signal (raise
  it, or paginate); `detected` flatlining near zero across users is the tune-the-thresholds
  signal instead. Without the pre-cap number these two situations are indistinguishable.

Per-suggestion identity (e.g. a hashed merchant key) was considered for finer ignore-tracking and
rejected: hashes of low-entropy merchant names are trivially reversible, and the aggregate
ratios above already answer the keep/iterate/retire question. Merchant strings are quasi-PII and
never leave the app — consistent with the shim's contract.

---

## 12. Edge cases & rules

- **Merchant-less ledgers** (user never fills merchant) → zero candidates → panel absent. No
  nudge to "add merchants" in v1 — that's copy speculation.
- **Same-day duplicate charges** → 0-day gap → band test fails → no suggestion (correct: that
  merchant's pattern is ambiguous).
- **Price change mid-series** (Netflix €10.99 → €12.99, ~18% jump) → amount test fails → not
  suggested *yet*; once the new price accumulates 3 occurrences inside the window it qualifies.
  Accepted v1 behavior — a tolerance-vs-recency trade documented for the iterate phase.
- **28/29/30/31-day months** — the MONTHLY band (26–35) absorbs calendar drift and the ±2-day
  card-processor jitter real subscriptions show.
- **Mixed accounts in one group** — allowed (card switches happen); the suggested account is the
  most recent occurrence's, which is active by the §3 filter.
- **Uncategorized groups** — `categoryId: null` flows through to the drawer's "Uncategorized"
  default; never blocks a suggestion.
- **Micro-subscriptions** (iCloud €0.99/mo) — perfectly regular but below the
  `SUBSCRIPTION_MIN_AMOUNT` floor → not suggested by default (§4.2 rule 6). The knob exists if
  telemetry ever shows demand; manual template creation is unaffected either way.
- **A muted merchant re-subscribed later** — stays muted (v1 has no unmute; §2). Manual template
  creation is unaffected.
- **Import interplay** — a fresh `/import` of a year of history is the best-case input; detection
  reads imported rows like any others (they carry merchant text and no `recurringTemplateId`).
- **EUR-only** — amounts are compared as raw magnitudes; currency mixing is impossible in the
  shipped app and the engine takes no currency input.

---

## 13. Testing (Vitest — pure logic, fetcher, action; components out of scope per standards)

- **`test/lib/text.test.ts`:** `normalizeLabelKey` — trim, collapse, NFC (composed/decomposed
  `café` converge), lowercase. **Existing `test/lib/import/*` suites pass unmodified**
  (extraction proof, §7.1).
- **`test/lib/recurring-suggest.test.ts`** (the bulk): grouping merges casing/whitespace/NFC
  variants and splits by type; `< 3` occurrences → nothing; median-gap band selection; one
  out-of-band gap kills the group; amount tolerance boundary (exactly 15% passes, above fails);
  staleness boundary per band; **min-amount floor boundary** (median exactly at
  `SUBSCRIPTION_MIN_AMOUNT` passes, below fails); **config injection** (a custom
  `SubscriptionDetectionConfig` overrides every threshold; omitted config uses the constants);
  suppression by template name (normalized, paused included) and by
  muted key; suggested values — median amount `round2`, mode category with recency tie-break,
  most-recent account/name-casing, `nextOccurrence` advanced past `today` (multi-step when the
  last charge is months old, month-end clamping via `advanceNextOccurrence` inherited); ranking
  (amount desc, name-asc tie-break) and the `SUBSCRIPTION_SUGGEST_MAX` cap; the **result
  invariant** — `detectedCount` is the pre-cap qualifying count and
  `suggestions.length === min(detectedCount, SUBSCRIPTION_SUGGEST_MAX)` (suppressed groups never
  counted); injectable `now`; determinism (same input twice → deep-equal output).
- **`test/lib/db/recurring-suggest.test.ts`:** where-shape of the candidate query (all six §3
  predicates), `Decimal` → abs-number mapping, parallel composition of the three reads, engine
  fed with normalized inputs.
- **`test/actions/recurring.test.ts` (extend):** `muteRecurringSuggestion` — unauthenticated →
  failure; invalid input → failure; server-side re-normalization of a raw key before upsert;
  idempotent double-call; one telemetry event per call with the matching outcome name.

`npm run test:run` and `npm run build` must pass before commit.

---

## 14. Implementation order

1. Migration `add_recurring_suggestion_mutes` (+ Prisma client regen) — smallest reviewable unit.
2. `normalizeLabelKey` extraction + its tests; run the import suites untouched (proof).
3. Constants (§7.2), then `src/lib/recurring-suggest.ts` engine + its suite (TDD-friendly,
   zero I/O).
4. `src/lib/db/recurring-suggest.ts` fetcher + suite.
5. `muteRecurringSuggestion` action + validation + action tests.
6. UI: `suggestions-panel.tsx`, `TemplateFormDrawer` `prefill` prop, `RecurringView` wiring,
   page `Promise.all`.
7. Docs pass (§16), `npm run test:run` + `npm run build`, then manual browser pass on the
   `development` Neon branch (demo-pro's seeded history plus a hand-made monthly series):
   pattern surfaces with correct cadence/amount/evidence; accept pre-fills the drawer and the
   saved template both appears in the list and removes the suggestion; rename-then-save still
   removes it (the §9.3 mute); dismiss removes it and it stays gone across reloads; a one-off
   purchase inserted into a clean series stops the suggestion.

---

## 15. Decision log

### Resolved (baked into this spec)

- **Heuristic only; AI assist deferred to an evidence-gated v2** (§0) — the roadmap's committed
  scope, verbatim.
- **Lazy compute on `/recurring` page load** — the roadmap's own alternative to a scheduled run;
  matches the app's cron-free stance (`generatePendingDrafts` precedent) (§5).
- **Suggestion pre-fills the existing drawer; `createTemplate` stays the sole writer** — the
  confirm moment is kept twice over (accept the template, then confirm each draft) (§9).
- **Persistent mutes via one additive `RecurringSuggestionMute` model** — a false positive has no
  resolution path, so "not a subscription" is user intent that must persist; session-only
  dismissal would nag (§6).
- **Accept also mutes** — both outcomes converge on one idempotent row; suppression never depends
  on the user keeping the suggested name (§9.3).
- **WEEKLY + MONTHLY only in v1** — DAILY is habit noise, YEARLY is unobservable this early (§2).
- **Strict pattern test, no outlier allowance** — precision over recall throughout (§0, §4.2).
- **Minimum-amount floor (`SUBSCRIPTION_MIN_AMOUNT`)** — regularity alone doesn't earn a nudge;
  the median must clear a euro floor, mirroring `BUDGET_SUGGEST_MIN_MEDIAN` (§4.2 rule 6).
- **Detection policy is centralized and injectable** — all thresholds live in
  `system-constants.ts`, and the engine takes them as a defaulted `config` parameter; telemetry-
  driven recalibration is a constants edit, never an algorithm change (§7.2–§7.3).
- **The engine returns a result payload, not a bare array** — `detectedCount` preserves the
  pre-cap qualifying count so telemetry can distinguish "cap is throttling signal" from
  "heuristic finds nothing" (the notifications payload's pre-cap-counts rule, §4.5, §7.3, §11).
- **Median for the suggested amount**, mode-with-recency-tie-break for category, most-recent row
  for name casing and account (§4.4).
- **`nextOccurrence` always lands ≥ today** — a suggestion must not open with an overdue-draft
  backlog (§4.4).
- **One shared normalizer** (`normalizeLabelKey`), extracted behavior-preserving from the import
  resolver (§7.1).
- **Not Pro-gated, no rate limit, no account scoping, no `--color-ai`** (§2, §9.1).

### Rejected (considered, decided against — with the evolution seam named)

- **One-tap create (skip the drawer).** Faster, but a template has seven fields the heuristic only
  *estimates* (the account and category picks are heuristics of heuristics). Budget-suggest could
  one-tap because a budget is one editable number; a template is not. **Seam:** if telemetry shows
  near-zero drawer edits before save, a one-tap path calling the same `createTemplate` is purely
  additive.
- **Confidence scores on suggestions.** The six-rule gate is already binary-strict; a score would
  imply ranking-by-trust the v1 data can't honestly support. **Seam:** the engine's per-rule
  helpers make a scored relaxation (e.g. "allow one outlier gap at lower confidence") a contained
  iterate-phase change.
- **Grouping by `(merchant, account)`.** Splitting by account breaks the interval chain the month
  a user switches payment cards — exactly when the suggestion is most useful. Account is an
  output (most recent), not a key (§4.4).
- **Storing detection results.** Derivation is cheap and always fresh; persisting suggestions
  would need lifecycle/invalidations for zero user-visible gain. Only the *mute* is stored —
  minimum-viable persistence.

### Deferred (known tradeoffs, not oversights)

- **YEARLY detection** — needs ≥ 2 years of history; revisit once real accounts age past that.
- **v2 AI merchant normalization** (§3 foundation) — only if telemetry shows normalization misses
  (same merchant, different strings) are materially costing precision/recall.
- **Mute management ("Muted suggestions") on `/settings`** — the restore path for a dismissed
  merchant. Deliberately kept out of v1 (the workaround is manual template creation — today's
  flow, zero regression), but the follow-up is fully unlocked by this slice's data model:
  **zero migration** — a `getMutes` fetcher, an `unmuteRecurringSuggestion` delete action, and a
  small card next to Tags/Categories (the `manage-tags.tsx` shape). Build it on the first real
  user request rather than speculatively.
- **Outlier-tolerant interval matching** (one skipped/extra charge, e.g. a missed month or an
  interleaved one-off purchase) — the main recall lever. **Explicit iterate trigger:** telemetry
  shows healthy engagement on what *is* surfaced (good acceptance rate) but low impression counts
  (`recurring_suggested` rarely fires / low `count`) — i.e. the gate is right about what it
  passes but too strict about what it rejects. The change is contained to `classifyCadence`
  behind the §7.3 config seam (e.g. an `allowedOutliers` knob defaulting to 0).
- **Notification-bell "new suggestion" item** — would need cross-surface plumbing the §9 spec
  deliberately excluded; revisit only if the panel proves easy to miss.

---

## 16. Docs to update when shipping

- [POST-MVP-ROADMAP.md](../POST-MVP-ROADMAP.md) — §10 shipped banner + Delivery Sequence row 13.
- [project-overview.md](../project-overview.md) — graduate *"Subscription detection via
  recurring-spend clustering"* out of the Out-of-Scope list (heuristic suggest-and-confirm shipped;
  silent auto-creation remains out) + a Recurring Templates feature note.
- `/help` — Recurring section line: Spendly may suggest a template when it notices a regular
  charge; suggestions never create anything by themselves.
- `docs/current-feature.md` — history entry on completion, per the standard workflow.
