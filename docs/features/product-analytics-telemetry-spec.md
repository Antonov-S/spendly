# Product Analytics / Telemetry (§0) — Implementation Spec

> **Roadmap:** POST-MVP-ROADMAP §0 (Foundation tier). **Branch:** `feature/product-analytics`.
> **Effort:** S. **Pro-gated:** No (infrastructure, not a feature).
>
> **Status: 📋 Planned** — the last unshipped item in the committed tiers. Every delivery slot
> (1–15) has shipped; the Pro Value Review checkpoint is next in the sequence, and it is
> **blocked on this slice**: the rubric compares acceptance rates and Pro adoption, but today
> every `track()` call lands in a no-op shim. §0 turns those emissions into queryable evidence.

---

## 0. Sequencing notes — read before building

- **The shim already exists and the contract is fixed.** `src/lib/analytics/track.ts` is a
  no-op `track(event, props?)` that 18 call sites across AI, notifications, favorites, and
  recurring-suggestions already emit through. Its doc comment is the load-bearing promise:
  *"§0 swaps the body for the real sink without touching any call site."* This slice must
  honor that — **zero changes to any existing emit site**, including their `await track(...)`
  vs `void track(...)` styles.
- **No PII, no financial values — already the honored contract, now checked.** Every existing
  emitter sends counts, enums, flags, and version numbers only (`feature`, `prompt_version`,
  `reason`, `kind`, `edited`, …). This slice converts that honor-system contract into a
  structural one: the typed event registry (§4a) allowlists each event's prop keys and the
  sink strips anything else, so a future emit site can't accidentally ship PII into the
  table. The sink itself never *adds* identifying data beyond the `userId` key (see §5 for
  the GDPR treatment of that).
- **This resolves roadmap Open question #1** (sink + consent model). The decisions are made in
  §10 below: **first-party events table** + **opt-out toggle under legitimate interest**. If
  the product owner overrules toward PostHog/Plausible later, the swap is again a body swap of
  `track()` — the single-funnel design is the whole point.
- **Measurement window follows shipping.** After merge, let real usage accumulate (a few weeks
  post-launch), then run the **Pro Value Review checkpoint** against the `ai_result` /
  acceptance events. This spec adds the plumbing; the checkpoint itself is a product exercise,
  not code.

---

## 1. Why this slice

Spendly has zero product analytics. The backlog's remaining decisions are all explicitly
gated on §0 evidence:

- **Pro Value Review checkpoint** — expand/iterate/retire verdicts for the four AI features
  (§3–§6) need acceptance rates (`ai_result` outcomes, `ai_category_accepted` vs
  `_overridden`, `ai_parse_confirmed` edit rates, `ai_budget_suggest_accepted`).
- **§9 rung 2** — notification persistence is built only if `notification_panel_opened` /
  `notification_item_clicked` engagement justifies it.
- **§10 v2** — the AI merchant-normalization assist is gated on `recurring_suggested` /
  `_accepted` / `_dismissed` precision data.
- **Parked tier** — Multi-Currency (§11) and Mobile/PWA (§14) promotion bars are usage-share
  thresholds that are currently unmeasurable.

Every one of those events is **already emitted**. The only missing piece is a sink.

---

## 2. Scope

### In scope

1. An additive **`AnalyticsEvent`** Prisma model + migration (`add_analytics_events`) — the
   first-party sink.
2. A **`User.analyticsOptOut Boolean @default(false)`** column (same migration) + a
   **"Usage analytics"** toggle in the `/settings` Preferences card.
3. A **typed event registry** (`src/lib/analytics/events.ts`) — the declared catalog of every
   event name and its allowed prop keys; the sink enforces it at runtime (§4a).
4. The **`track()` body swap**: resolve session → honor opt-out + env kill switch → validate
   against the registry → persist — **fail-open, never throws, never blocks a feature**.
