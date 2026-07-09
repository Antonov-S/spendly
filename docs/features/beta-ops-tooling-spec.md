# Beta Operations Tooling (script-first) — Implementation Spec

> **✅ Shipped (`feature/beta-ops-tooling`, 2026-07-10).** Implemented the script-first beta
> operations slice: `scripts/set-pro.ts` for dry-run-first one-user Pro flagging with explicit
> apply/production gates and D4 refusal rules; `scripts/beta-health.ts` for read-only launch
> telemetry health; pure `buildBetaHealthReport` with Vitest coverage; shared `scripts/db-env.ts`
> reused by the existing analytics operator scripts; and `BETA_HEALTH_WINDOW_DAYS = 7`. No app
> admin surface, route, schema/migration, billing change, rate-limit entry, analytics registry
> change, or dependency was added. Gates passed: `npm run test:run` (1100 tests), `npm run build`,
> and `npm run lint` (0 errors; 16 pre-existing warnings).

> This spec implements **[POST-MVP-ROADMAP.md](../POST-MVP-ROADMAP.md) §20 item 3** — the next
> implementation slice of Public Launch Readiness. Item 1 (the lean launch checklist / runbook)
> is an **operator doc**, not code, and can be written in parallel; item 2 (data-portability
> hardening) **shipped** (`feature/data-portability-hardening`). Items 4–6 (analytics smoke
> validation, CSP Stage B soak, the soft launch itself) all *consume* what this slice builds:
> the smoke validation runs `scripts/beta-health.ts` against the deployment, and the soft launch
> flags its beta cohort Pro via `scripts/set-pro.ts` so the Pro-gated AI features generate
> reviewable telemetry before Stripe is live.
>
> **Branch:** `feature/beta-ops-tooling`.

> **Goal:** Two operator-side scripts that make a small real-user beta runnable and observable
> **without adding any in-app surface**: **(1)** `scripts/set-pro.ts` — operator-controlled
> `isPro` flagging for beta users, done operator-side like the seed so the *"webhook is the only
> **in-app** Pro grant surface"* rule stays intact; **(2)** `scripts/beta-health.ts` — a
> read-only launch-telemetry pulse (latest event timestamp, event counts by name, active users,
> Pro-flagged users, AI run/failure counts, token/model telemetry presence) that answers "is the
> event stream alive and shaped right?" in one command. §20's exit criterion names this script
> directly: *"`scripts/beta-health.ts` shows a live event stream from real users."*

---

## 1. Why this slice

The soft launch (§20 item 6) has two operational prerequisites that no existing tool covers:

1. **Beta users must be Pro-flagged without Stripe.** The AI features (§3–§6) are the Pro value
   the review checkpoint must measure, but Stripe live mode is deliberately last/optional
   (§20 item 7). The only current ways to set `isPro = true` are the Stripe webhook (needs live
   payments) and the seed script (destroys/recreates demo users — unusable on real accounts).
   A targeted, safe, operator-side flip is missing.
2. **Nobody can tell whether launch telemetry is healthy.** `scripts/ai-review-report.ts` exists
   but answers the *checkpoint's* question (verdicts over a 28-day window) — against thin early
   data it mostly prints "insufficient". During the beta the operator needs a different, humbler
   question answered daily: *are events arriving at all, from how many users, with the AI
   token/model props present?* Today that's hand-written SQL or Prisma Studio spelunking.

Both are explicitly **rung 1** of §20 item 3's own escalation ladder. An **Operator Console v0**
(allowlisted in-app admin route) is rung 2, built **only if** the script workflow proves
insufficient during beta — too many beta users, a second operator, repeated need to check status
away from a terminal, scripts becoming error-prone. Note the roadmap's warning: an in-app admin
route would be the codebase's first deliberate **cross-user read surface**, which is exactly why
it must earn its way in with evidence. This spec builds only the scripts.

---

## 2. Scope

### In scope

- **`scripts/set-pro.ts`** — flip `User.isPro` on/off for one user by email, dry-run by default,
  with the house production-refusal gate and the safety refusals in D4.
- **`scripts/beta-health.ts`** — read-only telemetry pulse over a window (default
  `BETA_HEALTH_WINDOW_DAYS = 7`), printing the §4.2 report.
- **Pure report module** `src/lib/analytics/beta-health.ts` — `buildBetaHealthReport` takes plain
  event rows and returns the report structure. No Prisma, no I/O — fully unit-tested, so the
  script stays thin glue (same split as `review-metrics.ts` / `ai-review-report.ts`).
