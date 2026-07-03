# In-App Notifications — Implementation Spec

> **Goal:** Extend the dashboard insights strip into an app-wide **notification bell + panel** in the
> topbar — a persistent, always-reachable answer to "is there anything that needs me?" — while staying
> strictly on the **derive-first** rung of the escalation ladder: no `Notification` table, no
> read/unread state, no dismissal history, no email/push.

Implements [POST-MVP-ROADMAP.md](../POST-MVP-ROADMAP.md) **§9 In-App Notifications** (Delivery
Sequence **slot 12** — the next unshipped slot; slots 1–11 are all shipped). Branch:
`feature/in-app-notifications`. Follows the patterns in
[entity-crud-architecture.md](./entity-crud-architecture.md) and builds directly on the shipped
[dashboard-insights-strip-spec.md](./dashboard-insights-strip-spec.md).

---

## 0. Sequencing notes — read before building

- **The Pro Value Review checkpoint does not block this slice.** The checkpoint sits between slots
  11 and 12 in the Delivery Sequence, but it is a product-owner gate on **AI expansion** (it gates
  §13, "speculative AI expansion"). §9 is a non-AI, non-Pro item and proceeds independently. The
  checkpoint itself is not buildable — it needs §0 telemetry data that doesn't exist yet.
- **Derive-first is the committed default, not a recommendation.** The roadmap is explicit: a
  persisted `Notification` model (read/unread, dismissal history, lifecycle) is **not built unless
  §0 evidence proves it's needed**. This spec must not introduce persistence through the back door
  (no localStorage read-state, no user-preference column, no "seen" cookie). If a reviewer finds
  any stored notification state in the diff, the slice is off-spec.
- **The topbar mockup's "no bell" note is superseded here.** [project-overview.md](../project-overview.md)
  says *"No bell icon — notifications are post-MVP"*; the roadmap §9 says *"this is where that's
  revisited."* This slice is that revisit — update the overview's topbar description when shipping
  (§16).

---

## 1. Why this slice

The dashboard insights strip already surfaces the three actionable signals (budgets at risk,
pending recurring drafts, overdue goals) — but **only on `/dashboard`**. A user working in
`/transactions` or `/reports` has no way to notice a draft came due or a budget tipped over
without navigating home. The signals, the rules that define them, and the revalidation wiring all
exist; what's missing is an **app-wide surface**.

This slice adds a bell in the topbar (present on every `AppShell` page) opening a panel of
**per-entity, derived, link-out items** — richer than the strip's aggregate pills ("Groceries is
at 92%" instead of "3 budgets at risk") but built from the same single-sourced rules, so the two
surfaces can never disagree.

It is also the **evidence generator** for its own future: the roadmap gates notification
persistence (rung 2 of the ladder) on proof that users engage with derived notifications. This
slice emits engagement telemetry through the existing `track()` shim so that when §0 wires a real
sink, the rung-2 decision has data from day one.

---

## 2. Scope

### In scope (rung 1 of the escalation ladder — derive-first, nothing else)

- A **notification bell** in the topbar (right of the account selector) with a count badge
  (suppressed at 0), opening a right-aligned **popover panel** — same interaction pattern as the
  existing account-selector dropdown.
- **Per-entity derived items** for the three existing signal domains, plus the over-budget
  severity split the insights spec deferred (§15 there): over-budget budgets (danger), at-risk
  budgets (warning), pending recurring drafts (info), overdue goals (warning). Each item links to
  its page.
- A channel-agnostic derivation service (`deriveNotifications`, `server-only`) fronted by a
  read-only Server Action `getNotifications()` that derives items on demand — **no prop
  threading through the 10 `AppShell` pages** (§4, §9).
- Pure builder + types + constants; a small behavior-preserving extraction in `src/lib/insights.ts`
  so the at-risk rule stays defined exactly once (§8).
- Engagement telemetry through the existing no-op `track()` shim (§11).
- Vitest coverage for the pure builder, the extracted predicate, and the action.