5. A **starter event set** for core product actions the roadmap names (transaction / budget /
   goal created, draft confirmed, export run, import committed, upgrade-to-Pro clicked) —
   thin `void track(...)` additions at existing success points. Volume counts that reveal
   ledger size are **bucketed**, never raw (§7).
6. A **retention policy** (`ANALYTICS_RETENTION_DAYS`) + a manual prune script
   (`scripts/prune-analytics.ts`) — pruning stays operator-run in v1, but the policy is
   declared, not deferred.
7. `.env.example` + constants + `/help` Data & privacy copy + a documented Legitimate
   Interest Assessment (§5.1) + Vitest coverage.

### Out of scope (explicit)

- **Client-side / page-view / session analytics.** `track` is `server-only`; there is no
  browser beacon, no cookie, no client SDK. Page-open and mobile-session-share measurement
  (the §14 promotion bar) would require a client channel and its own consent analysis — a
  separate, later slice. v1 measures **actions**, not views.
- **Third-party provider (PostHog/Plausible).** Decided against for v1 (§10 D1); the seam
  stays open.
- **User-facing analytics surface.** No dashboard of "your usage" — analysis happens via
  read-only SQL against the Neon branch (operator workflow). Roadmap's "surface it back to
  the user" question → answered **no** for v1.
- **Retention/auto-purge cron.** The app is deliberately cron-free. The retention *policy*
  and a manual prune script **do ship** (§6); only the *automation* (cron/scheduled purge)
  stays out, as a named seam.
- **Exporting analytics events in the JSON data export.** Deferred; noted in §11.
- **New rate limits.** Events are emitted only by our own server code after auth; the
  sensitive entry points are already rate-limited upstream.

---

## 3. Schema (additive migration `add_analytics_events`)

```prisma
// ─── AnalyticsEvent ───────────────────────────────────
// First-party telemetry sink (POST-MVP §0). Written ONLY through
// src/lib/analytics/track.ts — no feature code touches this model directly.
// Contract: event names + outcome counters only; NO PII, NO financial values.

model AnalyticsEvent {
  id        String   @id @default(cuid())
  name      String   // snake_case event name, e.g. "ai_result"
  props     Json?    // counts / enums / flags only — never amounts, names, merchants
  createdAt DateTime @default(now())

  userId String

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([name, createdAt])
  @@index([userId, createdAt])
}
```

Plus on `User`:

```prisma
  analyticsOptOut Boolean @default(false)
  analyticsEvents AnalyticsEvent[]
```

**Notes:**

- `userId` is **required**. All 18 existing call sites run post-auth; an event with no
  resolvable session is **dropped** (§4 rule 2), not stored anonymously. This keeps the model
  honest and makes the GDPR story clean: **account deletion cascades telemetry away** (the
  30-day-grace hard purge removes the user row → `onDelete: Cascade` erases every event).
- `props Json?` mirrors the shim's open `Record<string, string | number | boolean>` — no
  migration needed when a feature adds a key, exactly as the shim's comment promises.
- `@@index([name, createdAt])` serves the analysis queries (acceptance rate per feature per
  window); `@@index([userId, createdAt])` serves adopter-vs-non-adopter cohort queries and the
  cascade path.
- Standard rule applies: `prisma migrate dev` on the `development` Neon branch, never
  `db push`.

---

## 4. The sink — `track()` body swap

`src/lib/analytics/track.ts` keeps its exact signature and `server-only` import. New body,
in order:

1. **Env kill switch** — if `ANALYTICS_ENABLED === "false"`, return (mirrors the
   `EMAIL_VERIFICATION_ENABLED` read-as-not-false pattern). The `ANALYTICS_DEBUG` console
   line stays before the switch so local debugging works even with persistence off — but it
   is **additionally gated on `NODE_ENV !== "production"`**, so a debug flag accidentally
   left set in prod can never print user-linked payloads into production logs.
2. **Resolve the session** — `const session = await auth()`; no `session?.user?.id` → return
   (drop). JWT strategy means this is a cookie read, not a DB round-trip.
