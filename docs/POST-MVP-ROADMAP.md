# Spendly Post-MVP Roadmap

> The MVP is complete (see [ROADMAP.md](./ROADMAP.md) — all of §0–§9 shipped, launch-day
> operator tasks aside). This document tracks the post-MVP path **from feature-complete demo to
> public launch, measurement, and later expansion**.
>
> Section numbers are **stable feature IDs, assigned in creation order** — they are *not*
> contiguous within a tier and are *not* build order; the build order is the **Delivery
> Sequence** near the end. Tiers:
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
> - **Launch Readiness (§20):** added 2026-07-07, after the committed tier finished shipping —
>   a **lean** pre-launch layer: a launch checklist/runbook plus a few focused hardening slices,
>   ending in a soft launch that makes the shipped surface **measurable**. Deliberately **not**
>   an infra build-out — Vercel CI/deploy and the Stripe sandbox already work. Sits **before**
>   the Pro Value Review checkpoint, which is now **condition-based, not calendar-based**.

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

**✅ §15 — Data Import shipped** (delivery slot 7, `feature/data-import`). The migration
counterpart to export, live at `/import` (from `/settings` → Data & privacy). Three Server
Actions (`inspectCsv` / `previewImport` / `commitImport`) — **not** an API route (a file upload
*can* be a Server Action) — drive **upload → (map, CSV only) → preview → confirm**; nothing is
written until the dry-run preview is confirmed. One pure pipeline (`src/lib/import/*`) for both
formats: RFC-4180 CSV parser + majority-vote dialect detection + index-based column mapping +
tolerant date/amount/type parsing; JSON via the strict-version / lenient-shape envelope parser.
One target account; INCOME/EXPENSE only (transfers skipped + counted); **count-based dedup** makes
re-import idempotent; categories resolved (NFC) and optionally created; atomic `createMany` write.
Tier-agnostic (no `isPro`), per-user rate-limited; no schema change. See
`docs/features/data-import-spec.md`.

**✅ §16 — Transaction Tags shipped** (delivery slot 8, `feature/transaction-tags`). Free-form,
user-owned labels orthogonal to categories (`Tag` + `TransactionTag` join, two additive tables +
a functional `(lower(name), userId)` unique index), created inline in the drawer, match-any
filterable in the feed, managed on `/settings`. Income/expense only; hard delete + confirm;
`createTransaction`/`updateTransaction` stay the sole writers. Not Pro-gated. Export/import of tags
deferred. Supersedes §12. See `docs/features/transaction-tags-spec.md`.

**✅ §5 — Monthly Review Narrative shipped** (delivery slot 10, `feature/monthly-review-narrative`).
The first "insight" AI assistant — a Pro-only "Generate summary" card at the top of `/reports` that
turns this-month-vs-last into 1–4 plain-language sentences. Read-only, fail-open, on-demand. A
deterministic `buildReviewFacts` owns every figure and a pure `validateReviewNumbers` guard drops any
line whose numbers aren't in the facts (the model phrases, never computes — D2). Figures reuse
`getCategorySpend` + `getBudgets` so the narrative never drifts from the charts; fixed month-over-month
window honoring `?account=`. Reuses the §3 foundation unchanged — prompt + parse + facts + card only,
no new client/orchestrator/Pro-read/rate-policy/schema. See
`docs/features/monthly-review-narrative-spec.md`.

**✅ §6 Smart Budget Suggestions shipped (delivery slot 11)** — the last of the four committed AI
capabilities. A Pro-only "Suggest budgets" panel on `/budgets` proposes deterministic per-category
ceilings (median-with-adaptive-round-up) from the 3 months before the viewed period; the model only
phrases each rationale, numeric-guarded. Read-only (accept goes through `createBudget`), fail-open, and
softer still (D5 — a phrasing failure degrades to deterministic copy, not nothing). Reuses §3 unchanged;
the one existing-code touch was extracting the shared numeric-guard core to `src/lib/ai/numeric-guard.ts`.
No schema change, no migration, no new `RATE_LIMITS` entry. All four AI features (§3–§6) are now
shipped. See `docs/features/smart-budget-suggestions-spec.md`.

**✅ §0 Telemetry shipped** (`feature/product-analytics`). The real first-party sink now persists
behind the existing `track()` shim — additive `AnalyticsEvent` table, typed event registry,
`/settings` opt-out toggle, starter product events, retention prune script. Resolves the
original sink/consent open question. See §0 below and
`docs/features/product-analytics-telemetry-spec.md`.

**▶ Next up: §20 Public Launch Readiness (lean).** Every committed delivery slot (1–15) has
shipped, and most launch infrastructure already exists — Vercel CI/deploy works, the environment
is production-like, and Stripe runs end-to-end in sandbox mode — but the app has **no public
domain and no real users**, so the Pro Value Review checkpoint cannot produce a meaningful
verdict on the originally implied **2026-08-03** date (the tooling would run, but against
local/demo usage it mostly returns "insufficient data"). The checkpoint is now
**condition-based**: it runs after **≥ 28 days of real production/beta telemetry following a
soft or official launch**, provided there is enough usage to evaluate the AI features. §20 is
deliberately **lean** — a launch checklist/runbook that confirms what already works, plus a few
focused slices: data-portability hardening (split + tag round-trip — the first real code slice),
script-first beta ops tooling (`scripts/set-pro.ts` + `scripts/beta-health.ts`; an Operator
Console v0 only if the scripts prove insufficient during beta), analytics smoke validation on
the deployment, CSP Stage B (which must never block launch), a soft launch/beta, and — last,
optional — Stripe live readiness.

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