### Out of scope (explicit — the upper rungs and adjacent temptations)

- **No persistence of any kind.** No `Notification` model, no migration, no read/unread, no
  dismissal state (server or client-side storage). Items disappear by being **resolved** (confirm
  the draft, raise the budget, fund the goal) — that is the "dismiss" mechanism, and it's on-thesis.
- **No email, no push, no service workers.** Rung 3, explicitly "out of scope today" in the roadmap.
- **No tracking-consistency insight ("tracked 6 days running") in v1.** The roadmap allows it as an
  *opt-in* line, but opt-in requires a stored preference — which drags rung-2 persistence into a
  rung-1 slice. Deferred until a preferences surface exists (§15).
- **No changes to the insights strip.** The strip stays the dashboard's in-flow surface, untouched
  (three aggregate pills, no over-budget split there). The panel is the app-wide surface. They share
  rules, not markup.
- **No account scoping.** Items are all-active-accounts, matching the dashboard fetchers. The bell
  ignores `?account=`.
- **No draft generation.** The bell never calls `generatePendingDrafts` — same accepted staleness
  as the strip (insights spec §12.1); `/recurring` remains the authority.
- **No Pro gate.** Delivery Sequence row 12: not Pro-gated.
- **No new signals beyond the four item kinds above.** Anomaly detection, subscription hints,
  goal-pace nudges are other roadmap items (§10, §13).

---

## 3. Signals → items — exact definitions

> **Terminology:** the *signals* (domain rules) are unchanged and stay where they live today. This
> slice adds a new *rendered representation*: `NotificationItem` — per-entity, not per-count.

| Item kind | Definition | Rule source (unchanged) | Tone | Links to |
|---|---|---|---|---|
| `budget-over` | Current-month, non-archived budget with carry-aware `percent >= 100` | `budgetProgressWithCarry` via the extracted `budgetRiskLevel` (§8) | `danger` | `/budgets` |
| `budget-risk` | Same, with `percent >= 80` and `< 100` | same | `warning` | `/budgets` |
| `draft` | A `PENDING` recurring draft | `getPendingDrafts` (existing fetcher, existing `where`) | `info` | `/recurring` |
| `goal-overdue` | Active goal with `overdue === true` | `GoalRow.overdue`, stamped by `isGoalOverdue` at fetch time | `warning` | `/goals` |

**Label copy (English, sentence case, built in the pure builder — same rationale as the strip:
testable, out of JSX):**

- `budget-over` — `"{name} budget is over the limit"` (no percent — a blown ceiling is binary; the
  exact overshoot lives on `/budgets`).
- `budget-risk` — `"{name} budget at {percent}%"` (integer percent, `Math.round`).
- `draft` — `"{templateName} — draft pending"` with the suggested date as secondary detail text
  (e.g. `"Jun 28"`), overdue drafts first.
- `goal-overdue` — `"{name} goal is past its target date"`.

**Over/at-risk split — resolved.** The insights spec deferred *"promote ≥ 100% budgets to their own
danger-tone pill"* (§15 there) and pre-authorized the mechanics (§15.1 corollary 3: widening the
tone vocabulary is a UI-level change). This slice realizes the split **in the panel only**: the
panel is per-entity, so severity per row is free; the strip keeps its single "at risk" bucket and
its `"warning" | "info"` union untouched. The `danger` tone lives in the new
`NotificationItem` type, not in `InsightItem`.

**Ordering (fixed, defined once in the builder, never re-sorted by the component):**
`budget-over` (worst first by percent desc) → `budget-risk` (percent desc) → `draft`
(suggestedDate asc — oldest/most-overdue first) → `goal-overdue` (name asc). Severity, then
urgency, then alphabet. Mirrors the strip's "order is a single testable decision" rule.

**Per-kind cap.** Each kind renders at most `NOTIFICATION_GROUP_MAX = 5` items, followed by a
`"+N more →"` link-row to the kind's page. Keeps the panel a nudge surface, not a data table — the
canonical lists are the pages.

---