3. **Honor opt-out** — one PK lookup `user.findUnique({ select: { analyticsOptOut } })`;
   `true` (or user row missing) → return. Opt-out must actually stop processing — filtering
   at analysis time is not GDPR-compliant.
4. **Validate against the registry (§4a)** — `sanitizeProps(event, props)` returns a
   discriminated `SanitizeResult`: `{ ok: false }` (unregistered event name) → return
   without persisting (dev-only warning); `{ ok: true, props }` → continue with the
   sanitized payload, from which unregistered keys, wrong-typed values, enum-tuple
   violations, and non-slug or over-long strings have been stripped (dev-only warning per
   strip). This is the structural guard that keeps a future emit site from accidentally
   shipping PII into the table.
5. **Persist** — `analyticsEvent.create({ data: { name, props, userId } })`. If the
   serialized `props` exceeds `ANALYTICS_PROPS_MAX_BYTES`, store `{ _truncated: true }`
   instead (keep the event, drop the payload — a mis-sized payload should never cost the
   count).
6. **Fail-open, always** — the entire body after the debug line is wrapped in `try/catch`
   with a swallowed error (`console.error` in dev at most). `track()` **never throws and
   never fails a feature** — the same posture as `checkRateLimit`'s fail-open.

**Layering:** the two Prisma touches — the opt-out read (step 3) and the insert (step 5) —
live in a new `src/lib/db/analytics.ts` (`server-only`) as `persistEvent(userId, name,
props)`, keeping DB access in `src/lib/db/*` per house convention. Everything else stays in
`track.ts`: the kill switch and debug line (step 1), the `auth()` resolution (step 2), the
**registry validation (step 4) — pure, imported from `events.ts`, applied *before* calling
`persistEvent`** so the DB layer only ever sees already-sanitized props — and the
fail-open `try/catch` (step 6) wrapping the whole composition.

**Delivery semantics are best-effort by design.** Existing call sites use both
`await track(...)` (AI orchestrator, notifications) and `void track(...)` (favorites,
recurring). Fire-and-forget promises can be cut off at the end of a serverless invocation —
an accepted, rare loss for telemetry. Do **not** rewrite call sites to force awaits; the
no-call-site-changes contract wins.

---

## 4a. Typed event registry (`src/lib/analytics/events.ts`)

The catalog of every event Spendly emits, in one place — the single source of truth for
names, allowed prop keys, and their meanings:

```ts
// Per-key spec: a literal tuple for closed domains (the default), or a primitive
// tag where the domain is genuinely open. "string" is the exception, not the rule:
// values must be slug-shaped (no whitespace) and length-capped — props are enums
// and short codes, never prose.
export const ANALYTICS_EVENTS = {
  ai_result: {
    feature: ["category_suggest", "transaction_parse", "monthly_review", "budget_suggest"],
    prompt_version: "number",
    outcome: ["ok", "error", "no_match", "rate_limited"],
    reason: ["parse_error", "no_match", "rate_limited", "timeout", "provider_error"],
    latency_ms: "number",
    model: "string", // open by design — tracks the AI_MODEL env knob
  },
  // ... all 18 existing events, keys + specs transcribed from their live call sites ...
  transaction_created: { type: ["INCOME", "EXPENSE"], isSplit: "boolean", tagCount: "number" },
  import_committed: {
    format: ["csv", "json"],
    createdBucket: COUNT_BUCKETS, // the bucketCount output tuple — a closed domain too
    skippedBucket: COUNT_BUCKETS,
  },
  // ...
} as const;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;

// Drop-vs-sanitize is a discriminated union — the sink can never confuse
// "drop the event" with "event with empty props".
export type SanitizeResult =
  | { ok: true; props: Record<string, string | number | boolean> }
  | { ok: false; reason: "unregistered_event" };
export function sanitizeProps(event: string, props?: ...): SanitizeResult;
```

