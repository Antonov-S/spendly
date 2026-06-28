# Spendly Post-MVP Roadmap

> The MVP is complete (see [ROADMAP.md](./ROADMAP.md) — all of §0–§9 shipped, launch-day
> operator tasks aside). This document tracks what comes **after** launch. Section numbers
> are **stable feature IDs**, not build order; the build order is the **Delivery Sequence**
> near the end.
>
> Feature IDs are **stable and assigned in creation order** — they are *not* contiguous within
> a tier; build order is the **Delivery Sequence** near the end. Tiers:
> - **Foundation (§0):** lightweight telemetry, stood up early so the backlog is prioritized
>   on real demand, not guesswork.
> - **Phase 1 — Committed firm sequence (§1–§4):** agreed and ordered. Debt cleanup (§1–§2)
>   then the AI foundation + the first, least-experimental AI capabilities (§3–§4).
> - **Phase 2 — Committed, value-ordered (§5–§10, §15–§19):** committed to build, sequenced
>   value-first and validated incrementally against §0 metrics. Covers the AI insight pair
>   (§5–§6), the proven budgeting wins (§7–§8) and heuristic subscription detection (§10), plus
>   the new **Data Import (§15)**, **Transaction Tags (§16)**, **Split Transactions (§17)**, and
>   the lighter **Cash-Flow Forecast (§18)** / **Quick-Add Favorites (§19)** enhancements. Each
>   is its own `/feature` slice + spec.
> - **Parked — pending demand/data (§11–§14):** not committed; leaves the backlog only when
>   telemetry or user signal justifies the cost. **§12 Category Hierarchy is low-priority and
>   likely fully replaced by Transaction Tags (§16)** — kept parked, not killed.

---

## ▶ Next up — implementation sequence

> Running tracker of the **next concrete slice** to build. Update as each ships.

**✅ §2 — Help / FAQ Route shipped** (delivery slot 2, `feature/help-faq-route`). The dead
sidebar `/help` link (was a hard 404) is retired: a static, server-rendered, `AppShell`-wrapped
FAQ backed by a typed `src/lib/help/content.ts` (`HELP_SECTIONS`), with per-section icon squares,
a conditional "On this page" TOC (`HELP_TOC_MIN_SECTIONS = 5`), and the sidebar active-state
highlight. No DB, no mutations, no schema change. See `docs/features/help-faq-route-spec.md`.

**✅ §3 — AI Auto-Categorization + foundation shipped** (delivery slot 3,
`feature/ai-auto-categorization`). The shared `src/lib/ai/` foundation is live — a lazy OpenAI client
(`gpt-5-nano` via the **Responses API**, model behind the `AI_MODEL` knob), a `runAiFeature`
orchestrator centralizing auth → DB-driven Pro gate → two rate limits (`aiSuggest` 20/h per-feature +
`aiMonthly` 500/30d global COGS rail) → 8s timeout → telemetry → **fail-open**, plus the no-op
`track()` telemetry shim (§0 wires the sink later). The feature itself is a Pro-only **"Suggest"**
button in the transaction drawer (light-blue `--color-ai` accent) that pre-selects a category and
offers an opt-in merchant-cleanup chip — **suggestion only, never writes**. See
`docs/features/ai-auto-categorization-spec.md`.

**✅ §4 — Natural-Language Quick Capture shipped** (delivery slot 4, `feature/nl-quick-capture`).
A Pro-only **"Quick add"** natural-language field at the top of the **create-mode** transaction
drawer (light-blue `--color-ai` accent): a Pro user types one line — `"12 lunch at Pret yesterday"`
— and the `parseTransaction` action (thin over `runAiFeature`, reusing the §3 foundation unchanged)
pre-fills type/amount/date/category/merchant/note for confirmation. **Suggestion only — never
writes; `createTransaction` stays the sole writer.** Amount is the hard requirement (missing →
`no_match` → fail open); category degrades to null (manual picker). New: prompt
`src/lib/ai/prompts/transaction.ts`, pure helpers `src/lib/ai/parse.ts` (`parseDraftJson` +
`resolveDraftDate`), `trackParseOutcome` telemetry (field-name-only edit diff). No new client,
orchestrator, Pro read, rate policy, telemetry sink, color, schema, or migration — the first proof
of §3's "prompt + parse step only" claim. See `docs/features/nl-quick-capture-spec.md`.

**✅ §7 — Budget Rollover shipped** (delivery slot 5, `feature/budget-rollover`). Per-budget opt-in
carry, derived on read via a consecutive-rollover-run chain rule — no stored carry, no cron. Proven,
high-value, low-risk; landed ahead of the remaining (more experimental) AI assistants (§5–§6).

**✅ §8 — Trash UI shipped** (delivery slot 6, `feature/trash-ui`). A `/trash` "Recently deleted"
surface to restore or permanently delete soft-deleted transactions beyond the 8-second snackbar.
No schema change — reuses `Transaction.deletedAt`, `restoreTransaction`, and `@@index([deletedAt])`;
adds `getDeletedTransactions` / `getDeletedTransactionCount`, `hardDeleteTransaction` / `emptyTrash`,
and a header count badge. Transactions-only, no Pro gate, no cron/auto-purge. See
`docs/features/trash-ui-spec.md`.

**Next concrete slice: §15 — Data Import** (delivery slot 7). CSV column-mapping + JSON
schema-versioned import; the counterpart to the shipped export.

**Concurrent (product-owner gated): §0 Telemetry** — answer Open question #1 (sink +
consent), then wire the real sink behind the `track()` shim §3 already emits through (`ai_result` +
`ai_category_accepted`/`ai_category_overridden`).

---

## Guiding lens

Every item is evaluated against the same frame that governed the MVP:

1. **Conscious capture, not automation.** Even the AI features **suggest and let the user
   confirm** — they never silently write to the ledger (the same rule that makes recurring
   templates produce *drafts*). Auto-categorization (§3) is in the original *Out of Scope*
   list precisely because *silent* automation is off-thesis; we ship it as *suggestions in the
   drawer*, which is on-thesis.
2. **Never UI without backing function.** §1 and §2 each retire a control the MVP left
   dangling (the `/profile`↔`/settings` overlap; the dead `/help` nav link).
3. **Pro earns its price through depth, not gates on the basics.** The AI layer (§3–§6) is the
   first substantial Pro value beyond Reports history. Core capture/budget/goal flows stay
   free forever.