## 4. Architectural decision — lazy Server-Action fetch, not prop threading

The bell must exist on **every `AppShell` page** (`/dashboard`, `/transactions`, `/budgets`,
`/recurring`, `/goals`, `/accounts`, `/reports`, `/help`, `/trash`, `/import`). Two ways to feed it:

1. **Thread props:** each page fetches notification data in its `Promise.all` and passes it through
   `AppShell` → `Topbar` → bell. Cost: ~10 page files touched, 3 extra queries added to **every**
   page render *blocking first paint*, and every future `AppShell` page must remember the wiring —
   a standing tax.
2. **Lazy fetch (chosen):** the bell is a client component that calls a **read-only Server Action**
   (`getNotifications`) after mount. Cost: one deferred POST per shell mount; the badge appears a
   beat after paint.

**This spec chooses (2).** Precedents: `loadMoreTransactions` is an established read-only Server
Action; `AppShell` is rendered per-page (not a layout), so it remounts on navigation — giving
per-navigation freshness with zero cache-invalidation wiring. Notifications are a *nudge*, not
page content: they must never delay the page they decorate, and a badge that resolves ~100ms after
paint is imperceptible. Threading would also force pages that have nothing to do with signals
(`/help`, `/import`) to run budget/goal/draft queries before rendering static content.

**Freshness contract:** derive on mount (per navigation) **and re-derive when the panel opens**
(a click is an explicit "what needs me *now*"). No polling, no websocket, no revalidation coupling
— the action path bypasses the page cache entirely, so the `revalidatePath` web is irrelevant here.

---

## 5. File plan

| Layer | File | Action |
|---|---|---|
| Types | `src/types/notifications.ts` | **create** — `NotificationItem`, `NotificationKind`, `NotificationTone`, `NotificationsPayload` |
| Constants (UI) | `src/lib/constants.ts` | **modify** — `NOTIFICATION_GROUP_MAX = 5`, `NOTIFICATION_BADGE_MAX = 9` |
| Pure rule (extraction) | `src/lib/insights.ts` | **modify** — extract `budgetRiskLevel`; `countAtRiskBudgets` delegates to it (behavior-preserving) |
| Pure builder | `src/lib/notifications.ts` | **create** — `buildNotificationItems`, label/order/cap logic |
| Domain service | `src/lib/db/notifications.ts` | **create** — `server-only` `deriveNotifications(userId, now?)`: fetch + build, channel-agnostic (§9) |
| Action | `src/actions/notifications.ts` | **create** — thin: auth + `deriveNotifications` + telemetry; plus `trackNotificationEvent` |
| Component | `src/components/notifications/notification-bell.tsx` | **create** — client; bell + badge + popover panel |
| Topbar | `src/components/dashboard/topbar.tsx` | **modify** — mount `<NotificationBell />` right of the account selector |
| Tests | `test/lib/notifications.test.ts`, `test/lib/db/notifications.test.ts`, `test/lib/insights.test.ts` (extend), `test/actions/notifications.test.ts` | **create / extend** |

**No schema change, no migration, no new route, no new queries** — `deriveNotifications` composes
existing fetchers (`getBudgetsData`, `getPendingDrafts`, `getGoalsSummary`).

---

## 6. Types (`src/types/notifications.ts`)

```ts
export type NotificationKind = "budget-over" | "budget-risk" | "draft" | "goal-overdue";

/** Panel tones. Superset of InsightItem's — `danger` exists only here (§3). */
export type NotificationTone = "danger" | "warning" | "info";

/** One derived, per-entity row in the notification panel. */
export interface NotificationItem {
  /** Stable within one derivation, e.g. `budget-risk:<budgetId>`. Not persisted. */
  id: string;
  kind: NotificationKind;
  tone: NotificationTone;
  /** Primary copy, e.g. "Groceries budget at 92%". */
  label: string;
  /** Optional secondary line, e.g. a draft's suggested date. */
  detail?: string;
  /** True only for the synthetic "+N more →" row a capped kind emits (§8.2).
   *  Consumers branch on this flag — never on id naming conventions. */
  isOverflowRow?: boolean;
  href: string;
}

/** What `deriveNotifications` returns (and the action forwards to the bell). */
export interface NotificationsPayload {
  items: NotificationItem[];
  /** Pre-cap actionable-entity counts per kind. Lightweight metadata alongside
   *  the rendered items — telemetry and future UI variations (filters, grouped
   *  sections) read this without re-deriving or reparsing `items`. */
  counts: Record<NotificationKind, number>;
  /** Total actionable entities BEFORE per-kind caps — drives the badge.
   *  Invariant (tested): equals the sum of `counts` values. */
  totalCount: number;
}
```