> **✅ Shipped (`feature/product-analytics`).** First-party, server-side telemetry now persists
> through the existing `track(event, props?)` funnel — **zero changes to any of the ~18 existing
> emit sites**. New additive `AnalyticsEvent` table (migration `add_analytics_events`, keyed to
> `userId`, account-deletion cascade) + a `User.analyticsOptOut` column and a **"Usage analytics"**
> opt-out toggle in `/settings` Preferences (default on, legitimate-interest basis). The no-PII /
> no-financial-values contract is now **structural**: a typed event registry
> (`src/lib/analytics/events.ts`) allowlists each event's prop keys with per-key enum/type/slug
> validation, and the sink (`track.ts` → `src/lib/db/analytics.ts`) resolves auth → honors the env
> kill switch + opt-out → sanitizes against the registry → truncates oversized payloads → persists,
> **fail-open (never throws, never blocks a feature)**. Starter product-action events added at
> existing success points (`transaction_created`, `transfer_created`, `draft_confirmed`,
> `budget_created`, `goal_created`, `import_committed` with **bucketed** counts, `export_run`,
> `upgrade_to_pro_clicked`). Retention policy (`ANALYTICS_RETENTION_DAYS = 180`) + a dry-run-first
> `scripts/prune-analytics.ts` (production-refusal gate). **Resolves the original sink/consent
> open question** (first-party table + opt-out under legitimate interest); the Pro Value Review
> checkpoint is now unblocked pending a real production/beta telemetry window after §20 launch
> readiness. See `docs/features/product-analytics-telemetry-spec.md`.

**Effort: S · Value: high (de-risks every later decision) · Build early, alongside Phase 1.**

> *The prose below is the original pre-build plan, kept for the record — telemetry has since
> shipped; the banner above records the realized design.*

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

> *The prose below is the original pre-build plan, kept for the record — the shipped banner
> above records the realized design (model behind the `AI_MODEL` knob, currently `gpt-5-nano`;
> the provider key is long since back in `.env.example`).*

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

> **✅ Shipped (`feature/monthly-review-narrative`, delivery slot 10).** The first "insight" AI
> feature — a Pro-only "Generate summary" card at the top of `/reports` that phrases this-month-vs-last
> into 1–4 plain-language sentences. **Read-only, fail-open, on-demand (D1).** The load-bearing rule
> (D2): a deterministic `buildReviewFacts` (`src/lib/reports-review.ts`) owns every figure, and a pure
> `validateReviewNumbers` guard (`src/lib/ai/review.ts`) drops any generated line whose numbers aren't in
> the facts — the model only phrases, it never computes or invents. Numbers reuse `getCategorySpend`
> (split-aware) + `getBudgets` (rollover-aware) so the narrative agrees with the charts and `/budgets`
> bars. Fixed month-over-month window, honors `?account=`, ignores the period pills (D3). Reuses the §3
> foundation unchanged (`runAiFeature` / `aiJsonRespond` / `getAiProfile` / `track` / `--color-ai`) —
> only a prompt + parse + facts step + card, no new client/orchestrator/Pro-read/rate-policy/schema/
> migration (own burst bucket under the shared `aiSuggest` policy). `ai_numeric_guard` telemetry (counts
> only) measures how often the D2 guard fires. See `docs/features/monthly-review-narrative-spec.md`.

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