4. **Validate before you build big.** Quick, low-risk wins ship on conviction; larger or more
   experimental bets must clear a demand bar measured by §0 telemetry. Every AI feature ships
   instrumented and is **kept, iterated, or retired** against the explicit expand/iterate/retire
   thresholds and the AI cost budget defined in *Cross-cutting notes* — not on intuition. The
   parked tier (§11–§14) each carries a measurable **promotion criterion**.
5. **Decisions over options.** Each item lists the open decisions to resolve in its spec.

---

# Foundation

---

## 0. Product Analytics / Telemetry

**Effort: S · Value: high (de-risks every later decision) · Build early, alongside Phase 1.**

Spendly has no product analytics today, so backlog priority is currently argued from first
principles. A lightweight, **privacy-respecting** telemetry layer turns that into evidence:
which features are used, which AI suggestions are accepted, and whether a multi-currency or
subscription-detection audience actually exists.

**What to build:**
- A minimal event sink — a privacy-first product analytics provider (e.g. PostHog/Plausible)
  **or** a tiny first-party `events` table behind a server action; decide in spec. No PII /
  no financial values in events — feature-usage counters and outcomes only.
- A thin `track(event, props)` helper (`src/lib/analytics/`), server-only where possible,
  feature-flag/consent gated.
- Seed a starter event set: page/feature opens, transaction created, budget created, export
  run, upgrade-to-Pro clicked, and the **AI acceptance events** §3–§6 emit.

**Why first (concurrent with Phase 1):** the larger backlog bets — In-App Notifications (§9),
Subscription Detection (§10), Multi-Currency (§11) — all say *"prioritize on demand."* Without
§0 that's unmeasurable. Standing it up early lets a few weeks of post-launch data settle the
parked-tier decisions.

**Open decisions:** third-party vs. first-party sink; consent/opt-out model (GDPR — Spendly is
EUR-market); event schema + naming; whether to surface any of it back to the user.

---

# Phase 1 — Committed firm sequence

---

## 1. Account Surfaces IA Consolidation

**Effort: M · Value: medium (clears structural debt; one coherent "Account" area).**

> **✅ Shipped (`feature/account-surfaces-ia-consolidation`).** `/settings` is now **the** account-
> management surface, with cards: **Preferences** (identity header — avatar / email / "Member since" —
> + display-name form) → **Security** (change-password for credentials users + sign out) → **Billing** →
> **Categories** → **Data & privacy** (export wrapped in a prominent export-before-delete callout, then
> the account-deletion danger zone last). `/profile` is reduced to a permanent `redirect("/settings")`
> (307; stays in `auth.config.ts` `isProtected`, never 404). `UserMenu` "Profile" repointed to
> **Settings**. Dropped the `/profile` usage-stats grid (`ProfileStats` + `getProfileStats`, D3) and the
> dormant preferred-currency row (D4 — `preferredCurrency` removed from the `getUserOverview` projection);
> `change-password-form` + `delete-account-dialog` moved to `src/components/settings/`. The canonical
> Settings IA + no-new-routes rule is recorded in
> [account-settings-ia.md](./account-settings-ia.md) (flipped to "realized"). 508 tests + build + lint
> pass; no schema change. See `docs/features/account-surfaces-ia-consolidation-spec.md`.

The MVP left **two** pages that both describe "the account": `/profile` (identity, security,
danger zone) and `/settings` (preferences, billing, data, categories). The intended end-state
is already documented — this item executes **step 3** of
[account-settings-ia.md](./account-settings-ia.md).

**What to build:**
- Migrate **change-password** and **delete-account** from `/profile` into `/settings`
  sub-sections (a "Security" group and a "Data & privacy" group).
- **Co-locate data export + account deletion** under one "Data & privacy" section, and wire
  the *"prompted to export before deletion"* flow so the prompt links straight to the adjacent
  export control (today they sit on different pages).
- Reduce `/profile` to a **thin redirect → `/settings`** (or a read-only identity summary).
  **Constraint:** keep `/profile` resolvable — it's linked from the `UserMenu` drop-up and may
  be bookmarked; redirect, never 404.
- Usage stats: fold into a Settings overview or drop (decide in spec).

**Open decisions:** redirect vs. read-only `/profile`; final sub-section grouping/labels;
whether `getUserOverview` / `getProfileStats` projections need reshaping for the merged page.

**Why first:** lowest risk, no new infra, removes a confusing duplicate before more surfaces
(Help, AI settings) get added to `/settings`.

---

## 2. Help / FAQ Route

**Effort: S · Value: medium (resolves a dead nav link; reduces support load).**

> **✅ Shipped (`feature/help-faq-route`).** `/help` is a static, server-rendered FAQ wrapped in
> `AppShell`, auth-guarded via `getSessionOrRedirect` (**not** onboarding-gated — a first-run user must
> reach it). Content is a typed `src/lib/help/content.ts` (`HELP_SECTIONS` — Getting started, Common
> questions, Accounts, Transactions, Budgets, Recurring, Goals, Reports, Categories, Data & privacy —
> each with a Lucide icon + hex accent), rendered by `src/components/help/{help-content,help-section}.tsx`
> with per-section icon squares, a conditional "On this page" TOC (`HELP_TOC_MIN_SECTIONS = 5`), and the
> sidebar active-state highlight. `/help` added to `auth.config.ts` `isProtected`. No DB, no mutations,
> no schema change; no support/contact affordance (no support infra exists — deferred). The maintenance
> contract (§13 of the spec) makes future slices that change a described behaviour responsible for
> updating the matching Help section. See `docs/features/help-faq-route-spec.md`.