> **`id` stability contract (normative).** `id` exists for React keys and click telemetry only.
> It is **unique within one payload and meaningless beyond it**: although the string happens to be
> deterministic (`kind:entityId`), the same entity can change id between derivations — a budget
> crossing 100% migrates from `budget-risk:<id>` to `budget-over:<id>` — and overflow rows reuse
> their group's kind with a `:more` suffix. Consumers must never use it as a cross-request
> identity, dedup key, or persistence key ("seen" tracking against these ids is rung-2
> persistence through the back door — §0). If rung 2 ever lands, notifications get a real stored
> identity; this field is not its precursor.

---

## 7. Constants (`src/lib/constants.ts`)

```ts
/** Max items rendered per notification kind before collapsing to a "+N more" link. */
export const NOTIFICATION_GROUP_MAX = 5;

/** Badge display cap — counts above render as "9+". */
export const NOTIFICATION_BADGE_MAX = 9;
```

Both are UI configuration → `constants.ts`, per the constants-split rule.
`BUDGET_AT_RISK_THRESHOLD` stays in `system-constants.ts`, untouched.

---

## 8. Pure logic

### 8.1 Extraction in `src/lib/insights.ts` (behavior-preserving)

The at-risk rule must stay defined **once**. Today it lives inline in `countAtRiskBudgets`; the
panel needs a *per-row, three-way* classification. Extract, don't duplicate (same pattern as the
`numeric-guard.ts` extraction in the §6 slice):

```ts
/** Carry-aware risk classification for one budget row. Single source of the
 *  at-risk threshold rule — countAtRiskBudgets and the notification builder
 *  both route through this. */
export function budgetRiskLevel(row: {
  spent: number;
  limit: number;
  carriedAmount?: number;
}): "over" | "at-risk" | null {
  const { percent } = budgetProgressWithCarry(row.spent, row.limit, row.carriedAmount ?? 0);
  if (percent >= 100) return "over";
  if (percent >= BUDGET_AT_RISK_THRESHOLD * 100) return "at-risk";
  return null;
}

export function countAtRiskBudgets(rows: ReadonlyArray<...>): number {
  return rows.filter((r) => budgetRiskLevel(r) !== null).length;
}
```

**Proof obligation:** the existing `test/lib/insights.test.ts` suite must pass **untouched**
(an "over" row still counts as at-risk in the strip's aggregate — `!== null` preserves the old
`percent >= 80` semantics exactly, including the `effectiveLimit ≤ 0 → 100%` edge that
`budgetProgressWithCarry` already owns).

### 8.2 Builder in `src/lib/notifications.ts`

```ts
buildNotificationItems(input: {
  budgets: ReadonlyArray<{ id; name; spent; limit; carriedAmount }>;
  drafts:  ReadonlyArray<{ id; templateName; suggestedDate /* display-ready */ }>;
  goals:   ReadonlyArray<{ id; name; overdue }>;
}): NotificationsPayload
```

Responsibilities (all unit-tested, §13): classify budgets via `budgetRiskLevel`, build labels,
apply the fixed ordering (§3), apply `NOTIFICATION_GROUP_MAX` per kind (emitting a synthetic
`"+N more →"` row — a normal `NotificationItem` carrying the group's `kind` and
**`isOverflowRow: true`**, with an `id` suffixed `:more` purely for React-key uniqueness; the
flag is the semantic marker, the id shape is incidental — so the component stays a dumb
renderer), and compute the **pre-cap** `counts` per kind plus `totalCount` (= their sum). Input
shapes are structural (narrow inline types), so the builder doesn't import DB row types — same
stance as `countAtRiskBudgets`.