The exact literal tuples above are illustrative — the authoritative values are transcribed
from the live call sites during implementation (e.g. `ai_result.reason`'s real domain comes
from `run.ts`'s `reasonForThrow` mapper).

**Rules:**

- **Runtime enforcement lives in the sink** (§4 step 4), via the pure
  `sanitizeProps(event, props): SanitizeResult` exported from this module. `{ ok: false }`
  means **drop the whole event** (unregistered name); `{ ok: true, props }` carries the
  sanitized payload, per key — unregistered key → stripped; value of the wrong primitive
  type → stripped; value not in a declared literal tuple → stripped; `"string"` value that
  is not slug-shaped (`/^[\w.:+-]+$/`, i.e. contains whitespace or prose punctuation) or is
  longer than `ANALYTICS_STRING_PROP_MAX` → stripped (each with a dev-only warning).
  **Key-only filtering isn't enough** — a registered free-string key could otherwise
  smuggle a merchant name or note; the enum-first policy plus the slug/length check on the
  remaining strings closes that hole for a few lines of code. Registering an event or key is
  still a one-line edit — no migration, no emit-site change — which **preserves the shim's
  "add keys without a migration" promise** while converting it from an honor-system contract
  into a checked one.
- **Enum tuples are the default; `"string"` needs a justifying comment.** If a prop's domain
  is closed (feature names, outcome codes, formats, bucket labels), declare the tuple — it
  documents the domain and validates for free. `"string"` is reserved for genuinely open
  slugs (e.g. `model`, which follows the `AI_MODEL` env knob) and each use carries an inline
  comment saying why.
- **Event names are string literals at call sites** — never variables or template strings.
  All 18 existing sites already comply; this becomes a stated rule because the structural
  registration test (§9) depends on it.
- **Type safety is opt-in, not retrofitted.** `track()` keeps its current open signature
  (the zero-call-site-changes contract) and gains an *overload* narrowed to
  `AnalyticsEventName` + that event's keys. New emit sites get compile-time checking for
  free; migrating the 18 existing sites to the narrow overload is optional cleanup, not part
  of this slice.
- **Transcribe, don't redesign.** The initial registry is a faithful copy of what the 18
  live call sites already send (verified against each `track(...)` call during
  implementation). Any mismatch found is fixed in the **registry**, not the call site.
- The registry file is pure — no I/O, no `server-only`, no side effects. Its only value
  import is `ANALYTICS_STRING_PROP_MAX` from `src/lib/system-constants.ts`, which is itself
  a pure, side-effect-free constants module (the house home for system-level values — the
  constant does **not** move into `events.ts`, and importing it costs nothing in purity or
  testability). This keeps the registry trivially unit-testable and importable from both the
  sink and future tooling (e.g. the §8 canned queries can enumerate event names from it).

---

## 5. Consent model (GDPR — resolves Open question #1b)

- **Lawful basis: legitimate interest**, with a clearly-worded **opt-out**. The processing is
  first-party, server-side only, cookie-free, and stores no content — event names plus
  counts/enums keyed to the account id. It is pseudonymous but *is* personal data (keyed to
  `userId`), hence the toggle rather than silence.
- **The toggle** lives in the `/settings` **Preferences** card (below the display-name form):
  a checkbox row labeled **"Usage analytics"** with copy:
  *"Help improve Spendly by sharing which features you use. This is linked to your account
  but never includes amounts, balances, names, notes, or merchants, and is deleted with your
  account."* Default **on** (`analyticsOptOut = false`); unchecking sets the flag and takes
  effect on the next event (no queue to flush). The word **"anonymous" is deliberately
  avoided** — events are keyed to the account id, which is *pseudonymous*, not anonymous;
  the copy must not overclaim.
- **Action:** `updateAnalyticsPreference` added to `src/actions/profile.ts` — auth-guarded,
  Zod-validated (`z.boolean()`), `update({ where: { id: userId } })`, returns the standard
  `{ success, error? }`, `revalidatePath("/settings")`. `getUserOverview`
  (`src/lib/db/profile.ts`) projection gains `analyticsOptOut` for the card's initial state.
- **Deletion:** covered structurally — the account-deletion hard purge cascades events (§3).
- **Disclosure:** add one item to the `/help` **Data & privacy** section (per the Help
  maintenance contract) describing what is and isn't collected and where the toggle lives.
- **Seam:** if counsel/product later requires opt-**in** for the EU market, the flip is the
  column default + the toggle's initial state — no event-path change.

### 5.1 Legitimate Interest Assessment (lightweight, documented here)

The three-part LIA test, recorded so the lawful-basis claim is a written artifact rather
than an assertion:

1. **Purpose test** — the interest is legitimate and concrete: deciding whether to keep,
   iterate, or retire shipped features (the Pro Value Review rubric), sizing the parked-tier
   bets (§9 persistence, §10 v2, §11, §14), and validating AI COGS against the budget
   ceiling. These are product decisions the roadmap explicitly refuses to make on intuition.
2. **Necessity test** — the same insight cannot be had with less data: aggregate-only
   counters (no `userId`) would break the adopter-vs-non-adopter cohort comparison the
   checkpoint requires, and third-party analytics would process *more* data with an external
   controller. Collection is minimized structurally: no content, no amounts, no free text,
   no IP/user-agent, no client fingerprint; volume counts bucketed (§7); props allowlisted
   per event (§4a); retention capped (§6).
3. **Balancing test** — impact on the user is minimal: server-side only (no tracking
   surface leaves the app), pseudonymous, opt-out honored at the write path, disclosed in
   `/help` and at the toggle, and erased with account deletion via cascade. A reasonable
   user of a finance app expects the developer to know *which screens are used* while firmly
   not expecting it to mine *what the money was spent on* — the design draws exactly that
   line.

**Outcome: legitimate interest holds for v1.** Revisit if any future event wants content,
client-side collection, or third-party processing — each of those breaks an assumption
above and re-opens the consent-model question.

---

## 6. Constants & env

| Where | Name | Value | Why |
|---|---|---|---|
| `src/lib/system-constants.ts` | `ANALYTICS_ENABLED` | `process.env.ANALYTICS_ENABLED !== "false"` | Env kill switch, read-as-not-false (matches `EMAIL_VERIFICATION_ENABLED`); prod needs no config. |
| `src/lib/system-constants.ts` | `ANALYTICS_PROPS_MAX_BYTES` | `2048` | Payload cap before props are replaced with `{ _truncated: true }`. |
| `src/lib/system-constants.ts` | `ANALYTICS_RETENTION_DAYS` | `180` | Declared retention ceiling (§6.1). |
| `src/lib/system-constants.ts` | `ANALYTICS_STRING_PROP_MAX` | `64` | Per-value cap on string props (enums/short codes, never prose — §4a). |
| `.env.example` | `ANALYTICS_ENABLED=` | documented, optional | Plus a comment noting `ANALYTICS_DEBUG=true` for local console echo. |

`ANALYTICS_DEBUG` stays a raw env read inside `track.ts` (dev-only knob, not a constant
consumers import), and is inert in production builds (§4 step 1).

### 6.1 Retention & prune (policy now, automation later)

- **Policy:** events older than `ANALYTICS_RETENTION_DAYS = 180` are out of contract and
  eligible for deletion. 180 days comfortably covers the longest analysis window in play
  (the checkpoint's ~30–90-day comparisons) while keeping the LIA's data-minimization claim
  honest — telemetry is decision fuel, not an archive.
- **Mechanism (v1): manual, dry-run by default.** `scripts/prune-analytics.ts` — a
  dev/operator script in the mold of `scripts/reactivate-account.ts`:
  - **No flags → dry run.** Prints the target DB host (parsed from `DATABASE_URL`), the
    cutoff date, and the `count()` of rows that *would* be deleted. Mutates nothing.
  - **`--apply`** — required to actually run the
    `deleteMany({ where: { createdAt: { lt: cutoff } } })`; prints the deleted count.
  - **`--production`** — additionally required when the connection string's host matches the
    production endpoint; without it the script refuses and exits non-zero even with
    `--apply`. This encodes the CLAUDE.md production-safety rule into the tool itself
    rather than relying on operator memory.
  Run the dry-run as part of checkpoint prep, apply periodically thereafter.
- **Seam:** if volume ever warrants automation, the script body becomes the job body — the
  policy constant and the delete shape don't change. The app's cron-free stance holds until
  then.

---

## 7. Starter event set (the roadmap's seed list)

Existing emissions (already live, now persisted — **no changes**): `ai_result`,
`ai_category_accepted` / `ai_category_overridden`, `ai_parse_confirmed`,
`ai_budget_suggest_accepted` / `ai_budget_suggest_dismissed`, `ai_numeric_guard`,
`ai_phrasing_degraded`, `notifications_derived`, `notification_panel_opened`,
`notification_item_clicked`, `recurring_suggested`, `recurring_suggestion_accepted` /
`recurring_suggestion_dismissed`, `favorite_created` / `favorite_deleted` / `favorite_used`.

New emissions — each a one-line `void track(...)` at the existing **success** point of the
named action (after the write commits, before return; failures emit nothing):

| Event | Emit from | Props (counts/enums only) |
|---|---|---|
| `transaction_created` | `createTransaction` (`src/actions/transactions.ts`) | `{ type, isSplit, tagCount }` |
| `transfer_created` | `createTransfer` | — |
| `draft_confirmed` | `confirmDraft` (`src/actions/recurring.ts`) | `{ cadence }` |
| `budget_created` | `createBudget` (`src/actions/budgets.ts`) | `{ rollover }` |
| `goal_created` | `createGoal` (`src/actions/goals.ts`) | — |
| `export_run` | both export routes (`/api/export/{csv,json}`), post-success | `{ format, scoped }` (`scoped` = account filter active) |
| `import_committed` | `commitImport` (`src/actions/import.ts`) | `{ format, createdBucket, skippedBucket }` — bucketed, see below |
| `upgrade_to_pro_clicked` | `createCheckoutSession` (`src/actions/billing.ts`), before redirect | `{ period }` |

**Rules:** names stay `snake_case` (matching every existing event); props carry **no amounts,
no user-entered strings** (types, cadences, booleans, and small bounded counts only). The
export routes may call `track` even though they're API routes — the ESLint
no-Prisma-in-routes boundary restricts *direct* imports, and routes already legitimately
import `src/lib/db/*` modules.

**Volume counts are bucketed, not raw.** A raw `created: 4217` on `import_committed` leaks
ledger-size metadata (how much financial history the user has) into a table meant to hold
none. A pure `bucketCount(n)` helper in `src/lib/analytics/events.ts` maps counts to ordinal
buckets — `"0"`, `"1-10"`, `"11-100"`, `"101-1000"`, `"1000+"` — which is all the analysis
needs (did imports succeed, roughly at what scale). Applies to `import_committed`'s
`createdBucket`/`skippedBucket`; existing small **capped** counts (`tagCount` ≤ 12,
`favoriteCount` ≤ 12, notification counts) stay raw — they're bounded UI facts, not
ledger-size proxies.

Deliberately **not** emitted in v1: per-page opens (needs the client channel, §2 out-of-scope),
per-row edits/deletes (noise), anything inside loops (imports emit one summary event, never N).

---

## 8. Analysis path (operator, not product)

No UI. The checkpoint queries run read-only against the Neon `development`/`production`
branch, e.g.:

```sql
-- AI acceptance per feature, last 30 days
SELECT props->>'feature' AS feature, props->>'outcome' AS outcome, COUNT(*)
FROM "AnalyticsEvent"
WHERE name = 'ai_result' AND "createdAt" > now() - interval '30 days'
GROUP BY 1, 2;
```

Document two or three such canned queries in this spec's repo copy when shipping (acceptance
rate, panel engagement, adopter cohort) so the checkpoint doesn't start from a blank page.

**Production access rule: read-only, always.** Analysis against the `production` branch runs
**only** through read-only access — the read-only Neon MCP configuration or a dedicated
read-only SQL role — and only under the existing CLAUDE.md production-confirm rule (explicit
per-message approval; the `development` branch stays the default). Nothing in the analysis
workflow ever needs a write: pruning (§6.1) is the sole mutating operation on this table
outside `track()`, and it runs as a deliberate operator script, not ad-hoc SQL.

---

## 9. Testing (Vitest — `test/lib/analytics/track.test.ts` + extensions)

Mock `@/lib/prisma` and `@/auth` at the module boundary (house standard; no live DB).

- **Persists**: session present, opt-out false → `analyticsEvent.create` called with
  `{ name, props, userId }`.
- **Drops on no session**: `auth()` → null → no read, no write.
- **Drops on opt-out**: `analyticsOptOut: true` → no write.
- **Kill switch**: `ANALYTICS_ENABLED=false` (hoisted `vi.mock` toggle, like the
  email-verification flag tests) → no auth read, no write.
- **Fail-open**: `create` throws → `track()` resolves without throwing.
- **Truncation**: oversized props → stored as `{ _truncated: true }`.
- **Registry enforcement** (`test/lib/analytics/events.test.ts` + sink cases): unregistered
  event name → no write; stray prop key → stripped, allowed keys persisted; wrong-typed
  value → stripped; enum-tuple violation → stripped; over-long string → stripped.
- **Structural registration test** — not an eyeball checklist: the test walks **production
  source only** — `src/**/*.{ts,tsx}`, which by construction excludes `test/` (mocks and
  fixtures live in the top-level `test/` mirror, never inside `src/`) and `scripts/` —
  regex-extracts every `track("<literal>"` first argument, and asserts each extracted name
  is a key of `ANALYTICS_EVENTS`. Skip `src/generated/**` (Prisma client output) explicitly.
  This makes "all emitted events are registered" a suite invariant that fails the moment
  someone adds an unregistered emit — and it's why §4a mandates literal event names at call
  sites (a non-literal first argument should also fail the test via a second regex asserting
  no `track(` call in the scanned set has a non-string-literal first arg).
- **`bucketCount`**: boundary cases (0, 1, 10, 11, 100, 101, 1000, 1001).
- **Debug guard**: `ANALYTICS_DEBUG=true` + `NODE_ENV=production` → no console output.
- **`updateAnalyticsPreference`** (in `test/actions/profile.test.ts`): auth guard, Zod
  boolean, correct `update` where-shape, revalidate `/settings`.
- **Starter emissions**: extend the existing action suites (`transactions`, `budgets`,
  `recurring`, `import`, `billing`) with one assertion each that the success path fires the
  named event — the mocks for `track` already exist in several suites.

Existing suites must pass untouched — in particular every AI-action test that asserts
`track` was called still holds, because the signature and call sites are unchanged.

---

## 10. Decisions (resolving the roadmap's open questions)

- **D1 — First-party events table, not PostHog/Plausible.** Spendly is EUR/GDPR-market: a
  first-party, server-side, cookie-free sink needs no vendor DPA, no consent banner, and no
  client SDK. Neon is already there; MVP volume is trivial; analysis is plain SQL. Plausible
  is page-view-shaped (wrong shape for acceptance-rate events); PostHog is heavier than the
  need. **Seam:** `track()` is the single funnel — a provider swap later is another body swap.
- **D2 — Opt-out under legitimate interest, not opt-in.** Server-only, pseudonymous,
  content-free counters with a clear Settings toggle and help disclosure. Flip-to-opt-in is a
  default change if ever required (§5 seam).
- **D3 — Required `userId`, drop session-less events.** Matches every call site, gives
  cascade-on-delete for free, avoids an anonymous-row tier nobody queries.
- **D4 — Opt-out checked per event (one PK read).** Fresh-from-DB matches the repo's
  `isPro` posture; caching or JWT-threading the flag invites staleness bugs for negligible
  savings at telemetry volume.
- **D5 — Actions, not page views, in v1.** Server-only keeps the privacy story airtight and
  ships the checkpoint's blocking data now; view/session analytics is a separate slice with
  its own consent analysis (feeds §14's promotion bar later).
- **D6 — No user-facing surface, no retention cron.** SQL is the analysis path (read-only
  against production, §8); the app stays cron-free. The retention *policy* ships
  (180 days + manual prune script, §6.1); only its automation is the seam.
- **D7 — Typed registry with runtime enforcement.** The no-PII contract graduates from a doc
  comment to a checked spec (§4a) — key allowlist *plus* per-key type/enum/length validation,
  since a registered string key alone could still smuggle prose — without breaking the
  zero-call-site-changes promise: enforcement lives in the sink, type-narrowing is an opt-in
  overload.
- **D8 — Bucket ledger-size counts.** Raw import volumes are metadata about how much
  financial history a user has; ordinal buckets carry the analytical signal without it.

### Rejected (considered, decided against — with the seam named)

- **`after()` / queue to harden `void track` delivery** — telemetry is best-effort; the
  no-call-site-changes contract outweighs rare fire-and-forget loss. Seam: wrap emission in
  `next/server` `after()` inside `track.ts` later without touching callers.
- **Batching inserts** — one row per event is fine at MVP volume; batching adds a buffer with
  its own loss modes. Seam: `persistEvent` is the single choke point.

---

## 11. Deferred (known follow-ups, not oversights)

- **Client-side page/session events** (unblocks §14's ≥30%-mobile-sessions bar).
- **Analytics events in the JSON data export** (data-portability completeness).
- **Automated retention purge** (the §6.1 policy + script ship now; scheduling is deferred
  with the rest of the app's cron-free stance).
- **Migrating the 18 existing emit sites to the typed `track` overload** (optional cleanup;
  runtime enforcement already covers them).
- **Per-feature "AI usage" read-out in `/settings`** (roadmap Open question #6 — an AI
  section showing usage against caps; needs this table first).

---

## 12. Implementation order

1. Migration: `AnalyticsEvent` + `User.analyticsOptOut` (`prisma migrate dev`, development
   branch).
2. Registry: `src/lib/analytics/events.ts` (`ANALYTICS_EVENTS` — keys *and* value specs
   transcribed from the 18 live call sites + the §7 additions — `sanitizeProps`,
   `bucketCount`, types).
3. `src/lib/db/analytics.ts` (`persistEvent`) + `track()` body swap (kill switch, prod-safe
   debug, opt-out, registry enforcement, truncation, fail-open) + constants + `.env.example`.
4. `updateAnalyticsPreference` action + `getUserOverview` projection + Preferences toggle UI.
5. Starter emissions (§7) — one line per action, import counts through `bucketCount`.
6. `scripts/prune-analytics.ts` (§6.1).
7. `/help` Data & privacy item; docs (§13).
8. Vitest (§9) → `npm run test:run` + `npm run build` → manual check: toggle flips the flag,
   `ANALYTICS_DEBUG=true` echoes locally, a created transaction lands one row with only
   registered prop keys.

## 13. Docs to update when shipping

- `POST-MVP-ROADMAP.md` — §0 shipped banner; Open question #1 marked resolved; note the Pro
  Value Review checkpoint is now unblocked pending a measurement window.
- `project-overview.md` — no architectural change beyond the schema mirror (add
  `AnalyticsEvent` + the `analyticsOptOut` column to the Prisma block).
- `docs/current-feature.md` — history entry per workflow.
- `/help` Data & privacy — the disclosure item (§5).