- **Shared script helper** `scripts/db-env.ts` — extracts the `parseHost` +
  `DEV_ENDPOINT_MARKER` + looks-production check that `prune-analytics.ts` and
  `ai-review-report.ts` currently each copy-paste; both new scripts use it, and the two existing
  scripts are retrofitted (behavior-preserving — the one existing-code touch of this slice).
- `BETA_HEALTH_WINDOW_DAYS = 7` in `src/lib/system-constants.ts`.

### Out of scope

- **Operator Console v0 / any in-app admin surface, route, or UI** — rung 2, evidence-gated
  (see §1). No `ADMIN_EMAILS`, no cross-user read path in the app.
- **Any change to billing code.** The Stripe webhook, `syncSubscription`, `linkCheckout`, and
  every in-app `isPro` read stay untouched. The script writes the same column the webhook does,
  from outside the app — exactly like the seed already does for the demo users.
- **Schema change / migration.** `User.isPro` and `AnalyticsEvent` already hold everything
  needed; operator-flagged Pro is distinguishable without a new column (D6).
- **Beta invite management, email sending, allowlists.** Who gets invited and how is the
  runbook's (item 1) and the product owner's business — the script only flags accounts that
  already exist.
- **Bulk flagging.** One email per invocation (D5). The beta cohort is small by definition; a
  file-of-emails mode is complexity with no rung-1 justification.
- **Verdicts in beta-health.** Deliberately none (D7) — verdicts belong to the checkpoint.

---

## 3. Decisions

**D1 — Scripts, not app code (rung 1).** Matches the roadmap verbatim and the existing operator
toolset (`prune-analytics.ts`, `ai-review-report.ts`, `reactivate-account.ts`). One operator, an
occasional command — a terminal is the right altitude. The rung-2 promotion triggers are recorded
in §1 so the later decision is objective.

**D2 — `set-pro` keeps the webhook rule intact by construction.** The security invariant is
*"the webhook is the only surface that may grant Pro"* — scoped to **in-app** surfaces (request
handlers, Server Actions, anything a user can reach). An operator-side script running with the
operator's own DB credentials is the same trust tier as `prisma db seed` (which already creates
`demo-pro` with `isPro: true`). The script writes **only** `isPro` — never `stripeCustomerId` /
`stripeSubscriptionId`, so no fake billing linkage can ever exist.

**D3 — Mutating script ⇒ house safety convention, verbatim.** `set-pro` is dry-run by default
(prints current state + what would change, mutates nothing), `--apply` performs the write, and
the `prune-analytics.ts` production-refusal gate applies: any host that isn't the known
development endpoint refuses `--apply` without an explicit `--production`. During the beta the
*intended* target **is** production — the gate is deliberate friction, not a prohibition: the
operator types `--production` consciously, per invocation. `beta-health` is read-only, so like
`ai-review-report.ts` it prints the host/environment banner for transparency but needs no gate.

**D4 — `set-pro` refusal rules (defense in depth, all exit 1 before any write):**

- **User not found** → refuse. The `--email` input is first normalized exactly the way
  registration normalizes it — trimmed and lowercased — so shell-typed casing never produces a
  spurious not-found. Beyond that, no fuzzy matching: the normalized input must match
  `User.email` exactly.
- **Soft-deleted user** (`deletedAt` set) → refuse. Reactivation is `reactivate-account.ts`'s
  job; silently flagging a deleted account Pro would be two mutations disguised as one.