**Internal structure — label formatting is separated from ordering/capping.** Each kind's copy
lives in its own small module-private helper (`budgetOverLabel`, `budgetRiskLabel`, `draftLabel`,
`overdueGoalLabel` — pure `(row) → string`), and `buildNotificationItems` only assembles: classify
→ label via the kind's helper → order → cap → count. Copy changes touch one helper; ordering/cap
changes never touch copy. The helpers stay module-private (tested through the builder's output,
§13 — no need to export four one-liners). This is also the localization seam: if i18n ever lands,
the four helpers become the single place that switches from English strings to translation keys +
params — same restructure path the insights spec (§15 there) prescribes for the strip's labels.

No `Decimal` crosses this boundary — inputs are the already-mapped, number-typed rows the
dashboard consumes today.

---

## 9. Derivation — a channel-agnostic domain service + a thin action

The derivation itself lives in a **`server-only` domain service**, not inside the Server Action.
The action is one delivery channel; the ladder's upper rungs are others (a rung-2 cron persisting
notifications, a rung-3 email digest). All of them must derive **identically**, so the fetch +
build composition is a plain function any server-side caller can use — never re-implemented per
channel:

```ts
// src/lib/db/notifications.ts — "server-only", like every src/lib/db module
export async function deriveNotifications(
  userId: string,
  now: Date = new Date()
): Promise<NotificationsPayload> {
  // month/year resolved from `now` — same resolution as the dashboard page
  const [budgets, drafts, goals] = await Promise.all([
    getBudgetsData(userId, month, year),   // rows carry spent/limit/carriedAmount
    getPendingDrafts(userId),              // existing ownership-scoped fetcher
    getGoalsSummary(userId),               // rows carry overdue
  ]);
  return buildNotificationItems({ budgets, drafts, goals });
}
```

> The injectable `now` exists for tests (month-boundary cases) and for future scheduled callers
> (a cron evaluates "as of" its tick). The default keeps every current call site zero-config.

The action is a **thin wrapper** — auth, telemetry, error shape, nothing else:

```ts
"use server";

export async function getNotifications(): Promise<
  { success: true; data: NotificationsPayload } | { success: false; error: string }
> {
  // auth() guard → session.user.id; unauthenticated → { success: false }
  // const payload = await deriveNotifications(userId);
  // track("notifications_derived", { total: payload.totalCount, ...payload.counts });
  // return { success: true, data: payload };
}
```

- **Read-only** — no `revalidatePath`, no writes, standard `{ success, data?, error? }` contract.
- **Reuses the dashboard fetchers verbatim.** `getBudgetsData` does more work than a count needs
  (icon resolution), but reuse keeps the numbers provably identical to the strip and the budgets
  panel — correctness over micro-optimization, and the derivation runs off the paint path (§4).
- **No rate limit.** Auth-guarded, read-only, self-throttled by UI (mount + open). Matches
  `loadMoreTransactions`. Do not add a `RATE_LIMITS` entry.
- `trackNotificationEvent` — see §11.

### 9.1 Performance profile (documented expectation, not a problem to pre-solve)

One derivation = **three parallel queries**, dominated by `getBudgetsData` (a spend `groupBy`
plus a rollover carry walk-back of up to `ROLLOVER_MAX_LOOKBACK_MONTHS` prior months per
rollover-on budget); the draft and goal reads are trivial. It runs **at most twice per
navigation** (mount + panel open) and never blocks paint. At MVP volumes (< 10K transactions per
user, single-digit budgets) this is noise — do not optimize speculatively.