The sidebar already renders `<Link href="/help">`
([sidebar.tsx:153](../src/components/dashboard/sidebar.tsx#L153)) pointing at a route that
**doesn't exist** — clicking Help today 404s. This stands the page up.

**What to build:**
- A `/help` page (static, server-rendered — no DB, no mutations) with a concise FAQ. Its own
  simple layout or reusing `AppShell`; decide in spec.
- **Content — short "what is each entity / how is it used" explainers** plus the non-obvious
  behaviours that surprise users:
  - **Accounts** — containers for transactions; balance is *derived* (`startingBalance +
    SUM(transactions)`), never edited directly. Liability accounts (credit cards) **can start
    negative** — starting balance is signed.
  - **Transactions** — income / expense / transfer; transfers are one logical move shown as a
    single row. Soft-delete with 8-second undo.
  - **Budgets** — monthly per-category ceilings; **opt-in rollover** per budget (§7 shipped —
    carry derived on read); green/amber/red states.
  - **Recurring templates** — generate **drafts you confirm**, not silent entries (explain the
    *why*: conscious capture).
  - **Goals** — *virtual* savings progress; **don't touch account balances or budgets**;
    contributions can be **negative (withdrawals)**; goals can be **overfunded** ("Over 100%");
    completion is **manual**.
  - **Reports** — analysis over time (vs. Dashboard = current state); Free = 3 months, Pro = 12.
  - **Categories** — 20 system defaults + your own; deleting a custom one sends its transactions
    to **Uncategorized**.
  - **EUR-only** today; **export** is free on every tier.
- A short "Getting started" / first-run blurb and a pointer to `/settings` for account help.

**Suggested additions (open to scoping):** a "Tips" section (5-second capture, the account
selector as a global filter), a "Your data & privacy" note (soft-delete, 30-day grace,
export-before-delete), and a contact/support line. Keep it one scannable page, not a docs site.

**Open decisions:** content source (hardcoded MD-in-component vs. a structured array in
`constants.ts`/`lib/marketing`); anchor links + a table of contents; reuse `AppShell` or a
lighter shell.

---

## 3. AI Auto-Categorization (Pro) — and the AI Foundation

**Effort: M (foundation + feature) · Value: high for Pro (first real AI value; speeds capture).**

> **✅ Shipped (`feature/ai-auto-categorization`).** A Pro-only **"Suggest"** button beside the
> Category field in the transaction drawer calls an LLM that pre-selects the best-matching category
> (and offers an opt-in **merchant-cleanup** chip) — **a suggestion object only; `createTransaction`/
> `updateTransaction` stay the sole writers, no new write path.** Hidden for Free (UI) and enforced
> server-side. **Foundation (`src/lib/ai/`, reused by §4–§6/§10 v2):** `client.ts` lazy OpenAI singleton
> (mirrors `stripe.ts`); `respond.ts` `aiJsonRespond` Responses-API wrapper (model behind `AI_MODEL`,
> default `gpt-5-nano` — Chat Completions returns empty for this model; the wrapper also guarantees the
> literal word "json" is in the input, which the `json_object` guardrail requires); `run.ts`
> `runAiFeature` — the one place that does auth → **DB-driven Pro gate** (`getAiProfile`, never the JWT)
> → `aiMonthly` (500/30d, global per-user COGS rail) + `aiSuggest` (20/h, per-feature burst) caps → 8s
> AbortSignal timeout → **exactly one `ai_result` telemetry event** → **fail-open** (never throws;
> capture is never blocked); `errors.ts` `AiParseError`/`AiNoMatchError` sentinels; `db/ai.ts`
> `getAiProfile`; `analytics/track.ts` no-op telemetry shim (§0 swaps the body later). Feature:
> `actions/ai/suggest-category.ts` (thin over `runAiFeature`; `no_match` degrades to `categoryId: null`,
> not an error), versioned prompt `lib/ai/prompts/category.ts` (`CATEGORY_PROMPT_VERSION = 1`), pure
> `lib/ai/category.ts` parse/match helpers, `validations/ai.ts`. UI threads `isPro` through
> `getDrawerFormData`; the button is gated on free-text input, with a session-token guard so a slow
> suggestion can't land on a reopened drawer. **AI accent** `--color-ai`/`--color-ai-strong` added to
> `globals.css` (the one documented exception to the strictly-semantic color rule). **Deviations from
> this section's original sketch:** model is `gpt-5-nano` (not `gpt-4o-mini`); `getUserCategories` is
> reused rather than a new fetcher; truncation is owned by the action's `clip()` (so over-long input is
> truncated, never rejected). 540 tests pass, build + lint clean; no schema change. Spec:
> `docs/features/ai-auto-categorization-spec.md`.

When a Pro user enters a transaction, an LLM suggests the most likely **category** (and
optionally cleans up the **merchant**) from the description/merchant text. The suggestion is
**pre-selected in the drawer for the user to confirm or override** — never written silently.
This keeps the conscious-capture moment while removing the "which bucket?" hesitation.

**This slice stands up the shared AI foundation that §4–§6 (and later §10) reuse:**
- `src/lib/ai/` — a lazy, server-only LLM client (mirrors `src/lib/stripe.ts`). Provider behind
  an interface so the model is a **config knob**.
- **Key + config** — re-add an AI provider key to `.env.example` (removed in pre-launch polish
  as unused). Default to a **cheap model** (e.g. OpenAI `gpt-4o-mini`); Claude Haiku is a
  comparably cheap alternative worth benchmarking.
- **Pro gate** — read `isPro` fresh from the DB (never the JWT), same as Reports. Free users get
  the normal manual picker; no AI call is made.
- **Cost & abuse controls** — per-user rate limit + a monthly call/cost cap (extend the
  `RATE_LIMITS` pattern); **fail open to the manual flow** on error/timeout/over-cap (the app
  must never block capture because the model is down).
- **Confirm-not-auto contract** — the AI returns a *suggestion object*; the existing
  create/update actions remain the only writers. No new write path.
- **Instrumentation (via §0)** — emit `ai_category_suggested` / `ai_category_accepted` /
  `ai_category_overridden` so acceptance rate is measurable from day one.

**Success metrics:** suggestion **acceptance rate** (target a meaningful majority), capture-time
reduction, and Pro-feature engagement. Below-threshold acceptance → iterate the prompt or pull
the feature.

**Open decisions:** provider/model + prompt; suggest on the client as the user types (debounced)
vs. on drawer open vs. server-side at save; merchant-normalization aggressiveness; cost-cap
numbers; whether suggestions are logged for later subscription-detection reuse (§10).

**Philosophy note:** documented as a *suggestion*, not "automatic categorization" — the
Out-of-Scope entry referred to silent auto-tagging, which we are **not** doing.

---

## 4. Natural-Language Quick Capture (Pro)

> **✅ Shipped (`feature/nl-quick-capture`, delivery slot 4).** A Pro-only "Quick add" NL field
> at the top of the create-mode transaction drawer pre-fills a draft via the `parseTransaction`
> action (thin over `runAiFeature`); never writes — `createTransaction` stays the sole writer.
> Amount missing → `no_match` (fail open); category unmatched → null (manual picker); account
> never auto-set; single transaction only (v1). Reuses the §3 foundation unchanged (no new client,
> orchestrator, Pro read, rate policy, telemetry sink, color, schema, or migration) — the first
> proof of §3's "prompt + parse step only" claim. Decisions baked in below. See
> `docs/features/nl-quick-capture-spec.md`.

**Effort: M · Value: high for Pro (most on-philosophy AI feature).**

Type or paste "12 lunch at Pret yesterday" → a **pre-filled transaction draft** (amount,
category, merchant, date) the user confirms. The least-experimental assistant and a direct
servant of the 5-second-capture goal — so it's the **one AI assistant in the firm committed
sequence**; the rest (§5–§6) are committed but value-ordered behind Budget Rollover.

**What to build:** a parse entry point (a text field in/above the transaction drawer) that calls
the §3 foundation to return a structured draft, then opens the normal drawer **pre-filled and
unsaved**. Reuses the Pro gate, cost cap, and fail-open behaviour from §3. No new write path —
the user saves through the existing `createTransaction`.

**Success metrics:** % of NL captures confirmed without heavy edits; share of new transactions
created via NL vs. manual; Pro retention among users who adopt it.

**Open decisions:** entry surface (drawer field vs. a dedicated "quick add" affordance); how to
present low-confidence parses; multi-transaction input ("groceries 40 and gas 30").

---

# Phase 2 — Committed, value-ordered

> Committed to build; sequenced value-first and validated incrementally against §0 metrics.
> **Budget Rollover (§7) is intentionally promoted ahead of the remaining AI assistants
> (§5–§6 by ID, but later in delivery order)** — it is a proven budgeting feature with high
> value, low risk, and limited complexity, whereas the remaining assistants are more
> experimental and benefit from incremental validation. See the Delivery Sequence for the
> realized order.

---

## 5. Monthly Review Narrative (Pro, AI)

**Effort: M · Value: high for Pro (insight layer).**

A short generated summary on `/reports` — "Dining up 31% vs last month; you're €40 under your
Groceries budget." Read-only; reuses the §3 foundation. Pure insight, no write path. Sliced
independently from §6 so each is shipped and measured on its own.

**Success metrics:** view/expand rate on the narrative; repeat visits to Reports among Pro
users; correlation with retention.

**Open decisions:** generated per-request (fresh, costs a call each load) vs. cached per
period; tone/length; how it handles sparse data.

---

## 6. Smart Budget Suggestions (Pro, AI)

**Effort: M · Value: high for Pro (strengthens the budgeting core).**

Propose per-category budget amounts from spending history — strongest in the empty-budget /
onboarding state, as one-tap accepts. Reuses the §3 foundation. Independent slice from §5.

**Success metrics:** acceptance rate of suggested amounts; budgets-created lift among users
shown suggestions; downstream budget-adherence.

**Open decisions:** statistical baseline (trailing-average) with AI only for phrasing/outliers
vs. fully model-driven; surface (budgets empty state, onboarding step 2, or both).

---

## Checkpoint — Pro Value Review (after the core AI layer)

**Not a feature — a gate.** By the time §3, §4, §5, and §6 have all shipped (delivery slots
3, 4, 7, 8), Spendly has four AI capabilities: Auto-Categorization, NL Quick Capture, Monthly
Review Narrative, and Smart Budget Suggestions. Before expanding the AI surface any further
(§13 later-stage assistants), run a **formal review** against §0 data:

- **Is AI driving Pro?** Compare upgrade/retention for users who adopt ≥1 AI feature vs. those
  who don't. AI is a major plank of the Pro value proposition — this is the moment to confirm
  it pays.
- **Per-feature verdict.** Apply the expand/iterate/retire thresholds (see *Cross-cutting
  notes*) to each of the four. Retire or rework underperformers rather than stacking more on top.
- **Cost reality.** Check actual AI COGS per Pro user against the budget assumption — adjust
  the model, cap, or feature set if it's drifting.

**Outcome:** an explicit decision to (a) expand AI (promote items from §13), (b) iterate the
existing four, or (c) hold and let the non-AI backlog (§9–§10) carry the next cycle. This
checkpoint is the dividing line between "committed AI layer" and "speculative AI expansion."

---

## 7. Budget Rollover

**Effort: S–M · Value: high (active budget users). Promoted ahead of §5–§6 in delivery order.**

> **✅ Shipped (`feature/budget-rollover`, delivery slot 5).** A per-budget **"Roll over
> remainder"** toggle. Effective limit = base limit + the prior month's remainder
> (`effective − spent`), carried while the budget stays rollover-on across consecutive months;
> carry is **positive** (underspent) or **negative** (overspent). **Realized decisions:**
> **(1) derive on read** — `resolveRolloverCarry` walks back the consecutive rollover run
> (`previousPeriod`, bounded by `ROLLOVER_MAX_LOOKBACK_MONTHS = 24`), folds via pure
> `rolloverCarryIn`, rounds once at the boundary; no stored carry, no cron. **(2) Per-budget
> `Budget.rollover` flag** (one additive column, `add_budget_rollover`), not a user-level
> default. **(3) Chain rule:** a gap month or a rollover-off month ends the run — the next
> rollover-on month starts fresh. **(4)** The `effective ≤ 0 → danger/100%` edge lives once in
> `budgetProgressWithCarry`; the `/budgets` row, dashboard panel, and at-risk insight count all
> route through it so they cannot diverge. Not a Pro gate. See
> `docs/features/budget-rollover-spec.md`.

Carry an unspent (or overspent) remainder into the next month instead of resetting clean. The
model already fits (budgets are per-`(category, month, year)`). Add a `rollover` toggle (per
budget or a user-level default) and compute the carried amount = prior period's `limit − spent`.
**Key decision: derive on read** (chain back through prior months — cron-free, clean at MVP
volumes) **vs. store at month-rollover** (needs a scheduled job). Recommend derived. Mostly a
calc + a settings toggle + a progress-bar label tweak. Well-contained, non-experimental, high
value — the reason it jumps ahead of the remaining AI assistants.

---

## 8. Trash UI

**Effort: S · Value: medium (safety net; easy win).**

> **✅ Shipped (`feature/trash-ui`, delivery slot 6).** A `/trash` "Recently deleted" surface lists
> soft-deleted transactions (newest deletion first) and, per row, **Restore** (reuses
> `restoreTransaction` unchanged) or **Delete forever** (new `hardDeleteTransaction`), plus an
> **Empty trash** bulk action (`emptyTrash`) — both permanent deletes confirm-gated and irreversible.
> **Realized decisions:** **(1) No schema change** — reuses `Transaction.deletedAt` + `@@index([deletedAt])`;
> the new read path is `getDeletedTransactions` (`deletedAt != null`, newest-first, includes rows on
> **archived** accounts, collapses transfer pairs via the existing `collapseTransfers`) +
> `getDeletedTransactionCount`. **(2) Hard delete only on already-soft-deleted rows** (`findFirst` filters
> `deletedAt: { not: null }`) — defense in depth; transfers remove both legs by `transferPairId`.
> **(3) Transactions only** — goals/budgets/accounts/categories are hard-deleted, so "trash for everything"
> stays out of scope. **(4) No account scoping** (flat all-accounts recovery list), **no Pro gate**, **no
> cron/auto-purge** (cron-free, matching the app's stance). **(5) Discoverability** — a "Recently deleted · N"
> link in the Transactions header (badge suppressed at 0), not a sidebar item; the count refreshes on
> navigation via the existing `revalidateTransactionViews()` (extended to touch `/trash`). **(6) Restore
> preserves chronological order** — clears only `deletedAt`, never re-stamps `date`/`createdAt`. New pure
> helper `formatDeletedAt` ("Deleted 3 days ago · Jun 25"). Help copy flipped from "no Trash view". See
> `docs/features/trash-ui-spec.md`.

A "recently deleted" surface to view / restore / permanently-delete soft-deleted transactions,
beyond the 8-second snackbar undo. Most plumbing exists: `Transaction.deletedAt` is set on
delete, `restoreTransaction` already exists, and there's a `@@index([deletedAt])`. Add a fetcher
for `deletedAt != null`, a `/trash` (or settings tab) list, a hard-delete action, and an optional
purge policy. **Note:** only *transactions* soft-delete today (goals/budgets are hard-deleted),
so scope this to transactions; "trash for everything" is a larger, separate effort.

---

## 9. In-App Notifications

**Effort: M · Value: medium–high. Deliberately scoped to in-app only.**

A **notification center + dashboard alerts** — **no email or push** (those need scheduling,
preference models, unsubscribe handling, service workers: a big infra cliff this avoids). The
dashboard insights strip is already a proto-notification (budgets-at-risk, pending drafts,
overdue goals); this extends it into a persistent, dismissible center (bell/panel).

**Committed default: derive-first.** v1 derives in-process like the insights strip — no table,
always fresh, no read/unread or history. A persisted `Notification` model (read/unread state,
dismissal history, lifecycle) adds meaningful complexity and write paths and is **not built
unless §0 evidence proves it's needed** — specifically, that users engage with the existing
insights strip and want read/unread tracking. Treating derive-first as the default (not just a
recommendation) removes future ambiguity. (The topbar mockup omits a bell — "notifications are
post-MVP" — this is where that's revisited.)

**Escalation ladder — do not skip rungs.** `derive-first (v1)` → `persistence only on §0 evidence`
→ `email / push only as a separate, much later infra decision` (scheduling, preference + unsubscribe
models, service workers — **out of scope today**). Each rung must prove its value before the next is
built; the default is to stay on the lowest rung that works.

**Optional — tracking-consistency insight (not a standalone feature).** This surface may carry a
lightweight, opt-in consistency signal — e.g. "tracked 6 days running" — which directly addresses
the target user's documented struggle to *maintain* tracking over time. It must stay a calm,
dismissible informational line **within** notifications — **never** a standalone gamification
system (badges, streak counters, pressure mechanics). If it can't be kept subtle, drop it; the
risk is nagging, and nagging is off-brand for a "clarity, not optimization" product.

---

## 10. Subscription Detection — heuristic first

**Effort: M (heuristic v1) · Value: medium, grows with history.**

Spot recurring spend and **suggest** "make this a recurring template?" The `merchant` field was
added as future-proofing for exactly this, so the model is ready.

- **v1 — pure heuristic, no AI dependency.** Group by normalized merchant, detect regular
  amount/interval patterns, surface **user-confirmed suggestions** (never auto-create). Ships
  without any reliance on §3 — cheaper, deterministic, testable. *This is the committed scope.*
- **v2 — optional AI assist.** Use the §3 foundation only for fuzzy merchant normalization /
  edge cases, and **only if** §0/QA shows v1's heuristic precision is materially insufficient.
  AI coupling is explicitly deferred — do **not** reach for the model to ship v1. Strictly a
  later, evidence-gated enhancement, never a prerequisite.

**Why later:** value depends on accumulated transaction history; needs a scheduled/batched run
(or lazy compute on the recurring page). Gate the build on §0 showing users with enough history.

---

## 15. Data Import (CSV / JSON) — ✅ Shipped

**Effort: M · Value: high (onboarding friction / acquisition).**

> **✅ Shipped (`feature/data-import`).** The migration counterpart to export is live at `/import`
> (reached from `/settings` → Data & privacy). Three Server Actions (`inspectCsv` / `previewImport`
> / `commitImport` in `src/actions/import.ts`) drive an **upload → (map, CSV only) → preview →
> confirm** flow — nothing is written until the user confirms a dry-run preview. Both formats funnel
> through one pure pipeline (`src/lib/import/*`): CSV via a dependency-free RFC-4180 parser + column
> mapping (by index, duplicate-header-safe) + tolerant date/amount parsing (auto-detected dialect,
> user-overridable); JSON via the strict-version / lenient-shape envelope parser. **Single target
> account** (C1); INCOME/EXPENSE only (transfers skipped + counted, D1); **count-based multiset
> dedup** keyed on `(date, signedAmount, type, merchant, note)` so re-importing the same file is
> idempotent (D4); categories resolved case-insensitively (NFC) and optionally created. The write is
> one atomic `$transaction` (`createMany` categories then transactions, D7). **Tier-agnostic** (no
> `isPro` read, S6); per-user rate-limited (`RATE_LIMITS.import`); no schema change. See
> `docs/features/data-import-spec.md`. Open decisions resolved: **Server Action** (a file *upload*
> can be an action — export's route rationale is download-only); **count-based dedup**; size-capped
> single-request (no streamed route); transfers skipped under the single-account model.

The counterpart to the shipped export. New users migrating from a spreadsheet, Mint, YNAB, or
Monarch must currently re-enter history by hand — the single biggest switching cost for the
target user ("already track, struggle to maintain it"). Import removes it.

**What to build:**
- **CSV import** — upload → **column-mapping** step (map the file's columns to date / amount /
  type / category / account / merchant / note) → **preview** → confirm → bulk create, all
  `userId`-scoped into a chosen account. Tolerant parsing (handles the variety real exports
  produce).
- **JSON import** — accept Spendly's own versioned export envelope and **branch on
  `schemaVersion`** (the envelope was designed for exactly this — see the export spec's "version
  from day one" note). Round-trips export → import.
- Resolution rules: unknown categories → create or map to **Uncategorized**; unknown accounts →
  prompt/map; **dedup** so re-importing the same file doesn't double-up.

**Philosophy check — this is migration, not bank-sync.** A **one-time, user-initiated, preview-
and-confirm** import is *not* the continuous auto-import the thesis rejects. There is no feed, no
schedule, no silent ledger writes — the user explicitly chooses a file and confirms the result.
Frame it as onboarding/migration in copy so it never reads as "sync."

**Open decisions:** API route vs. server action (large files favor a streamed route, mirroring
export); dedup strategy (hash of key fields vs. skip-on-match); category/account resolution UX;
size cap (reuse `EXPORT_MAX_TRANSACTIONS`?); how transfers are represented on import.

---

## 16. Transaction Tags

**Effort: M · Value: high (flexible organization; replaces §12).**

Free-form labels **orthogonal to categories** — `tax-deductible`, `reimbursable`, `vacation-2026`,
`business-trip` — that a transaction can carry several of, filterable in the feed and Reports.
**This supersedes Category Hierarchy (§12):** it solves the same "group across categories" need
with far less complexity and more flexibility — no parent/child roll-up, no budget-aggregation
rework, no break to the flat `@@unique([name, userId])` model. Categories stay single and
spending-bucket-shaped; tags are the cross-cutting dimension.

**What to build:**
- Schema: a `Tag` model (`id`, `name`, `userId`, optional `color`) + a `TransactionTag` join
  (many-to-many). Recommend the join table over a `text[]` column so feed/report filtering and a
  tag breakdown stay first-class. Case-insensitive per-user dedup, mirroring user categories.
- A multi-select tag picker in the transaction drawer (inline create, like `<CategoryPickerField>`).
- A tag filter pill on `/transactions`; optionally a tag breakdown in Reports.
- Management lives on `/settings` next to category management.

**Open decisions:** join table vs. array column; color/name-only; whether tags get a Reports
chart; any Pro gate (recommend free — it's core organization, not depth).

---

## 17. Split Transactions

**Effort: M · Value: high, but high blast radius.**

One transaction split across multiple categories — €80 at a supermarket = €55 Groceries + €25
Household. More accurate budgeting and *more* conscious categorization — squarely on-thesis.

**What to build:**
- Schema: a `TransactionSplit` child (`transactionId`, `categoryId`, `amount`, optional `note`);
  the parent transaction's category becomes "Split". The parent `amount` stays the single source
  of truth, so **derived balances are unaffected**.
- **Aggregations must read split lines, not the parent category:** budget spend
  (`transaction.groupBy` in `getBudgets` / `getBudgetsData`) and the Reports category breakdown
  both sum splits per category. Export must represent splits.
- Drawer UI to add/remove split rows that **must sum to the total** (validation). Feed shows one
  row, expandable to its splits.

**Honest scope note:** this is the highest-blast-radius committed item — it touches budgets,
reports, export, and the drawer. Worth it for the everyday accuracy, but spec the aggregation
changes carefully and lean on the existing Vitest coverage for budget/report math.

**Open decisions:** split-line child table vs. linked sub-transactions (recommend child table);
transfers excluded from splitting; whether a split can span accounts (no — single account).

---

## 18. Cash-Flow Forecast

**Effort: M · Value: medium–high (forward-looking awareness). Lighter enhancement.**

Project the balance forward from **active recurring templates + pending drafts** — "you'll dip to
€240 around the 28th before salary." Forward-looking *awareness*, not optimization or automation:
it only projects items the user already set up. Reuses recurring data; read-only.

**What to build:** a pure projection (current balance + scheduled recurring occurrences over a
horizon) rendered as a small line/area — on the Dashboard (state-adjacent) or Reports. No new
mutations.

**Open decisions:** surface (Dashboard vs. Reports); horizon (30/60/90 days); include unconfirmed
drafts or active templates only; Free or Pro.

---

## 19. Quick-Add Favorites

**Effort: S–M · Value: medium (fast manual entry). Lighter enhancement.**

Saved one-tap common transactions — "Coffee €3.50 / Dining" — that pre-fill the drawer as an
**unsaved draft**. Distinct from recurring templates (which are *scheduled*); these are *on-demand*
shortcuts serving the 5-second-capture goal.

**What to build:** a small `Favorite`-style store (`type`, optional `amount`, `category`,
`account`, `merchant`); a favorites strip/menu in the drawer or quick-add that pre-fills (never
silently writes — the user still confirms). Reuses `createTransaction`.

**Open decisions:** pre-fill draft vs. one-tap create (recommend pre-fill — keeps the confirm
moment); where surfaced; fixed amount vs. prompt-on-use.

---

# Parked — pending demand/data

> Not committed. Each leaves the backlog only when §0 telemetry or direct user signal justifies
> the cost. Listed so the intent is recorded, not so it's scheduled. Each item names an explicit
> **promotion criterion** — the measurable trigger that moves it from parked to committed — so
> the decision stays objective rather than a judgment call. (Thresholds below are starting
> proposals; calibrate against real post-launch baselines.)

---

## 11. Multi-Currency

**Effort: L (largest) · Value: high but segment-dependent. Keep parked until demand is validated.**

Accounts in different currencies, converted to a base `preferredCurrency` for totals, with
per-currency subtotals where a naïve sum is meaningless. **No destructive migration** — every
money model already has a `currency` column and `preferredCurrency` is dormant-but-present. The
cost is runtime: a currency picker at account creation, an **exchange-rate source** (manual table
vs. fetched feed — itself a sub-feature), and rewriting **every aggregation**
(`getDashboardSummary`, `getBalanceTrend`, all of `lib/db/reports.ts`, export) to convert rather
than sum. End-state already specified (replace "⚠ approximate total" with per-currency subtotals
— see [project-overview.md](./project-overview.md) + financial-account spec §10).

**Why parked:** multi-currency primarily benefits expats, digital nomads, frequent travelers,
and cross-currency households. Given Spendly's positioning as a *simple personal budgeting app*,
Budget Rollover, Notifications, and Subscription Detection serve a far larger share of users.

**Promotion criterion:** a measurable share of active users signals multi-currency need — e.g.
**≥ 10–15% of active users** create (or attempt) accounts they'd want in a non-EUR currency, or
direct requests cross a set bar. Until then it stays parked regardless of effort estimates.

---

## 12. Category Hierarchy / Subcategories — **low priority; likely replaced by §16 Transaction Tags**

**Effort: M (schema) but high blast radius · Value: weakest value-to-effort.**

Originally proposed as nested categories (Food → Groceries / Dining). **Now low-priority and
expected to be fully replaced by Transaction Tags (§16)**, which solves the same "group across
categories" need (`tax-deductible`, `reimbursable`, `vacation`, `business-trip`) far more elegantly
— no self-referencing `parentId`, no parent/child budget roll-up, no reports grouping rework, and
no break to the flat `@@unique([name, userId])` model. "Flat list, no hierarchy" stays true; the
cross-cutting dimension users actually wanted is delivered by tags instead.

**Kept parked, not killed** — a *minority* of genuine nesting use cases might survive tags, so it
stays on record rather than fully removed.

**Promotion criterion (high bar):** tags ship *and* prove **materially insufficient** for real
grouping needs, *and* users explicitly demand true tree/nesting semantics (not just more labels).
Until both hold it stays deprioritized — the working assumption is that tags absorb it entirely.

---

## 13. Later-stage AI Assistants

**Effort: per-item M–L · Value: niche / experimental. Validate the §3–§6 layer first.**

Additional assistants on the §3 foundation, deferred until the first three (§4–§6) prove their
acceptance rates:

- **Goal pace advisor** — "save €240/mo to hit Japan Trip by your target date" on the goal card.
- **Anomaly flags** — nudge on unusual spend (amount/merchant out of pattern).
- **Receipt scan** *(heaviest)* — photo → parsed draft (OCR + LLM); needs file-upload infra.

Each is its own slice when promoted; none is committed. Pick up individually if metrics on the
committed AI layer justify expanding it.

**Promotion criterion:** the **Pro Value Review checkpoint** (after §6) returns a clear
"expand AI" verdict — i.e. the core four (§3–§6) clear their expand thresholds and AI demonstrably
moves Pro conversion/retention. Without that, the AI surface does not grow.

---

## 14. Mobile / PWA Improvements

**Effort: TBD · Value: high *for mobile users* — placeholder, not yet scoped.**

The app is responsive (mobile-first layout) but is not an installable PWA and has no
mobile-specific capture optimizations. **Quick capture (§4) and notifications (§9) become
materially more valuable on mobile** — a home-screen install + fast add-transaction flow is the
natural amplifier for both. Native mobile (React Native/Expo) remains out of scope; a **PWA**
(installable, offline-shell, push-capable later) is the lighter path. Recorded as a future theme
to scope once the desktop AI/notification layer is proven and §0 shows meaningful mobile usage.

**Promotion criterion:** a meaningful share of sessions/active users are on mobile (e.g.
**≥ 30% of sessions**), *and* §4/§9 have shipped on desktop and earned their thresholds —
so there's a proven capture/notification flow worth amplifying on mobile.

---

## Delivery Sequence

> Stable IDs above are not build order. Realized order below — value-first, with Budget Rollover
> promoted ahead of the remaining AI assistants, and §0 telemetry stood up early to inform the
> parked tier.

| Order | Item (ID) | Tier | Effort | Pro-gated? | Why this slot |
|---|---|---|---|---|---|
| — | Product Analytics / Telemetry (0) | Foundation | S | No | Stand up **early, concurrent with Phase 1**; makes the backlog data-driven. |
| 1 | Account Surfaces IA Consolidation (1) | Committed | M | No | **✅ Shipped.** Clears the `/profile`↔`/settings` debt before more surfaces land on Settings. |
| 2 | Help / FAQ route (2) | Committed | S | No | **✅ Shipped.** Resolves the dead `/help` nav link; static FAQ, no DB/mutations. |
| 3 | AI Auto-Categorization + foundation (3) | Committed | M | **Yes** | **✅ Shipped.** First Pro AI value; stood up `src/lib/ai/` (client + `runAiFeature` + Pro gate + rate/cap + fail-open + telemetry shim) reused by §4–§6, §10. |
| 4 | Natural-Language Quick Capture (4) | Committed | M | **Yes** | **✅ Shipped.** Pro-only "Quick add" NL field in the create-mode drawer; `parseTransaction` thin over `runAiFeature`, suggestion-only (never writes); proves §3's "prompt + parse step only" reuse. |
| 5 | **Budget Rollover (7)** | Committed | S–M | No | **✅ Shipped.** Per-budget opt-in carry, derived on read (consecutive-run chain rule); proven, high-value, low-risk; ahead of the more experimental AI assistants. |
| 6 | Trash UI (8) | Committed | S | No | **✅ Shipped.** `/trash` restore / delete-forever / empty-trash for soft-deleted transactions; no schema change (reuses `deletedAt` + `restoreTransaction`); header count badge; transactions-only, no Pro gate, no cron. |
| 7 | **Data Import (15)** | Committed | M | No | **✅ Shipped.** `/import` CSV column-mapper + JSON envelope → preview → confirm; Server Actions; count-based dedup; transactions-only into one account; no schema change. Onboarding/acquisition lever; reused export infra. |
| 8 | **Transaction Tags (16)** | Committed | M | No | Flexible organization; replaces §12 at a fraction of the cost. |
| 9 | **Split Transactions (17)** | Committed | M | No | Everyday categorization accuracy; highest blast radius of the non-AI wins. |
| 10 | Monthly Review Narrative (5) | Committed | M | **Yes** | First "insight" assistant; ship + measure independently. |
| 11 | Smart Budget Suggestions (6) | Committed | M | **Yes** | Strengthens budgeting; pairs with §7's rollover data. |
| ✦ | **Pro Value Review checkpoint** | Gate | — | — | All four AI features (§3–§6) now shipped — apply the expand/iterate/retire rubric; decide whether to grow the AI surface (gates §13). |
| 12 | In-App Notifications (9) | Committed | M | No | Extends the insights strip; in-app only, **derive-first**; persist only on §0 evidence. Optional consistency insight lives here. |
| 13 | Subscription Detection — heuristic (10) | Committed | M | No | Heuristic v1, **no AI dep**; gate on history (§0). |
| 14 | Cash-Flow Forecast (18) | Committed | M | TBD | Forward-looking awareness enhancement; reuses recurring data. |
| 15 | Quick-Add Favorites (19) | Committed | S–M | No | Fast manual-entry enhancement; on-demand capture shortcuts. |
| — | Multi-Currency (11) | Parked | L | No | Promote only if ≥ ~10–15% of active users signal multi-currency need. |
| — | Category Hierarchy (12) | Parked (low) | M+ | No | Likely fully replaced by Tags (§16); revisit only if tags prove insufficient *and* nesting is demanded. |
| — | Later-stage AI assistants (13) | Parked | M–L | Yes | Promote only on an "expand AI" verdict at the Pro Value Review. |
| — | Mobile / PWA (14) | Parked | TBD | No | Promote only at ≥ ~30% mobile sessions, after §4/§9 prove out. |

**Rationale:** front-load debt cleanup (§1–§2) for coherence, then the AI foundation + the one
non-experimental assistant (§3–§4). Promote the **proven, non-experimental wins** ahead of the
remaining AI work — Budget Rollover, Trash, then the high-value **Data Import / Tags / Split**
trio — before the two AI insight assistants (§5–§6) and the Pro Value Review checkpoint. The
in-app notification center, heuristic subscription detection, and the lighter Forecast / Favorites
enhancements round out the committed tier. The parked tier (multi-currency, later AI, mobile/PWA)
leaves the backlog only on evidence from §0; **Category Hierarchy is low-priority** and expected to
be fully replaced by Tags (kept parked, not killed).

---

## Cross-cutting notes

- **AI foundation is built once (§3) and reused** (§4–§6, §10 v2, §13). It must: read `isPro`
  from the DB, rate-limit + cost-cap per user, **fail open** to the manual flow, never become a
  write path (suggestions only), and **emit acceptance telemetry** (§0). Re-add the AI provider
  key to `.env.example`.
- **Every AI feature ships instrumented and is judged on explicit thresholds** — define them in
  each spec before building, then act on the numbers, not intuition. A shared starting rubric
  (calibrate to real baselines):

  | Verdict | Trigger (per feature, measured over a stable window) |
  |---|---|
  | **Expand** | High acceptance (suggestion-acceptance / confirm-without-heavy-edit **≥ ~60%**) **and** positive Pro signal (adopters show better conversion/retention than non-adopters). |
  | **Iterate** | Mixed — acceptance in a middle band (**~30–60%**) or flat Pro signal. Rework the prompt/surface, re-measure before any expansion. |
  | **Retire** | Low acceptance (**< ~30%**) or negative cost/UX trade-off after one iteration. Pull the feature rather than carry dead weight. |

  These percentages are *placeholders to be calibrated* against the first weeks of §0 data — the
  point is that each spec commits to a number up front. The **Pro Value Review checkpoint** (after
  §6) applies this rubric to the core four at once.
- **AI cost budget — target ≤ ~10% of net Pro revenue (~€0.20–0.30 / Pro user / month).** Pro is
  €3/mo (≈ €2.08/mo on the annual plan), less Stripe fees — so the COGS ceiling for *all* AI a
  Pro user consumes is small but very comfortable: a cheap model (OpenAI `gpt-4o-mini` / Claude
  Haiku) handles a categorization or NL-parse call in a few hundred tokens for a fraction of a
  cent, so even heavy daily use stays well under budget. This assumption guides three things: the
  **model choice** (stay on cheap models until a feature proves it needs more), the **§3 monthly
  per-user cost cap** (set it to enforce this ceiling), and **AI expansion** (each new assistant's
  projected cost-per-Pro-user is checked against the remaining budget headroom before commit).
  Re-validate actual COGS at the Pro Value Review checkpoint.
- **Telemetry (§0) gates the parked tier** — Notifications persistence (§9), Subscription
  Detection scheduling (§10), and especially Multi-Currency (§11) are committed/parked decisions
  that §0 data is meant to settle.
- **Workflow unchanged** — each item is one `/feature` slice: document in `current-feature.md`,
  branch (`feature/<name>`), implement, add Vitest coverage for new `src/actions/**` +
  `src/lib/**`, run `npm run test:run` + `npm run build`, commit/merge per `docs/ai-interaction.md`.
  AI features mock the provider at the module boundary in tests (like Stripe/Resend) — no live
  calls in Vitest.
- **Out-of-Scope reconciliation** — §3 (auto-categorization), §10 (subscription detection), §11
  (cross-currency) appear in project-overview's *Out of Scope (Post-MVP)* list; this roadmap is
  where they graduate in — update that list's framing when each is scheduled (it's a "not in MVP"
  list, not "never"). **Category hierarchy** stays out-of-scope and **low-priority** — expected to be
  fully replaced by Transaction Tags (§16), kept parked rather than killed. **Data Import (§15)** is new and *not* an
  Out-of-Scope item — note the migration-vs-sync distinction so it's never conflated with the
  out-of-scope "bank account synchronization."

---

## Open questions for the product owner

1. **§0 sink** — third-party analytics (PostHog/Plausible) or a first-party events table? And the
   consent/opt-out model for the EU market?
2. **§3/§4 provider + cost budget** — OpenAI `gpt-4o-mini` (your stated preference) vs.
   benchmarking Claude Haiku; confirm the target AI COGS ceiling (~€0.20–0.30 / Pro user / month)
   and the resulting §3 monthly per-user cost cap.
3. **AI thresholds** — sign off the expand/iterate/retire numbers (the ~60% / ~30–60% / <30%
   starting rubric), or set your own, so each AI spec commits to a target before building.
4. **§5/§6 surfacing** — Monthly Review cached vs. per-request; Smart Budget Suggestions in the
   empty state, onboarding, or both.
5. **§9 notifications** — confirm **derive-first** as the committed default (persist only on
   §0 evidence), as written.
6. **Pro surface** — do the AI features warrant an "AI" section in `/settings` (usage, limits,
   toggle)?
7. **§15 import** — dedup strategy (hash of key fields vs. skip-on-match), and how unknown
   categories/accounts resolve (auto-create vs. map vs. Uncategorized)?
8. **§16 tags** — join table vs. `text[]` column; name-only vs. colored; do tags get a Reports
   breakdown chart, and are they free (recommended) or Pro?
9. **§17 splits** — split-line child table vs. linked sub-transactions; confirm splits stay
   single-account and exclude transfers.
10. **§18 forecast / §19 favorites** — free or Pro; forecast surface (Dashboard vs. Reports) and
    horizon (30/60/90 days).
11. **Parked promotion bars** — confirm/adjust the promotion criteria (multi-currency ~10–15%,
    mobile ~30% sessions) against your own targets. (Category Hierarchy is parked at low priority —
    expected to be fully replaced by Tags.)