> **✅ Shipped (`feature/smart-budget-suggestions`, delivery slot 11).** A Pro-only "Suggest
> budgets" panel on `/budgets` proposes per-category ceilings from the user's own history, each a
> pre-filled, editable, one-tap-accept row through the existing `createBudget` — the AI never writes.
> **Load-bearing decision (D1): amounts are 100% deterministic** — a pure `buildBudgetSuggestionFacts`
> (`src/lib/budget-suggest.ts`) computes every ceiling (median of months-with-spend over the 3 complete
> months before the viewed period, rounded up to an adaptive €5/€10/€25 step, clamped to
> `BUDGET_AMOUNT_MAX`); the model only phrases a one-line rationale, and `validateSuggestionNotes` drops
> any note whose numbers aren't in the facts. Eligibility floors (≥2 months with spend, median ≥ €10)
> keep one-off/noise categories out; active-budget and uncategorized spend are excluded; archived slots
> stay suggestible (revived via `createBudget`'s upsert). Softer fail-open than §5 (D5): a phrasing
> failure degrades to deterministic fallback copy ("Median of your last 3 months of X spending."), not
> to nothing, tracked by `ai_phrasing_degraded`. Reuses the §3 foundation unchanged (prompt + parse +
> facts step + panel); the one existing-code touch was extracting the shared numeric-guard core to
> `src/lib/ai/numeric-guard.ts` (behavior-preserving — `review.test.ts` passes untouched). **No schema
> change, no migration, no new `RATE_LIMITS` entry.** Onboarding surface, multi-period plans, suggested
> `rollover`, and existing-budget tune-ups deferred (spec §12). See
> `docs/features/smart-budget-suggestions-spec.md`.

Propose per-category budget amounts from spending history — strongest in the empty-budget /
onboarding state, as one-tap accepts. Reuses the §3 foundation. Independent slice from §5.

**Success metrics:** acceptance rate of suggested amounts; budgets-created lift among users
shown suggestions; downstream budget-adherence.

**Decisions resolved (spec §6):** statistical baseline (median-with-adaptive-round-up) with AI
only for phrasing (D1), not model-driven; surface = `/budgets` empty and non-empty alike,
onboarding deferred (D3 — no history to compute from at onboarding).

---

## Checkpoint — Pro Value Review (after the core AI layer)

**Not a feature — a gate.** §3–§6 have all shipped (see the Delivery Sequence), giving Spendly
four AI capabilities: Auto-Categorization, NL Quick Capture, Monthly Review Narrative, and Smart
Budget Suggestions. Before expanding the AI surface any further (§13 later-stage assistants),
run a **formal review** against §0 data:

- **Is AI driving Pro?** Compare upgrade/retention for users who adopt ≥1 AI feature vs. those
  who don't. AI is a major plank of the Pro value proposition — this is the moment to confirm
  it pays.
- **Per-feature verdict.** Apply the expand/iterate/retire thresholds (see *Cross-cutting
  notes*) to each of the four. Retire or rework underperformers rather than stacking more on top.
- **Cost reality.** Check actual AI COGS per Pro user against the budget assumption — adjust
  the model, cap, or feature set if it's drifting.

**Outcome:** an explicit decision to (a) expand AI (promote items from §13), (b) iterate the
existing four, or (c) hold and let non-AI launch findings or parked backlog candidates carry
the next cycle. This
checkpoint is the dividing line between "committed AI layer" and "speculative AI expansion."

> **Measurement tooling shipped (`feature/pro-value-review`).** The checkpoint remains a gate,
> not an app feature: `src/lib/analytics/review-metrics.ts` defines the committed metrics and
> thresholds, `scripts/ai-review-report.ts` prints the read-only operator report, and
> `docs/reviews/pro-value-review-template.md` records the verdict. Additive `ai_result`
> token/model telemetry starts the COGS clock from this slice.
>
> **Trigger revised 2026-07-07 — condition-based, not calendar-based.** The original "earliest
> honest review date: 2026-08-03 (28 days after telemetry go-live)" implicitly assumed the app
> was live and collecting real production telemetry. It isn't — the app deploys via Vercel CI
> and the infrastructure is production-like, but there is no public domain and no real users, so
> a calendar-dated review would only measure local/demo usage. The review now runs after **≥ 28
> days (`AI_REVIEW_WINDOW_DAYS`) of real production/beta telemetry following a soft or official
> launch (§20)**, provided there is enough usage to evaluate the AI features. **"Enough" is
> objective, not a judgment call** — the frozen small-sample floors in
> `src/lib/analytics/review-metrics.ts` (`AI_REVIEW_THRESHOLDS.minRunDenominator = 20` runs per
> feature; `minUserDenominator = 10` users for user-sampled rates) already force the
> `insufficient` verdict below them. If the sample is too small at review time, record an explicit
> **"insufficient data"** verdict in `docs/reviews/pro-value-review-<YYYY-MM>.md` and **extend
> the measurement window** — never force an expand/iterate/retire call from noise. Until a
> completed review with a decision-grade sample exists, §13 stays parked.

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

> **✅ Shipped (`feature/in-app-notifications`, Delivery Sequence slot 12).** The insights strip is
> now also an app-wide **notification bell + popover panel** in the topbar (present on every
> `AppShell` page), answering "is there anything that needs me?" off `/dashboard`. Strictly **rung 1
> (derive-first)** — **no `Notification` table, no read/unread, no dismissal state (server or
> client-side)**; resolving an item on its linked page is the only "dismiss". The panel shows
> **per-entity, derived, link-out items** for four kinds — `budget-over` (danger), `budget-risk`
> (warning), `draft` (info), `goal-overdue` (warning), realizing the over/at-risk severity split the
> insights spec deferred — built from the **same single-sourced rules** as the strip (the at-risk
> threshold was extracted into one `budgetRiskLevel` predicate so the two surfaces can't disagree).
> Fed by a **lazy read-only Server Action** (`getNotifications`) called on mount + panel open (no prop
> threading through the 10 pages, never blocks paint), over a **channel-agnostic `server-only`
> service** (`deriveNotifications`) that composes the existing dashboard fetchers — **no schema
> change, no migration, no new queries, not Pro-gated, no account scoping**. Engagement telemetry
> (`notifications_derived` / `notification_panel_opened` / `notification_item_clicked`) ships through
> the no-op `track()` shim — the evidence the rung-2 persistence decision is gated on. See
> `docs/features/in-app-notifications-spec.md`.

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

## 10. Subscription Detection — heuristic first — ✅ Shipped (v1)

**Effort: M (heuristic v1) · Value: medium, grows with history.**

> **✅ Shipped — heuristic v1 (`feature/subscription-detection`, Delivery Sequence slot 13).** A
> **"Suggested templates" panel on `/recurring`** lists regular charges a pure deterministic engine
> (`src/lib/recurring-suggest.ts`) noticed — grouping candidate rows by
> `(normalizeLabelKey(merchant), type)` and applying a strict six-rule gate (≥3 occurrences, a
> WEEKLY 6–8d / MONTHLY 26–35d cadence band that *every* interval fits, amounts regular within ±15%
> of the median, series still alive, median ≥ €5). Each row offers **Create template** (pre-fills
> the existing `TemplateFormDrawer`, unsaved — `createTemplate` stays the sole writer) and
> **Dismiss**. **Zero AI coupling** — no `runAiFeature`, no prompt, no `--color-ai`, no Pro gate, no
> rate limit, no account scoping. Derivation is lazy on page load (joins the `/recurring`
> `Promise.all`, one bounded 12-month query), cron-free like `generatePendingDrafts`. The one schema
> change is the additive `RecurringSuggestionMute` model (`@@unique([userId, merchantKey])`) so a
> dismissed — or accepted — merchant stays suppressed; `muteRecurringSuggestion` is an idempotent
> upsert shared by both outcomes (accept also mutes, covering the drawer-rename edge). All thresholds
> are `SUBSCRIPTION_*` constants, also injectable into the engine as a `config` for tuning without an
> algorithm change. The `normalizeLabelKey` normalizer was extracted behavior-preserving from the
> import resolver (`src/lib/text.ts`; import suites pass unmodified). Telemetry (`recurring_suggested`
> / `recurring_suggestion_accepted` / `recurring_suggestion_dismissed`) rides the no-op `track()`
> shim, counts/enums only. **v2 (AI merchant normalization) remains deferred + evidence-gated.** See
> `docs/features/subscription-detection-spec.md`.

Spot recurring spend and **suggest** "make this a recurring template?" The `merchant` field was
added as future-proofing for exactly this, so the model is ready.

- **v1 — pure heuristic, no AI dependency.** Group by normalized merchant, detect regular
  amount/interval patterns, surface **user-confirmed suggestions** (never auto-create). Ships
  without any reliance on §3 — cheaper, deterministic, testable. *This is the committed scope.*
- **v2 — optional AI assist.** Use the §3 foundation only for fuzzy merchant normalization /
  edge cases, and **only if** §0/QA shows v1's heuristic precision is materially insufficient.
  AI coupling is explicitly deferred — do **not** reach for the model to ship v1. Strictly a
  later, evidence-gated enhancement, never a prerequisite.

**Why later (original rationale — v1 has since shipped lazy/cron-free):** value depends on
accumulated transaction history. The realized v1 computes lazily on the `/recurring` page load —
no scheduled/batched run was needed. §0 evidence now gates only the optional **v2 AI
merchant-normalization assist**, not the shipped heuristic.

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

## 16. Transaction Tags — ✅ Shipped

**Effort: M · Value: high (flexible organization; replaces §12).** Shipped as `feature/transaction-tags`
— see `docs/features/transaction-tags-spec.md` for the realized design.

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

> **✅ Shipped (`feature/split-transactions`).** `TransactionSplit` child table (additive migration
> `add_transaction_splits`; **no `Transaction.isSplit` column** — split status is derived from child-row
> presence; no CHECK constraint). EXPENSE-only, single-account, **not Pro-gated**. Aggregation rewired
> through one shared `getCategorySpend` (`src/lib/db/split-spend.ts`, a two-`groupBy` union — non-split
> rows via `splits: { none: {} }` + split lines — so double-counting is *structurally* impossible),
> consumed by `getBudgets`, `resolveRolloverCarry`, `getBudgetsData`, and `getCategoryBreakdown`;
> `getMonthlyComparison` / balances / `getReportTxCount` bucket by amount+date and are unchanged.
> `createTransaction`/`updateTransaction` stay the sole writers (splits ride the existing atomic
> `$transaction` with tags; parent `categoryId` nulled when split; update replaces lines). Drawer gains a
> "Split" mode (per-line category+amount+note, live running total, **"Distribute remaining"**, must-sum
> Save gate; pure logic in `src/lib/split.ts`); the `/transactions` feed row shows a `Split · N` chip and
> expands (a11y disclosure); the dashboard recent list shows the chip, not expandable. JSON export bumped
> to **`schemaVersion: 2`** with a nested `splits` array (+ derived `isSplit`); CSV labels the Category
> `Split`. `round2` extracted to `src/lib/money.ts`; `formatCurrencyCents` added. **Import of splits is
> deferred** — the JSON path writes splits but doesn't read them back in v1 (a round-trip flattens a split
> to Uncategorized); the top post-release follow-up. Feed search over split-line categories/notes also
> deferred. See `docs/features/split-transactions-spec.md`.

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

> **✅ Shipped (`feature/cash-flow-forecast`, Delivery Sequence slot 14).** A read-only
> `ForecastPanel` card on `/dashboard` (right column, below Goals) projects the balance forward
> **30 days** from **active recurring templates + pending drafts** — "you'll dip to €240 around the
> 28th, before salary." A pure deterministic engine (`src/lib/forecast.ts`, `buildCashflowForecast`)
> folds signed future occurrences over the horizon into a daily end-of-day balance series, a low
> point, and an end-of-horizon balance; it reuses `advanceNextOccurrence` + `startOfUtcDay` +
> `round2` (no new date/money math). The **load-bearing skip rule:** a template with an outstanding
> PENDING draft starts stepping one occurrence past `nextOccurrence` (which isn't advanced until the
> draft is confirmed/dismissed), so the template and its draft never double-count the head of the
> series — the no-draft and draft-minted states produce provably identical series. Overdue
> occurrences clamp to day 0 (stepping continues from the unclamped date to preserve rhythm). The
> **anchor is `summary.totalBalance`** — the fold happens in-process on the page (the fetcher
> `getScheduledItems` reads scheduled items only), so the projection can never drift from the hero
> number. One constant `FORECAST_HORIZON_DAYS = 30`. Dependency-free module-private SVG: dashed
> neutral line (the "this is a projection, not history" cue) + faint area, `--color-danger` only for
> the portion below zero, `role="img"` a11y summary, real-DOM facts row (`Lowest` + `In 30 days`
> with signed delta). Hidden entirely when `eventCount === 0`. **Zero AI, zero writes, zero schema,
> zero migration, no Pro gate, ignores `?account=`** (extends the all-accounts hero balance).
> Refreshed for free by the `revalidatePath("/dashboard")` every recurring mutation already fires.
> See `docs/features/cash-flow-forecast-spec.md`.

Project the balance forward from **active recurring templates + pending drafts** — "you'll dip to
€240 around the 28th before salary." Forward-looking *awareness*, not optimization or automation:
it only projects items the user already set up. Reuses recurring data; read-only.

**What to build:** a pure projection (current balance + scheduled recurring occurrences over a
horizon) rendered as a small line/area — on the Dashboard (state-adjacent) or Reports. No new
mutations.

**Resolved decisions:** surface = **Dashboard** (right column below Goals — forward-looking state);
horizon = **fixed 30 days** (`horizonDays` param + constant leave the 60/90 seam open); include
**pending drafts AND active templates** with the skip rule; **Free** (deterministic, zero COGS,
core-awareness). See spec §10.

---

## 19. Quick-Add Favorites

**Effort: S–M · Value: medium (fast manual entry). Lighter enhancement.**

> **✅ Shipped (`feature/quick-add-favorites`, Delivery Sequence slot 15).** A new user-owned
> `Favorite` model stores on-demand INCOME/EXPENSE capture shortcuts (type, optional amount,
> optional category/account, merchant, note). Favorites are saved from the create-mode
> transaction drawer, managed on `/settings` (edit/reorder/delete), and shown as a neutral
> two-column chip grid in the drawer. Tapping one **pre-fills an unsaved draft** via `buildFavoritePrefill`;
> `createTransaction` remains the sole ledger writer. Null amount = prompt-on-use (clears and
> focuses the amount field); stale/deleted category falls back to Uncategorized; archived stored
> accounts fall back to the current default and are flagged in settings. Case-insensitive
> per-user names are protected by a functional `(lower(name), userId)` unique index. The committed
> follow-up adds full-field Settings edits plus accessible move controls backed by nullable
> `sortOrder`; post-save nudges and favorite tags stay telemetry-gated, and splits on favorites are
> rejected for now. **Free, no AI, no Pro gate, no transfer/split/tag favorites in v1.** See
> `docs/features/quick-add-favorites-spec.md` and `docs/features/favorites-follow-ups-spec.md`.

Saved one-tap common transactions — "Coffee €3.50 / Dining" — that pre-fill the drawer as an
**unsaved draft**. Distinct from recurring templates (which are *scheduled*); these are *on-demand*
shortcuts serving the 5-second-capture goal.

**What to build:** a small `Favorite`-style store (`type`, optional `amount`, `category`,
`account`, `merchant`); a favorites strip/menu in the drawer or quick-add that pre-fills (never
silently writes — the user still confirms). Reuses `createTransaction`.

**Resolved decisions:** free, not Pro-gated; pre-fill draft, never one-tap create; surfaced in
the create-mode drawer with management on `/settings`; fixed amount when set and prompt-on-use
when null; name-ascending order in v1.

---

# Launch Readiness

---

## 20. Public Launch Readiness (lean checklist + focused hardening slices)

**Effort: S–M (an operator checklist + a few small slices — not a build-out) · Value: critical —
makes the shipped roadmap measurable. Sits before the Pro Value Review checkpoint.**

> Added 2026-07-07, when the committed tier finished shipping; **framed lean deliberately.** The
> checkpoint logic implicitly assumed Spendly was already collecting real production telemetry.
> It isn't — but the gap is much smaller than a from-scratch launch: **Vercel CI/deploy already
> works, most production-like infrastructure is in place, and Stripe runs end-to-end in sandbox
> mode** (it simply can't process real payments until/if monetization is pursued). What's missing
> is a public domain, real users, and *validated* telemetry — `scripts/ai-review-report.ts` runs
> today but mostly returns "insufficient data" against local/demo usage. So §20 is **not one big
> umbrella feature branch**: it is a short runbook that confirms what already works, a small
> number of focused hardening slices, and a soft launch that starts the checkpoint's ≥ 28-day
> clock.

Work items, in rough order:

1. **Lean launch checklist / runbook** *(operator doc)* — one short document confirming what
   already works and what must be checked before soft launch: Vercel deployment + CI/build/test
   pipeline, production env vars (`AUTH_URL`, `AUTH_SECRET` rotation), production URL / domain
   choice, Google OAuth production callback, the Stripe **sandbox** flow, analytics event
   persistence, a backup/restore check, the soft-launch audience, and whether beta users get
   `isPro` operator-flagged so the Pro-gated AI features generate reviewable telemetry. Three
   checks called out explicitly:
   - **Email deliverability** *(domain-gated — checked once the public domain exists, before
     beta invites; not a separate implementation task)*: decide whether email verification is
     on or off for the beta (`EMAIL_VERIFICATION_ENABLED`); if on, verify the Resend production
     sender domain and configure `EMAIL_FROM` (the dev sender `onboarding@resend.dev` is not
     launch-grade).
   - **Public privacy page** *(real pre-beta requirement)*: real EU users must be able to read
     what's stored, the analytics legitimate-interest basis + opt-out, and their export/delete
     rights **before signing up** — today that disclosure lives only behind auth in `/help`.
   - **Rate limiting** *(verification, not setup — Upstash is already configured in
     production)*: confirm the Upstash env vars are present in the production environment and
     that rate-limited paths are actually using Redis-backed limits rather than silently
     falling back to the fail-open behavior.
2. **✅ Data portability hardening** *(shipped, `feature/data-portability-hardening`)* — JSON export is
   `schemaVersion: 3` and JSON import preserves split attribution and transaction tag associations for
   rows it creates, including same-user v2 split backups through category-id fallback. CSV remains the
   unchanged flat ledger, and a JSON export → import fixture proves important user data is not silently
   lost.
3. **✅ Beta operations tooling — script-first** *(shipped, `feature/beta-ops-tooling`)* —
   operator-side tooling now covers the small-beta run loop without adding any app/admin surface:
   `scripts/set-pro.ts` dry-runs by default and flips one existing user's `isPro` flag on/off by
   normalized email only under explicit `--apply` / production-friction gates, refusing missing,
   soft-deleted, and Stripe-linked users; `scripts/beta-health.ts` is a read-only telemetry pulse
   over the recent analytics window (latest all-time/window events, event counts, active users,
   Pro/operator-flagged counts, AI ok/fail/reason counts, token/model shape). The health math lives
   in pure `buildBetaHealthReport`, and shared DB host detection is centralized in `scripts/db-env.ts`.
   An **Operator Console v0** is the explicit **rung 2**, built **only if** the script workflow
   proves insufficient during beta (too many beta users, a second operator, repeated need to
   check status away from the terminal, scripts becoming error-prone). If promoted it stays
   narrowly scoped — allowlisted access (e.g. `ADMIN_EMAILS`), telemetry/user overview, beta
   `isPro` handling — with **no** financial-data editing, **no** destructive account actions,
   and **no** billing management. A full admin panel stays out of scope entirely; note any
   in-app admin route would be the codebase's first deliberate cross-user read surface, which is
   exactly why it must earn its way in.
4. **Analytics smoke validation** *(operator + smoke, on the Vercel deployment)* — confirm
   `AnalyticsEvent` rows are written against real deployment data: core product events, AI
   events including token/model telemetry, opt-out honored end-to-end, a
   `scripts/prune-analytics.ts` dry run, and a smoke run of `scripts/ai-review-report.ts`.
5. **CSP Stage B** *(small code flip — `docs/fixes/security-headers-spec.md`)* — move from
   Report-Only to enforcing **only after** Google OAuth (incl. the no-JS form-POST path) and the
   Stripe **sandbox** checkout round-trip have been exercised in a real browser window with zero
   violations. Valuable hardening, but it must **never block the soft launch** by breaking auth,
   forms, or third-party flows — if the soak isn't clean in time, launch on Report-Only and flip
   later.
6. **Soft launch / beta measurement** — a limited beta with real users to generate meaningful
   telemetry: surface launch blockers and confirm behaviour outside local/demo usage. This is
   the event that starts the checkpoint's ≥ 28-day window. Since the AI features are Pro-gated
   and Stripe isn't live, beta users are `isPro`-flagged via `scripts/set-pro.ts` (item 3) if
   the review is expected to measure AI usage before real monetization.
7. **Stripe live readiness** *(last; optional — must not block the rest of §20)* — Spendly is
   currently a hobby/demo project and monetization may never happen. If/when it becomes
   relevant: live products/prices, live webhook endpoint + secret, a successful checkout
   round-trip, cancel/resubscribe scenarios, and verification that Pro entitlement is granted
   correctly after payment (the webhook remains the only code surface that grants Pro).

**Exit criterion — §20 is done when:** the app is reachable on its public domain, every runbook
check passes, the beta cohort is onboarded (with `isPro` flags applied where decided),
`scripts/beta-health.ts` shows a live event stream from real users, and the ≥ 28-day Pro Value
Review telemetry window has started. Stripe live readiness (item 7) is explicitly **not** part
of the exit bar.

**Explicitly not in this phase:** promoting any parked item (§11–§14) — they stay parked until
real production/beta evidence exists — and any heavy "build launch infrastructure" project. The
job is to **tighten and validate the mostly-working Vercel/CI/sandbox setup**, close the known
data-portability gap, and run a small real-user beta that makes the checkpoint measurable.

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

Additional assistants on the §3 foundation, deferred until the core four (§3–§6) prove their
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
| 8 | **Transaction Tags (16)** | Committed | M | No | **✅ Shipped.** `Tag` + `TransactionTag` join (+ functional CI-unique index); inline create in the drawer, match-any feed filter, `/settings` management; income/expense only; hard delete; export/import deferred. Replaces §12 at a fraction of the cost. |
| 9 | **Split Transactions (17)** | Committed | M | No | **✅ Shipped.** `TransactionSplit` child (derived split status, no `isSplit` column); one shared `getCategorySpend` two-`groupBy` union rewires budgets/rollover/dashboard/reports (double-count structurally impossible); EXPENSE-only, single-account; JSON `schemaVersion: 3` after data-portability hardening restores split attribution and tags on import. Everyday categorization accuracy; highest blast radius of the non-AI wins. |
| 10 | Monthly Review Narrative (5) | Committed | M | **Yes** | **✅ Shipped.** First "insight" assistant — Pro `/reports` "Generate summary" card phrasing this-month-vs-last. Deterministic `buildReviewFacts` owns every figure; pure `validateReviewNumbers` guard drops any misquoted line (model phrases, never computes — D2). Reuses §3 foundation + `getCategorySpend`/`getBudgets`; read-only, fail-open; no schema. |
| 11 | Smart Budget Suggestions (6) | Committed | M | **Yes** | **✅ Shipped.** Pro-only "Suggest budgets" panel on `/budgets`; deterministic per-category ceilings (median-with-adaptive-round-up) from the 3 months before the viewed period, model phrases each rationale (numeric-guarded — D1). Read-only (accept via `createBudget`), fail-open, softer D5 degradation. Reuses §3; extracted the shared numeric-guard core to `numeric-guard.ts`. No schema change, no migration, no new rate entry. |
| 12 | In-App Notifications (9) | Committed | M | No | **✅ Shipped.** Topbar bell + popover panel on every `AppShell` page; per-entity derived items (budget-over/at-risk/draft/goal-overdue) from single-sourced rules (`budgetRiskLevel` extraction); lazy read-only `getNotifications` action over channel-agnostic `deriveNotifications`; **derive-first, no persistence**; telemetry via `track()` shim. No schema change, no new queries. Consistency insight deferred (needs a stored preference). |
| 13 | Subscription Detection — heuristic (10) | Committed | M | No | **✅ Shipped.** "Suggested templates" panel on `/recurring`; deterministic engine (`recurring-suggest.ts`) groups by normalized merchant + type, strict six-rule gate (WEEKLY/MONTHLY only), median-amount ranking; Create-template pre-fills the drawer (`createTemplate` sole writer), Dismiss/accept persist via additive `RecurringSuggestionMute`. **No AI dep, no Pro gate, no rate limit**; lazy page-load derivation; `normalizeLabelKey` extracted behavior-preserving. v2 AI assist deferred. |
| 14 | Cash-Flow Forecast (18) | Committed | M | No | **✅ Shipped.** Read-only `ForecastPanel` on `/dashboard` (right column below Goals) projects the balance 30 days forward from active templates + pending drafts. Pure deterministic `buildCashflowForecast` folds signed occurrences over the horizon (load-bearing skip rule prevents template/draft double-count); anchored on `summary.totalBalance` in-process so it can't drift from the hero number. Dashed neutral SVG, `danger` below zero, hidden at `eventCount === 0`. **Zero AI, zero writes, zero schema, no Pro gate.** Reuses `advanceNextOccurrence`. |
| 15 | Quick-Add Favorites (19) | Committed | S–M | No | **✅ Shipped.** User-owned on-demand drawer shortcuts (`Favorite` + functional CI-unique index); save from create-mode drawer, manage edit/reorder/delete on `/settings`; tap pre-fills an unsaved draft only (`createTransaction` sole writer). Free, no AI, no Pro gate. |
| 16 | **Public Launch Readiness (20)** | Launch | S–M | No | **▶ Next — lean.** The first two code slices are **✅ shipped**: data-portability hardening restored JSON split/tag round-trips, and script-first beta ops tooling added `set-pro` / `beta-health` (Operator Console v0 only on evidence). Remaining launch-readiness work is the public-domain / real-user track: runbook confirming the existing Vercel + Stripe sandbox setup, analytics smoke validation using `beta-health`, CSP Stage B (never blocks launch), soft launch (`isPro`-flagged beta), Stripe live last/optional. Makes the checkpoint below measurable. |
| ✦ | **Pro Value Review checkpoint** | Gate | — | — | **Measurement tooling shipped; trigger now condition-based** — runs after ≥ 28 days of real production/beta telemetry following the §20 launch, with enough usage to judge the AI features (the frozen minimum-sample floors in `review-metrics.ts`). Sample too small → record an explicit **"insufficient data"** verdict and extend the window. Record `docs/reviews/pro-value-review-<YYYY-MM>.md`, then decide whether to grow the AI surface (gates §13). |
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
be fully replaced by Tags (kept parked, not killed). **Launch Readiness (§20) closes the committed
sequence** — the shipped surface is feature-complete, but nothing above it is measurable (and the
checkpoint cannot fire) until the app is live, observed, and collecting real telemetry.

---

## Cross-cutting notes

- **AI foundation is built once (§3) and reused** (§4–§6, §10 v2, §13). It must: read `isPro`
  from the DB, rate-limit + cost-cap per user, **fail open** to the manual flow, never become a
  write path (suggestions only), and **emit acceptance telemetry** (§0). All of this is realized
  in the shipped §3 foundation (including the provider key, back in `.env.example`).
- **Every AI feature ships instrumented and is judged on explicit thresholds** — define them in
  each spec before building, then act on the numbers, not intuition. A shared starting rubric
  (calibrate to real baselines):

  | Verdict | Trigger (per feature, measured over a stable window) |
  |---|---|
  | **Expand** | High acceptance (suggestion-acceptance / confirm-without-heavy-edit **≥ ~60%**) **and** positive Pro signal (adopters show better conversion/retention than non-adopters). |
  | **Iterate** | Mixed — acceptance in a middle band (**~30–60%**) or flat Pro signal. Rework the prompt/surface, re-measure before any expansion. |
  | **Retire** | Low acceptance (**< ~30%**) or negative cost/UX trade-off after one iteration. Pull the feature rather than carry dead weight. |

  These percentages are **no longer placeholders** — they are frozen as `AI_REVIEW_THRESHOLDS`
  in `src/lib/analytics/review-metrics.ts` (D3 approved as written: 0.6 / 0.3, plus the
  monthly-review engagement variant 0.4 / 0.15 / 0.25-repeat and the min-sample floors), and the
  review script enforces them. Recalibration happens only through a deliberate constant change,
  not by re-arguing the numbers at review time. The **Pro Value Review checkpoint** (after §6)
  applies this rubric to the core four at once.
- **AI cost budget — target ≤ ~10% of net Pro revenue (~€0.20–0.30 / Pro user / month).** Pro is
  €3/mo (≈ €2.08/mo on the annual plan), less Stripe fees — so the COGS ceiling for *all* AI a
  Pro user consumes is small but very comfortable: the cheap configured model (`AI_MODEL`,
  currently `gpt-5-nano`) handles a categorization or NL-parse call in a few hundred tokens for
  a fraction of a cent, so even heavy daily use stays well under budget. This assumption guides three things: the
  **model choice** (stay on cheap models until a feature proves it needs more), the **§3 monthly
  per-user cost cap** (set it to enforce this ceiling), and **AI expansion** (each new assistant's
  projected cost-per-Pro-user is checked against the remaining budget headroom before commit).
  Re-validate actual COGS at the Pro Value Review checkpoint.
- **Telemetry (§0) gates the parked tier** — Notifications persistence (§9 rung 2), the
  Subscription Detection v2 AI assist (§10), and especially Multi-Currency (§11) are
  escalation/parked decisions that §0 data is meant to settle.
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

> Cleaned up 2026-07-07 — questions resolved by shipped slices (the §0 sink + consent model, AI
> provider/model choice, the expand/iterate/retire thresholds, §5/§6 surfacing, §9 derive-first,
> §15 dedup, §16 tags, §17 splits, §18/§19 gating) were removed; their resolutions are recorded
> in the corresponding shipped specs under `docs/features/`. Only active questions remain.

1. **§20 soft launch** — audience and size (invite-only friends/colleagues vs. public), domain
   choice, and whether beta users get `isPro` flipped by the operator so the Pro-gated AI
   features generate reviewable telemetry during the window (without it, the Pro Value Review
   has nothing to measure until Stripe live readiness lands).
2. **§20 Stripe monetization** — will it be pursued at all? Spendly is currently a hobby/demo
   project and Stripe already works end-to-end in sandbox. Decide whether §20 item 7 (live mode)
   is a real (if last) roadmap step or Pro remains an operator-flagged tier indefinitely — the
   answer also caps how meaningful the "is AI driving Pro?" half of the Pro Value Review can
   ever be.
3. **Pro surface** — do the AI features warrant an "AI" section in `/settings` (usage, limits,
   toggle)?
4. **Parked promotion bars** — confirm/adjust the promotion criteria (multi-currency ~10–15%,
   mobile ~30% sessions) against your own targets. (Category Hierarchy is parked at low
   priority — expected to be fully replaced by Tags.)