If profiling ever flags it, the escalation path is ordered — take the cheapest rung that fixes
the measurement, in order: **(1)** a lean projection fetcher (the builder only reads structural
fields — drop the icon/color resolution `getBudgetsData` does for the panel UI); **(2)** split
the fetch — counts-only on mount (badge), full items only on open; **(3)** only then any
caching/memoization, which would need an invalidation story and starts to smell like rung-2
persistence. Never start at (3).

---

## 10. UI (`src/components/notifications/notification-bell.tsx` + topbar)

**Bell (client component, mounted in `Topbar` between the spacer and the account pill):**

- Lucide `Bell`, same 8×8 hit-target style as the mobile-menu button; `aria-label="Notifications"`,
  `aria-haspopup="dialog"`, `aria-expanded`.
- **Count badge**: small warning-tinted pill (top-right of the bell) showing `totalCount`, capped
  to `"9+"` via `NOTIFICATION_BADGE_MAX`. **Suppressed at 0** (same rule as the trash count badge
  — a zero badge is noise). The bell itself always renders — persistence is what makes it
  discoverable; the *badge* is the conditional part.
- Fetches via `getNotifications` in a mount effect; refetches on open (§4). A monotonic run-token
  guard (the `suggestRunRef` pattern from the AI drawers) discards stale responses if the shell
  remounts mid-flight. Fetch failure → no badge, empty-safe panel ("Couldn't load — try again")
  — the bell must never break the topbar.

**Panel (popover, same pattern as the account-selector dropdown — fixed click-away overlay +
absolutely positioned surface, `w-80`, right-aligned, `max-h` with internal scroll):**

- Flat ordered list of items; each row = tone-tinted dot/icon + label (+ `detail` line), the whole
  row a `next/link` navigating to `href` (closes the panel on click, fires click telemetry).
- Tone classes from a `TONE_CLASS: Record<NotificationTone, string>` lookup — `danger` →
  `text-danger`, `warning` → `text-warning`, `info` → `text-info`, on `/15` tinted backgrounds.
  Strictly semantic colors; no new tokens.
- **Calm state:** when `items` is empty the panel shows one quiet line — `"All caught up."` in
  `text-ink-2` — not an empty box. (Unlike the strip, the panel is *opened on demand*; answering
  "anything for me?" with an explicit "no" **is** the backing function.)
- No dismiss affordance, no "mark read", no per-item close buttons — resolution happens on the
  linked pages (§2). Mobile: same popover anchored to the topbar (the topbar renders on mobile);
  no bottom-sheet variant in v1.

---

## 11. Telemetry (through the existing no-op shim — the rung-2 evidence)

The escalation ladder makes persistence an **evidence-gated** decision; this slice plants the
evidence. Via `track()` (`src/lib/analytics/track.ts`, still a no-op until §0):

| Event | Emitted by | Props (counts/enums only — no names, no amounts) |
|---|---|---|
| `notifications_derived` | `getNotifications` action | `{ total, ...counts }` — spread straight from the payload's per-kind `counts` (§6); no separate tally |
| `notification_panel_opened` | `trackNotificationEvent` (thin action, `track-outcome.ts` pattern) | `{ total }` |
| `notification_item_clicked` | same | `{ kind }` |

When §0 lands, open-rate and click-through-by-kind are exactly the numbers the roadmap says decide
rung 2 ("users engage with the existing insights strip and want read/unread tracking"). No PII, no
financial values — consistent with the shim's contract.

---

## 12. Edge cases & rules

- **Zero everything** → badge suppressed, panel shows the calm line. The bell never disappears.
- **Unauthenticated race** (session expired between paint and fetch) → action returns
  `{ success: false }`; bell renders badge-less and the panel shows the error line. No redirect
  from inside a popover.
- **Over-budget rows appear once.** `budgetRiskLevel` is a three-way classification — an `"over"`
  row is never also emitted as `budget-risk`. (In the strip's aggregate count it still counts,
  as today.)
- **Zero-limit budgets:** `budgetProgressWithCarry` owns the `effective ≤ 0 → 100%` edge, so a
  fully-carried-away budget correctly surfaces as `budget-over` — consistent with the `/budgets`
  bar showing danger/100%.