- **Live Stripe linkage** (`stripeSubscriptionId` not null) → refuse **both directions**. That
  user's `isPro` is owned by the webhook; an operator flip would either be clobbered by the next
  subscription event or mask a real billing state. (Unreachable during a sandbox-only beta —
  the guard exists for the day it isn't.)
- **No-op flip** (already in the requested state) → report "already `isPro = <x>`, nothing to
  do" and exit 0. Idempotent re-runs are fine, like every other operator script here.

**The write re-asserts the same predicates it checked.** The refusals above are evaluated on a
read, and a webhook delivery (or another operator session) could change the row between that
read and the write. So the mutation is not a bare `update` by id — it is an `updateMany` whose
`where` folds the safety predicates back in:

```ts
const result = await prisma.user.updateMany({
  where: { id: user.id, deletedAt: null, stripeSubscriptionId: null },
  data: { isPro },
});
```

`result.count === 0` → the row changed underneath us; print which precondition no longer holds
(re-read and diff) and exit 1 **without retrying**. Same shape as the billing code's own
out-of-order-safe `updateMany` convention (`syncSubscription`). The read still happens first —
it exists to produce the *specific* refusal messages and the dry-run diff — but the write can
never succeed on state the checks didn't see.

Additionally — a printed **warning, not a refusal**: if the target has `analyticsOptOut = true`,
say so loudly. A Pro-flagged beta user who opted out generates **zero reviewable telemetry**,
which defeats the entire point of flagging them; the operator should know before inviting them
into the measurement cohort. (Opt-out remains the user's right — the script only surfaces it.)

**D5 — One email per invocation.** `--email <addr> --pro on|off` via the `argValue` pattern from
`ai-review-report.ts`. Small cohort, deliberate per-user friction, trivially auditable shell
history.

**D6 — Operator-flagged Pro is distinguishable without schema change.** The marker already
exists structurally: `isPro = true AND stripeSubscriptionId IS NULL` ⇔ operator-flagged (a real
subscriber always has the linkage the webhook wrote). `beta-health` prints both counts
("Pro users" / "of which operator-flagged") so the checkpoint reviewer can see how much of the
Pro cohort is beta-minted. If Stripe live mode ever launches mid-beta, this stays correct with
zero migration.

**D7 — `beta-health` reports health, never verdicts.** It deliberately does **not** compute
acceptance rates, bands, or expand/iterate/retire wording — that is `ai-review-report.ts`'s job,
run once at the checkpoint. Two reasons: (1) the checkpoint discipline (pro-value-review spec D3)
requires thresholds be confronted at review time, not peeked at daily until they look good;
(2) a health pulse with judgment attached invites mid-window course corrections that contaminate
the measurement. `beta-health` answers *"is telemetry flowing and well-shaped?"* — nothing else.

**D8 — Window default 7 days, overridable within bounds.** A health pulse looks at the recent
past, not the review window: `BETA_HEALTH_WINDOW_DAYS = 7` (system-constants, per the
no-magic-values rule), with `--days N` mirroring `ai-review-report.ts` — but **validated as a
bounded positive integer**: reject non-integers, `N ≤ 0`, and `N > ANALYTICS_RETENTION_DAYS`
(180 — rows older than retention don't exist, so a larger window silently lies about its span).
Out-of-bounds → print the accepted range and exit 1. Latest-event-timestamp is reported
regardless of window (a global `MAX(createdAt)`) — "the stream died 3 days ago" must be visible
even when the window still contains rows.

**D9 — Reuse, don't re-model.** The pure module takes the same row shape the review module
defined (`ReviewEventRow` from `src/lib/analytics/review-metrics.ts` — `{ name, props, userId,
createdAt }`), and the AI health section keys off the same `ai_result` registry entry
(`feature`, `outcome`, fail `reason`, and the Part B `input_tokens` / `output_tokens` / `model`
props). No new event, no registry change, no new emit site — this slice only *reads*.

**D10 — Minimum beta shape: a single-tester beta smoke is valid — and is named as such.** A
beta can legitimately start with **one** real user. One tester is enough to validate everything
this slice exists for: Pro flagging end-to-end, deployed telemetry persistence, AI event shape,
token/model telemetry presence, and basic real-user friction. It is **not** enough to draw
product conclusions about retention, conversion intent, Pro value, or AI feature acceptance —
those are cohort-level questions the checkpoint's small-N floors (`minUserDenominator = 10`)
already refuse to answer from one user. The framing matters: a one-user window is a **smoke
validation**, never a "beta result." Concretely: `set-pro` needs no special handling (it already
works one email at a time), and `beta-health` treats one active user as a **valid, non-failing
state** — no warning tone, no error exit — while printing an explicit framing note:
*"Single active beta user detected — valid for smoke validation, not cohort-level product
conclusions."* This keeps D7 honest at the smallest scale: the pulse says the pipes work; it
never implies the sample means anything.

---

## 4. Deliverables

### 4.1 `scripts/set-pro.ts`

```
npx tsx scripts/set-pro.ts --email beta@example.com --pro on                    # dry run
npx tsx scripts/set-pro.ts --email beta@example.com --pro on --apply            # dev only
npx tsx scripts/set-pro.ts --email beta@example.com --pro on --apply --production
npx tsx scripts/set-pro.ts --email beta@example.com --pro off --apply --production
```

Flow: parse args (`--email` required, trimmed + lowercased per D4; `--pro` required, exactly
`on|off`) → print host + environment banner (via `scripts/db-env.ts`) → `user.findUnique` by
the normalized email selecting
`{ id, email, isPro, deletedAt, stripeSubscriptionId, analyticsOptOut }` → apply D4 refusals /
warning → dry-run prints `isPro: <current> -> <target>` and exits, or `--apply` (gated per D3)
runs the D4 predicate-guarded `updateMany` and prints the result (`count === 0` → precondition
lost between read and write, exit 1). Follows `prune-analytics.ts` conventions exactly:
`dotenv/config`, `../src/lib/prisma`, `main().catch(…).finally(disconnect)`.

### 4.2 `scripts/beta-health.ts` + pure module `src/lib/analytics/beta-health.ts`

```
npx tsx scripts/beta-health.ts              # last BETA_HEALTH_WINDOW_DAYS (7) days
npx tsx scripts/beta-health.ts --days 30
```

**Pure module:**

```ts
import type { ReviewEventRow } from "./review-metrics";

export interface BetaHealthReport {
  latestWindowEventAt: Date | null;  // latest among the WINDOW rows handed in; the script
                                     // separately reports the GLOBAL latest (D8) — distinct
                                     // names because the two can legitimately disagree
  totalEvents: number;
  eventCountsByName: { name: string; count: number }[]; // count desc, name asc tie-break
  activeUsers: number;               // distinct userId in window
  ai: {
    okRuns: number;
    failRuns: number;
    failReasons: Record<"timeout" | "ai_error" | "parse_failed" | "no_match" | "rate_limited", number>;
    // Per-feature ok/fail pair, not ok-only: the likeliest real smoke signal is ONE
    // feature failing under a healthy-looking aggregate. Counts only — no verdicts (D7).
    runsByFeature: { feature: string; ok: number; fail: number }[];
    tokenTelemetry: {
      rowsWithTokens: number;        // ok runs carrying input/output token props
      share: number | null;          // rowsWithTokens / okRuns; null when okRuns = 0
      models: string[];              // distinct `model` slugs seen, sorted
    };
  };
}

export function buildBetaHealthReport(events: ReviewEventRow[]): BetaHealthReport;
```

Pure and window-agnostic (filtering happens in the script's query), defensive against malformed
`props` (non-object → ignored for AI/token fields, still counted by name), `no_match` counted as
a fail *reason* but visibly its own column — it is a designed degrade, and the operator reading
"failures" must be able to subtract it at a glance.

**Script:** validate `--days` per D8 (bounded positive integer) → print host/environment banner
+ window → **one** window-scoped `analyticsEvent.findMany` (select `name, props, userId,
createdAt`) → `buildBetaHealthReport` → three `console.table`s (stream summary, event counts by
name, AI health) — plus, from three cheap direct queries outside the pure module: the **global**
latest event timestamp (`findFirst orderBy createdAt desc`, so a dead stream is visible past the
window edge — D8; printed as **"Latest event (all time)"** next to the module's **"Latest event
(window)"**, so the two timestamps can never be misread for each other), user counts (`isPro`
total, operator-flagged per D6's
`stripeSubscriptionId: null` filter, and `analyticsOptOut: true` count as the invisible-users
caveat), and total user count. When `report.activeUsers === 1`, print the D10 framing note —
*"Single active beta user detected — valid for smoke validation, not cohort-level product
conclusions."* — as an informational line, never a warning or non-zero exit. Read-only: no
`--apply`, no gate.

### 4.3 `scripts/db-env.ts` (shared helper)

`export const DEV_ENDPOINT_MARKER`, `export function parseHost(connectionString)`,
`export function looksProduction(host)` — lifted verbatim from `prune-analytics.ts`.
`prune-analytics.ts` and `ai-review-report.ts` switch to importing it (behavior-preserving;
their console output is unchanged). Lives in `scripts/`, not `src/lib/` — it is operator-side
plumbing, not app code, and must never be importable by the app.

---

## 5. Files

| File | Change |
|---|---|
| `scripts/set-pro.ts` | **New** — operator Pro flag flip (§4.1) |
| `scripts/beta-health.ts` | **New** — read-only telemetry pulse (§4.2) |
| `src/lib/analytics/beta-health.ts` | **New** — pure `buildBetaHealthReport` (§4.2) |
| `scripts/db-env.ts` | **New** — shared host/production-marker helper (§4.3) |
| `scripts/prune-analytics.ts` | Import from `db-env.ts` (behavior-preserving) |
| `scripts/ai-review-report.ts` | Import from `db-env.ts` (behavior-preserving) |
| `src/lib/system-constants.ts` | `BETA_HEALTH_WINDOW_DAYS = 7` (D8) |
| `docs/POST-MVP-ROADMAP.md` | §20 item 3 shipped banner + Delivery row 16 note (on completion) |

No schema change, no migration, no new route, no UI, no new `RATE_LIMITS` entry, no Pro gate,
no new dependency, no change to any Server Action or `src/actions/**` file.

## 6. Testing

- `test/lib/analytics/beta-health.test.ts` — the bulk: empty input → zeroed report with
  `latestWindowEventAt: null` and `share: null`; event counts ordered count-desc/name-asc;
  distinct active-user counting; `ai_result` ok/fail split with the per-reason breakdown
  (including `no_match` landing in its own bucket); per-feature `{ feature, ok, fail }` grouping
  — including a feature with fails and **zero** oks, the one-feature-down-under-a-healthy-
  aggregate case the pair exists for; token-telemetry share from mixed with/without-token rows
  and the distinct sorted `models` list; malformed `props` (null / array / wrong types) neither
  crash nor pollute the AI section.
- Scripts stay thin glue — out of Vitest scope per house rules (`src/lib` + `src/actions` only);
  the pure module carries the logic precisely so this is true. `set-pro`'s D4 refusals are
  straight-line query-and-branch code exercised manually against the development branch
  (not-found, demo soft-delete, no-op, dry-run vs. `--apply`, and the predicate-guarded
  `updateMany` — assert `count === 1` on the happy path) before merge. `beta-health` manual
  checks: `--days` rejection at `0`, a non-integer, and `> ANALYTICS_RETENTION_DAYS`, **and
  acceptance at exactly `--days 180`** (the `ANALYTICS_RETENTION_DAYS` boundary is inclusive —
  the classic off-by-one to pin); the D10 single-active-user note printing as informational
  with exit 0.
- Gates: `npm run test:run`, `npm run build`, `npm run lint` all pass.

## 7. Open questions for the product owner

1. ~~**Beta-health window default** — 7 days assumed (D8). Confirm, or set your own pulse
   cadence.~~ **Resolved (2026-07-10):** keep `BETA_HEALTH_WINDOW_DAYS = 7` — it is a practical
   operational pulse, not a review window (the review window stays `AI_REVIEW_WINDOW_DAYS = 28`
   and belongs to `ai-review-report.ts`).
2. ~~**Should `set-pro --pro off` exist at all in v1?** Specced as symmetric (a mis-flagged or
   departing beta user needs an exit path), with the same gates. Say the word and it ships
   on-only.~~ **Resolved (2026-07-10):** keep `--pro off` in v1 — the safe cleanup path for
   mis-flagged or departing beta users, under the same D3/D4 gates as `on`.
3. ~~**Cohort record** — do you want the runbook (item 1) to keep a simple list of who was
   operator-flagged and when, or is `beta-health`'s operator-flagged count (D6) enough?~~
   **Resolved (2026-07-10):** the runbook keeps a simple beta cohort audit record — who was
   operator-flagged, when, and on/off — maintained by hand at each `set-pro --apply`. No code
   in this slice; the requirement is handed to item 1's checklist.

## 8. Alignment checks

- **"Script-first" honored literally** — zero app-surface change; the rung-2 Operator Console
  stays evidence-gated with its triggers recorded (§1).
- **Security invariant preserved** — no in-app code path gains the ability to grant Pro; the
  webhook remains the only in-app grant surface (D2), and the script can never fabricate billing
  linkage.
- **Checkpoint discipline preserved** — beta-health is verdict-free by design (D7); the
  thresholds stay confronted once, at review time, by `ai-review-report.ts`. The single-tester
  smoke framing (D10) extends the same honesty to the smallest scale: one user validates the
  pipes, never the product.
- **House conventions** — dry-run default + `--apply` + `--production` refusal gate for the
  mutating script; pure-module-plus-thin-script split for the testable one; constants in
  `system-constants.ts`; no magic values.
- **§20 exit criterion serviced** — after this slice, "beta cohort onboarded with `isPro` flags
  applied" and "`scripts/beta-health.ts` shows a live event stream" are both one command away.