- **Draft under-reporting** is inherited and accepted: no `generatePendingDrafts` on this path
  (insights spec §12.1 governs; not restated here). The panel is a nudge; `/recurring` is truth.
- **Archived accounts / soft-deleted rows** are excluded upstream by the reused fetchers — no new
  filtering logic here, by construction.
- **`/settings` has no bell** — it renders outside `AppShell` (per the billing slice). Accepted:
  Settings is a configuration surface, not a working surface.
- **Month boundary:** month/year resolve server-side at derivation time (same as the dashboard);
  a panel opened just after midnight on the 1st reflects the new month on its next derive (open =
  refetch, so effectively immediately).
- **EUR-only, no currency formatting in v1 labels** (percents and dates only) — avoids dragging
  `formatCurrency` into copy that would then need locale care.

---

## 13. Testing (Vitest — pure logic + the action; components out of scope per standards)

- **`test/lib/insights.test.ts` (extend):** `budgetRiskLevel` — `"over"` at exactly 100%,
  `"at-risk"` at exactly 80% (boundary `>=`), `null` at 79%, carry shrinking room across the
  boundary, `effectiveLimit ≤ 0` → `"over"`, NaN/zero-limit → `null`. **Existing
  `countAtRiskBudgets` cases must pass unmodified** (extraction proof — §8.1).
- **`test/lib/notifications.test.ts`:** empty input → `items: []`, all-zero `counts`,
  `totalCount: 0`; ordering (over → risk → draft → goal; percent desc within budgets, date asc
  within drafts, name asc within goals); per-kind cap at `NOTIFICATION_GROUP_MAX` with a correct
  `"+N more"` remainder row flagged `isOverflowRow: true` (and absent below the cap); the
  **payload invariant** — `counts` are pre-cap per-kind entity counts, overflow rows are never
  counted, and `totalCount === sum(counts)`; label copy incl. percent rounding; singular/edge
  counts.
- **`test/lib/db/notifications.test.ts`:** `deriveNotifications` composes the three mocked
  fetchers in parallel and feeds the builder; injectable `now` resolves month/year correctly
  across a year boundary (Dec → Jan); default `now` path works.
- **`test/actions/notifications.test.ts`:** unauthenticated → `{ success: false }`; happy path
  returns the payload from a mocked `deriveNotifications` (auth/service mocked at the module
  boundary per standards); service throw → `{ success: false }` (never an unhandled rejection
  into the client); one `notifications_derived` event per successful call, props matching the
  payload's `counts`.

`npm run test:run` and `npm run build` must pass before commit.

---

## 14. Implementation order

1. Types + constants.
2. `budgetRiskLevel` extraction in `src/lib/insights.ts`; run the existing insights suite
   untouched (extraction proof) + add the new cases.
3. `src/lib/notifications.ts` builder + its test suite (TDD-friendly, zero I/O).
4. `src/lib/db/notifications.ts` (`deriveNotifications`) + its test suite.
5. `src/actions/notifications.ts` (`getNotifications` + `trackNotificationEvent`) + action tests.
6. `notification-bell.tsx` + mount in `topbar.tsx`.
7. Docs pass (§16), `npm run test:run` + `npm run build`, then manual browser pass:
   - seed states for all four kinds (over-budget, 80–99% budget, pending draft, overdue goal) →
     badge count correct, panel order correct, each row links out;
   - resolve each on its page → reopen panel → item gone without any refresh gymnastics;
   - all resolved → badge gone, panel shows "All caught up.";
   - check `/transactions`, `/reports`, `/help` — bell present and live off-dashboard (the point
     of the feature);
   - mobile width: popover usable, no overflow.

---

## 15. Decision log

### Resolved (baked into this spec)

- **Derive-first, rung 1 only** — no persistence anywhere, including client-side (§0, §2).
- **Derivation is a channel-agnostic domain service** — `deriveNotifications` in
  `src/lib/db/notifications.ts` (`server-only`, injectable `now`); the Server Action is a thin
  auth+telemetry wrapper. Future channels (rung-2 cron, rung-3 email/push) call the same function
  — the derivation logic is never re-implemented per channel (§9).
- **Lazy Server-Action fetch, not prop threading** — one deferred POST per shell mount; never
  blocks paint; no per-page wiring tax (§4).
- **Payload carries pre-cap `counts` by kind** alongside `items` — telemetry spreads it verbatim,
  and future UI variations (filters, grouped sections) read metadata without rebuilding or
  reparsing the item list; `totalCount === sum(counts)` is a tested invariant (§6, §13).
- **Overflow rows are flagged (`isOverflowRow: true`), not name-encoded** — the `:more` id suffix
  is only for React-key uniqueness; no consumer may branch on id shape, and `id` carries no
  cross-request identity (normative contract in §6).
- **Label copy is isolated in per-kind module-private helpers** inside the builder module —
  copy, ordering, and capping evolve independently; the helpers are the future i18n seam (§8.2).
- **Per-entity items, capped per kind** — the center's value over the strip is specificity;
  caps keep it a nudge surface (§3).
- **Over/at-risk severity split lands in the panel only** — realizes the insights spec's deferred
  refinement without touching the strip or `InsightItem`'s tone union (§3).
- **Resolution is the only dismissal** — acting on the item removes it; no parallel "hide" state
  to persist (§2, §10).
- **Freshness = mount + open refetch** — no polling, no revalidation coupling (§4).
- **Telemetry ships with v1** through the no-op shim — the ladder's rung-2 gate needs this data
  (§11).
- **No rate limit, no Pro gate, no account scoping, no draft generation** (§2, §9).

### Rejected (considered, decided against — with the evolution seam named)

- **`priority` as a data property on `NotificationItem`.** Rejected for v1: order is a
  builder-owned push/sort sequence and the component never re-sorts — the same single-source-of-
  priority rule the insights strip codified (its spec §15.1 corollary 4). With four kinds, a
  numeric priority field would be a second, competing source of order truth that every consumer
  must be told to ignore or obey. **The seam if notification volume grows:** introduce priority
  *inside the builder* (compute it, sort by it, and only then decide whether to expose it on the
  item) — the component contract ("render in array order") survives that change untouched, so
  nothing is painted into a corner by omitting the field now.

### Deferred (known tradeoffs, not oversights)

- **Consistency insight ("tracked 6 days running")** — requires an opt-in preference, i.e.
  persistence; revisit when a preferences surface exists, and only if it stays a single calm line
  (the roadmap's own kill-criterion: if it can't be subtle, drop it).
- **Read/unread + dismissal history (rung 2)** — only on §0 evidence of engagement, per the
  ladder. The telemetry from §11 is what will make that call.
- **Strip over-budget split** — the strip keeps one "at risk" bucket; if the panel's split proves
  its worth, widening `InsightItem`'s tone union is the pre-authorized path (insights spec §15.1).
- **Badge live-updating without navigation** (e.g. after confirming a draft via the drawer while
  the bell is mounted) — the shell remounts on navigation, which covers the common flows; a shared
  refresh context is easy to add later if the staleness is ever noticed in practice.
- **Bottom-sheet panel on mobile** — the popover is acceptable at v1; revisit with the Mobile/PWA
  theme (§14 in the roadmap).

---

## 16. Docs to update when shipping

- [POST-MVP-ROADMAP.md](../POST-MVP-ROADMAP.md) — §9 shipped banner + Delivery Sequence row 12.
- [project-overview.md](../project-overview.md) — topbar description (*"No bell icon"* →
  bell shipped, derive-first, no read/unread) and the Dashboard feature note if it references
  notifications as post-MVP.
- `/help` — the maintenance contract (help spec §13): add a short "the bell shows things that need
  your action; it clears itself when you resolve them" line under Common questions.
- `docs/current-feature.md` — history entry on completion, per the standard workflow.
