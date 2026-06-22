# Stripe Billing — Implementation Spec

> **Goal:** Ship ROADMAP **§8** (Delivery Sequence slot **#7**) — the real Stripe-backed Pro
> subscription flow. End state: a Free user can subscribe to **Pro monthly (€3)** or **Pro yearly
> (€25)** from `/settings`, a Pro user can manage/cancel from the same place, and a Stripe webhook
> reconciles `User.isPro` / `stripeCustomerId` / `stripeSubscriptionId` so the plan flips **without a
> re-sign-in**. The Settings **Billing** card already ships the plan read-out and a labelled seam
> (`{/* §8 (Stripe) wires … here. */}` in [src/app/settings/page.tsx](../../src/app/settings/page.tsx));
> this slice fills that seam and adds the two billing surfaces (webhook + checkout/portal actions).

This spec adapts the two **copied-from-DevStash** drafts
([stripe-phase-1-spec.md](./stripe-phase-1-spec.md), [stripe-phase-2-spec.md](./stripe-phase-2-spec.md))
to Spendly's actual architecture. **Those drafts assume entities Spendly does not have** (items,
collections, file/image uploads, AI, R2) and a session shape Spendly does not use. Read them for
Stripe mechanics only; **where they conflict with §1 below, this spec wins.** §11 enumerates every
deliberate divergence so nothing is silently dropped.

It follows [entity-crud-architecture.md](../entity-crud-architecture.md) and mirrors the shipped
**data-export** slice's *pure → DB model → thin route glue* split (so the webhook handler stays
testable-by-proxy). This is an **M** slice: one SDK dependency, one singleton, one DB-writer module,
one actions file, one webhook route, one client component, and env cleanup.

**How to read this spec (layering).** Ordered **contract → model → implementation → process**:

| Layer | Section | What it is |
|---|---|---|
| **Contract** | §1 | Every binding rule, stated once. The single source of truth. |
| **Prereqs** | §2 | Stripe Dashboard + env setup (manual, once per environment). |
| **Model** | §3 (SDK singleton), §4 (DB writers) | The Stripe client and the only functions that touch `User` billing columns. |
| **Implementation** | §5 (webhook), §6 (actions), §7 (Settings UI), §8 (env), §9 (enforcement) | Surface specifics that reference §1, never restate it. |
| **Process** | §10 (tests), §11 (divergences from the copied specs), §12 (decisions), §13 (acceptance), §14 (files), §15 (order) | Test plan, divergence ledger, resolved questions, done criteria, change surface, build order. |
| **Forward** | §16 (post-MVP notes) | Deliberately out-of-scope items recorded so the design stays extensible. |

If a later section appears to contradict §1, **§1 wins** — the prose elsewhere is rationale.

---

## 1. The contract (single source of truth)

Each rule is tagged **MUST/SHOULD/MAY** (RFC-2119) and **`[inv]`** (hard invariant — correctness/
security; a change is a bug) or **`[prod]`** (a product reading that may evolve).

### 1.1 Security & access — MUST (all `[inv]`)

- **S1** The webhook route **MUST** verify the `stripe-signature` header against
  `STRIPE_WEBHOOK_SECRET` via `stripe.webhooks.constructEvent(rawBody, sig, secret)` on **every**
  request, before any branching or DB write. Missing header or failed verification → **400**, no DB
  change. The raw body **MUST** be read with `await request.text()` (not `.json()` — JSON parsing
  re-serializes and breaks the signature).
- **S2** The webhook is the **only** surface that may set `User.isPro = true`. No action, page, or
  client path may grant Pro. Granting flows strictly from a Stripe-verified event.
- **S3** Both billing actions (`createCheckoutSession`, `createPortalSession`) are `auth()`-guarded
  and resolve the target user from the **session only** (`session.user.id`), never from client input.
  They return `{ error }` (no throw) when unauthenticated.
- **S4** Every billing value rendered in the UI (plan badge, "subscription active", the Free/Pro
  branch of the Billing card) is read from the **database** (`User.isPro` / `stripe*`), never from the
  session JWT — the session carries only `user.id`. This is the existing Reports/`getUserOverview`
  precedent ([getReportProfile](../../src/lib/db/reports.ts), [getUserOverview](../../src/lib/db/profile.ts)).
- **S5** The webhook route **MUST NOT** be rate-limited and **MUST NOT** appear in `RATE_LIMITS`:
  Stripe's signature already authenticates the caller and Stripe retries on non-2xx. (Contrast: the
  checkout/portal *actions* are user-initiated but need no new limiter either — see §12.4.)
- **S6** `checkout.session.completed` resolves the user from `client_reference_id` (preferred) then
  `metadata.userId`; subscription events resolve the user by `stripeCustomerId`. All DB writes
  (§4) are **`userId`- or `stripeCustomerId`-scoped** — never a blanket update.

### 1.2 Reconciliation correctness — MUST (all `[inv]`)

- **R1** Subscription-status writes **MUST** use `prisma.user.updateMany({ where: { stripeCustomerId }, … })`,
  **not** `update`. A retry that arrives before the customer is linked matches **zero** rows — that is
  a non-error, not a Prisma `P2025` throw.
- **R2** The handler **MUST** treat **`active` and `trialing`** as Pro; every other subscription
  status (`canceled`, `past_due`, `unpaid`, `incomplete`, `incomplete_expired`, `paused`) → `isPro = false`.
- **R3** **Idempotency:** handling the same `event.id` twice **MUST** be safe. Our writes are
  last-write-wins on idempotent columns (`isPro`, `stripeSubscriptionId`), so re-delivery is
  inherently safe; do **not** add a dedup table for MVP (documented decision §12.5).
- **R4** On any handler exception **after** signature verification, return **500** so Stripe retries.
  On an **unhandled `event.type`**, return **200** so Stripe stops retrying it.
- **R5** `customer.subscription.deleted` clears Pro: `isPro = false`, `stripeSubscriptionId = null`.
  `stripeCustomerId` is **kept** (audit/refund history; reused if the same user resubscribes).
- **R6** `[inv]` **Event handling is order-independent.** The grant of Pro is anchored to
  `checkout.session.completed` (keyed by `userId` from `client_reference_id`, R1's `update`); the
  `subscription.*` events are **reconciliation** keyed by `stripeCustomerId`. Because the
  subscription writers use `updateMany` (R1), a `subscription.created`/`.updated` that **arrives
  before** the customer is linked matches zero rows and is a safe no-op — the subsequent
  `checkout.session.completed` still grants Pro, and any later `subscription.updated` re-asserts the
  status. No event ordering, de-duplication, or buffering is required for the end state to be correct
  (verified by the retry-ordering acceptance check, §13).

### 1.3 Product surface — MUST/SHOULD

- **P1** `[inv]` MUST **No UI without backing function** (product principle #6). The Billing card's
  buttons render **only** once their action exists: Free → "Upgrade — €3/mo" + "Upgrade — €25/yr";
  Pro → "Manage subscription". No disabled placeholder, no "coming soon".
- **P2** `[prod]` MUST The Billing card replaces the existing `{/* §8 … */}` comment seam in
  [settings/page.tsx](../../src/app/settings/page.tsx). The plan read-out (badge + `planSummary`
  line) and the three-card layout are **unchanged**; this slice only adds the action buttons (a new
  `"use client"` child) and a `?checkout=…` result banner.
- **P3** `[prod]` MUST Prices and the period→price-ID mapping are **single-sourced**. Display amounts
  come from the existing [src/lib/marketing/pricing.ts](../../src/lib/marketing/pricing.ts) `PRICING`
  (`monthly: 3`, `yearly: 25`); the Stripe `price_…` IDs come from env via §3's `STRIPE_PRICE_IDS`.
  **No price amount is hardcoded** in the Billing card or the action.
- **P4** `[prod]` SHOULD After Checkout, the user returns to `/settings?checkout=success` (or
  `…=cancelled`). The card surfaces a one-line success/cancelled banner from that param and the plan
  state is **already** correct on first render (see §5 / "Webhook → render sync").

### 1.4 Free vs Pro gate — MUST

- **G1** `[inv]` Spendly's **only** Pro-gated feature today is **Reports history** (Free ≤ 3 months,
  Pro ≤ 12), already enforced in [report-period.ts](../../src/lib/report-period.ts)
  (`isPeriodAllowed`/`resolveEffectivePeriod`) reading `isPro` from the DB via `getReportProfile`.
  This slice adds **no new gate** and **changes no gating logic** — it makes the *existing* gate
  meaningful by letting a real user become Pro.
- **G2** `[inv]` There is **no dev-wide `isPro = true` override** in the Spendly codebase to remove
  (the `project-overview.md` "all users Pro in dev" note describes an intent the code never
  implemented — the seed creates `demo-pro` and `demo-nonpro` and the gate reads the real column).
  §9 is therefore **verification, not deletion**. Do not introduce an override.

---

## 2. Prerequisites — Stripe Dashboard + env (manual, once per environment: Test + Live)

No schema migration: `User.isPro`, `User.stripeCustomerId`, `User.stripeSubscriptionId` already exist
(verify with `npm run` → `prisma migrate status`). Confirm the three columns are present before coding.

1. **Create Product** "Spendly Pro".
2. **Add two recurring Prices** in **EUR** (resolved — §12.1): **€3.00/month** and **€25.00/year**.
   Copy the two `price_…` IDs into `STRIPE_PRICE_ID_MONTHLY` / `STRIPE_PRICE_ID_YEARLY`. (The
   marketing page is updated to `€` in the same slice so display, billing, and the EUR finance data
   are one currency end-to-end — §7.)
3. **Activate Customer Portal** (Settings → Billing → Customer portal): enable cancel **at period
   end**, plan switching monthly ↔ yearly, payment-method update; set the default return URL to
   `https://<domain>/settings`.
4. **Webhook endpoint** (Developers → Webhooks → Add endpoint):
   - URL `https://<domain>/api/stripe/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`. (Optionally
     `invoice.payment_failed` — **log only** in MVP, no user-facing dunning.)
   - Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
5. **Tax**: ship v1 with `automatic_tax: { enabled: false }`. Enabling Stripe Tax is post-MVP.

**Local dev:** `stripe listen --forward-to localhost:3000/api/stripe/webhook` prints a **separate**
`whsec_…` — put that in local `.env`, never the production secret.

---

## 3. SDK singleton — `src/lib/stripe.ts`

- `import "server-only"` at the top so this never bundles into a client component.
- Lazy singleton mirroring [src/lib/prisma.ts](../../src/lib/prisma.ts) / `rate-limit.ts`: construct on
  first use, **throw on missing env only when first called**, never at import time (so the build and
  unrelated routes don't blow up when Stripe env is absent).
- Add dependency **`"stripe": "^22.2.2"`** to `package.json` (latest as of 2026-06; pins API version
  `2026-05-27.dahlia`). Run `npm install`, commit the lockfile.
- Export `getStripe(): Stripe` caching one instance.
- **`apiVersion`:** pin explicitly to the SDK's default — `apiVersion: "2026-05-27.dahlia"` — and
  record in a comment that this string **must equal the installed `stripe` major's pinned version**
  (the type is a literal union; a mismatch is a compile error, which is the desired tripwire on a
  future SDK bump). See §12.2 and the **Basil breaking-change note** below.
- Export the price-ID map and period type so §6 is type-safe:
  ```ts
  export const STRIPE_PRICE_IDS = {
    monthly: () => requireEnv("STRIPE_PRICE_ID_MONTHLY"),
    yearly: () => requireEnv("STRIPE_PRICE_ID_YEARLY"),
  } as const;
  export type BillingPeriod = keyof typeof STRIPE_PRICE_IDS; // "monthly" | "yearly"
  ```
  Functions (not eager reads) so a missing price ID throws **only** when a checkout is actually
  attempted, never at import. Local `requireEnv(name)` throws a descriptive error.

> **⚠ Stripe API breaking-change note (Basil → Dahlia).** Since API version `2025-03-31.basil`,
> `Subscription.current_period_start` / `current_period_end` were **removed from the subscription
> object** and now live per-item at `subscription.items.data[i].current_period_end`. This persists in
> `2026-05-27.dahlia`. **Our handler never reads those fields** (we derive Pro purely from
> `subscription.status`, R2), so we are unaffected — but anyone later adding "renews on <date>" copy
> must read it from the **item**, not the subscription. Do not reintroduce `sub.current_period_end`.

`src/lib/stripe.ts` is **not** unit-tested (thin env-reading wrapper); §6's actions exercise it via a
mocked `getStripe()`.

---

## 4. DB writers — `src/lib/db/billing.ts`

The **only** module that mutates `User` billing columns, so the webhook route stays Prisma-free (matches
the data-export ESLint boundary; see §12.6). `import "server-only"`. Three idempotent writers:

| Function | Write | Used by |
|---|---|---|
| `linkCheckout({ userId, stripeCustomerId, stripeSubscriptionId })` | `update` the one user by `id`: set both stripe IDs + `isPro: true` | `checkout.session.completed` |
| `syncSubscription({ stripeCustomerId, isActive, stripeSubscriptionId })` | `updateMany` by `stripeCustomerId`: `isPro: isActive`, `stripeSubscriptionId` | `subscription.created` / `.updated` |
| `clearSubscription({ stripeCustomerId })` | `updateMany` by `stripeCustomerId`: `isPro: false`, `stripeSubscriptionId: null` | `subscription.deleted` |

- `linkCheckout` uses `update` (the `userId` is known and unique from `client_reference_id`); the two
  subscription writers use **`updateMany`** per **R1**.
- Optional thin read `getBillingUser(userId)` (`select { stripeCustomerId, email, isPro }`) for the
  checkout action's "already Pro?" / "reuse customer?" branch — or inline the `select` in the action.
- All three are pure-of-side-effects-beyond-Prisma and **unit-tested** against a mocked `@/lib/prisma`
  (§10).

---

## 5. Webhook handler — `src/app/api/stripe/webhook/route.ts`

Thin HTTP glue: verify → narrow event → call a §4 writer. No Prisma import here.

- `export const runtime = "nodejs"` (Stripe SDK needs Node) and `export const dynamic = "force-dynamic"`.
- `const body = await request.text();` (**S1** — raw text).
- `const sig = (await headers()).get("stripe-signature");` — `headers()` is async in Next 16. Missing
  → `400`.
- `stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)` in a `try/catch`;
  verification failure → `400` (**S1**).
- `switch (event.type)`:
  - **`checkout.session.completed`** — resolve `userId` from `session.client_reference_id ??
    session.metadata?.userId`; resolve `stripeCustomerId` / `stripeSubscriptionId` (each may arrive as
    a string **or** an expanded object — narrow with `typeof x === "string" ? x : x.id`). If `userId`
    and `customerId` present → `linkCheckout(...)`. If `userId` missing, **log + return 200** (a
    malformed/foreign session is not our error; do not 500-loop Stripe).
  - **`customer.subscription.created` | `customer.subscription.updated`** — `customerId` from
    `sub.customer` (string|object), `isActive = sub.status === "active" || sub.status === "trialing"`
    (**R2**) → `syncSubscription({ stripeCustomerId, isActive, stripeSubscriptionId: sub.id })`.
  - **`customer.subscription.deleted`** — `clearSubscription({ stripeCustomerId })` (**R5**).
  - **`default`** — `return 200` (**R4**).
- Wrap the switch body in `try/catch`: caught → log + `500` (**R4**, Stripe retries).
- Success → `NextResponse.json({ received: true })` (200).
- Extract the **pure** event→intent mapping into `src/lib/stripe/events.ts` (see §10) so it is
  unit-testable without importing the route (which would pull `next-auth`/`next/server` into Vitest and
  poison the worker — the documented reason the route itself isn't unit-tested).

**Webhook → render sync (the load-bearing UX guarantee).** After Checkout, the browser follows
Stripe's redirect to `/settings?checkout=success`. `/settings` is already `dynamic = "force-dynamic"`
and reads `isPro` fresh from the DB via `getUserOverview` (**S4**). In practice the webhook updates the
row tens of ms before the redirect lands, so the Billing card renders the **Pro** state on first paint
— **no client polling, no `useSession().update()`, no re-sign-in, and no JWT change** (this is why
Spendly does **not** thread `isPro` through the session — §11/D1).

**Race strategy — the `?checkout=success` return-side reconciliation (SHOULD).** The redirect can
occasionally beat the webhook (Stripe makes no ordering guarantee between the browser 303 and the
event POST). Rather than "one refresh fixes it," the slice ships a **bounded, self-healing**
fallback so the very first render is correct:
- The page resolves `?checkout=success` through a small server helper
  `reconcileCheckoutReturn(userId)` (in `src/lib/db/billing.ts` or `src/actions/billing.ts`,
  server-only). If the DB row is **already Pro**, it is a no-op (the webhook won). If **not yet Pro**,
  it does **one** authoritative pull — `getStripe().checkout.sessions.list({ customer_email } )` is
  fragile, so instead resolve via the session id when available; the robust form is to **retrieve the
  Checkout Session** Stripe appended (pass `success_url: …/settings?checkout=success&session_id={CHECKOUT_SESSION_ID}`
  so the return URL carries the id), then `checkout.sessions.retrieve(id, { expand: ["subscription"] })`
  and run the **same** `linkCheckout(...)` intent the webhook would have. This is **idempotent** with
  the webhook (R3) — whichever lands first wins, the second is a no-op.
- This is **belt-and-suspenders, not a replacement** for the webhook: the webhook remains the source
  of truth for *all* later lifecycle events (renewals, cancellations, plan switches) that have no
  browser round-trip. The return-side path only closes the **first-paint** gap.
- **Bounded cost (MUST).** `reconcileCheckoutReturn` makes **at most one** Stripe API call
  (`checkout.sessions.retrieve`) and performs **no retries** — a miss or error falls straight through
  to the stale-then-refresh behavior. This keeps `/settings` latency predictable (one bounded
  round-trip on the success return only; the already-Pro short-circuit makes it zero calls on every
  subsequent visit). Wrap the call with an explicit timeout (the SDK's `{ timeout }` request option,
  e.g. 5s) so a slow Stripe response can't hang the render. Because it runs **only** on
  `?checkout=success` (one-shot, immediately after a user-initiated checkout), its call volume is a
  rounding error against Stripe's account rate limits — it needs no limiter of its own, but the
  one-call/no-retry rule is what *keeps* it negligible (don't loop or poll here).
- Failure of the reconcile pull is swallowed (logged) and falls back to the "stale → one refresh"
  behavior — it must never turn a successful payment into an error page.

> **Decision (§12.7):** ship the return-side reconciliation. It is ~15 lines, removes the only
> user-visible race, and reuses the webhook's `linkCheckout` intent verbatim. If you prefer the
> minimal MVP, the param-only banner + force-dynamic re-read is acceptable and the reconciliation can
> be added later without schema or contract change — but the spec's default is **on**.

### 5.1 Observability & failure handling (MUST)

Billing correctness depends entirely on webhook processing, so failures must be visible:
- **Structured logging on every event.** Log `{ eventId: event.id, type: event.type, outcome }` where
  `outcome ∈ { handled, ignored, no_match, error }`. `no_match` (an `updateMany` that touched zero
  rows, R1/R6) is logged at **warn** — expected during the link race, but a *sustained* stream of it
  signals a real linking bug.
- **Log the Checkout Session id on the reconciliation path.** Both the webhook's
  `checkout.session.completed` branch and the return-side `reconcileCheckoutReturn` log the resolved
  `{ checkoutSessionId, userId, outcome }`. A rare checkout↔webhook mismatch is then a one-grep
  correlation (the same `cs_…` id appears on both the webhook log line and the Settings-return log
  line), instead of inferring it from timestamps.
- **Stripe-side alerting.** Configure the Stripe Dashboard's **webhook endpoint failure alert** (email
  on repeated non-2xx) for both Test and Live endpoints — this is the primary alarm and needs no app
  code. Our 500-on-exception (R4) drives Stripe's automatic retry **and** that alert.
- **No silent 200 on real failure.** A handled event whose DB write throws returns **500** (R4) so it
  both retries and trips the alert; only *unhandled event types* and *expected zero-match* return 200.
- **Reconciliation escape hatch.** Stripe's Dashboard → Webhooks → "Resend" replays any failed event
  after a fix; because handlers are idempotent (R3) replay is always safe. Document this as the manual
  recovery path; an automated backfill job is post-MVP (§16).
- **Out of scope (MVP):** a processed-events audit table, metrics/APM dashboards, and PagerDuty-style
  paging. The Stripe failure alert + structured logs are the MVP bar; richer monitoring is §16.

---

## 6. Billing actions — `src/actions/billing.ts`

`"use server"`. Base URL via a shared `getBaseUrl()` (see §12.3) — `AUTH_URL ?? "http://localhost:3000"`,
matching the existing email helpers.

**`createCheckoutSession(period: BillingPeriod)`**
- `auth()` gate (**S3**); reject if no session / no email.
- Validate `period` ∈ `{ "monthly", "yearly" }` (defense-in-depth past the type).
- Load the user (`select { stripeCustomerId, email, isPro }`); reject if **already Pro**.
- `getStripe().checkout.sessions.create({ mode: "subscription", customer: stripeCustomerId ??
  undefined, customer_email: stripeCustomerId ? undefined : email, client_reference_id:
  session.user.id, line_items: [{ price: STRIPE_PRICE_IDS[period](), quantity: 1 }],
  allow_promotion_codes: true, billing_address_collection: "auto", automatic_tax: { enabled: false },
  success_url: \`${base}/settings?checkout=success&session_id={CHECKOUT_SESSION_ID}\`,
  cancel_url: \`${base}/settings?checkout=cancelled\`,
  subscription_data: { metadata: { userId: session.user.id } } })`. The literal
  `{CHECKOUT_SESSION_ID}` placeholder is substituted by Stripe and read back by the §5 return-side
  reconciliation (`checkout.sessions.retrieve`).
- **Do not** pre-create a Customer ourselves — let Checkout create it; the webhook picks up
  `stripeCustomerId`.
- On success `redirect(checkout.url!)` (Next 16 server-action redirect). On validation/Stripe failure
  return `{ error }` (the form's `useTransition` toasts it).

**`createPortalSession()`**
- `auth()` gate; load `stripeCustomerId`; reject if missing.
- `getStripe().billingPortal.sessions.create({ customer, return_url: \`${base}/settings\` })`;
  `redirect(portal.url)`.

Return type: discriminated `{ error: string } | never` (success path `redirect()`s, which throws).

---

## 7. Settings Billing UI

- **`src/app/settings/page.tsx`** — inside the existing Billing `<section>`, replace the
  `{/* §8 … */}` comment with `<BillingActions isPro={user.isPro} hasCustomer={!!user.stripeCustomerId}
  checkoutResult={…} />`. Read `?checkout=` from the page's `searchParams` (already a `Promise` it
  awaits) and pass `"success" | "cancelled" | undefined`. **No other change to the card** (badge +
  `planSummary` stay — P2). Keep the page a server component.
- **`src/components/settings/billing-actions.tsx`** (`"use client"`):
  - **Free** (`!isPro`): two buttons — "Upgrade — €3/mo" and "Upgrade — €25/yr" — each a
    `<form action={() => startTransition(async () => { const r = await
    createCheckoutSession("monthly"|"yearly"); if (r?.error) toast.error(r.error); })}>`. Amounts +
    currency come from `PRICING` (P3) — render `{PRICING.currency}{PRICING.monthly}` etc., never a
    hardcoded `€3`.
  - **Pro** (`isPro`): one "Manage subscription" button → `createPortalSession()`.
  - Pattern mirrors the shipped `useTransition` + Sonner `toast.error()` forms (e.g.
    [settings-name-form.tsx](../../src/components/settings/settings-name-form.tsx)). Because both
    actions `redirect()` on success, **no client `router.push`** — the browser follows the 303.
  - Surface `checkoutResult`: `success` → a green "Welcome to Pro 🎉" line / `toast.success`;
    `cancelled` → a muted "Checkout cancelled." line. (A `toast` from an effect is fine; keep it
    lint-safe with the established `at`-nonce/`useState` pattern if you render an inline banner.)
- **Marketing currency flip (in scope — currency resolution §12.1).** Change
  [src/lib/marketing/pricing.ts](../../src/lib/marketing/pricing.ts) `PRICING.currency` from `"$"` to
  `"€"` so the landing page, Stripe prices, and the EUR finance data all read one currency. Amounts
  (`monthly: 3`, `yearly: 25`) are unchanged; `yearlyDiscountPercent` is derived and unaffected. Update
  the `test/lib/marketing/pricing.test.ts` expectation if it asserts the `$` glyph.
- **Marketing pricing CTA wiring** — **optional / out of this slice.** The landing
  [pricing.tsx](../../src/components/marketing/pricing.tsx) is public/logged-out; its Pro CTA →
  `/register` stays. Pointing an *authenticated* visitor at `/settings#billing` is a nice-to-have, not
  required for §8 (D7).

---

## 8. Environment cleanup — `.env.example`

The repo block has drifted from both the integration and `project-overview.md`. Reconcile to the names
the **code reads** (§3) and drop the unused key:

- **Keep / standardize on:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_MONTHLY`,
  `STRIPE_PRICE_ID_YEARLY`.
- **Remove `STRIPE_PUBLISHABLE_KEY`** — server-only integration; we ship no browser Stripe.js. (If
  Elements is ever embedded, it returns as `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.)
- **Doc reconciliation:** `project-overview.md` → Environment Variables currently lists
  `STRIPE_PRO_MONTHLY_PRICE_ID` / `STRIPE_PRO_YEARLY_PRICE_ID`. Update that table to the
  `STRIPE_PRICE_ID_MONTHLY/YEARLY` names so the doc matches the code (D6).

---

## 9. Free-vs-Pro enforcement — verify, don't build

Per **G1/G2**, the only gate (Reports 12-month) is already real and DB-backed. This slice:
- **Adds no new gate** and **touches no gating code.**
- **Adds the missing leak-stopper** only: cancel the Stripe subscription when a user deletes their
  account — see §6-adjacent change below.
- **Acceptance:** with a Test-mode Free user, `/reports?period=12m` clamps to 3 months + shows the
  upgrade banner; after subscribing, the same request renders 12 months (§13).

**Cancel-on-delete** — Spendly's account deletion is a **soft delete** ([deleteAccount in
src/actions/profile.ts](../../src/actions/profile.ts) → `softDeleteAccount` in
[src/lib/auth/account.ts](../../src/lib/auth/account.ts), 30-day grace). Before/within the soft-delete:
- Load `stripeSubscriptionId`; if present, `getStripe().subscriptions.cancel(subId)` inside a
  `try/catch` that **logs and swallows** (a Stripe outage must never block account deletion — worst
  case is one orphan subscription to reconcile).
- **Do not** delete the Stripe Customer (keep for audit/refund — R5).
- **Reactivation tension (decision D5):** the grace period + `scripts/reactivate-account.ts` mean a
  reactivated user would return *without* Pro (subscription already cancelled). Accepted for MVP:
  deleting your account is an explicit "stop billing now" signal; a reactivated user re-subscribes.
  Cancel at delete time rather than waiting for the 30-day purge so we never bill a departed user.

---

## 10. Testing

Per [coding-standards.md](../coding-standards.md): test `src/actions/**` and `src/lib/**`; never hit a
real DB or Stripe; mock at the module boundary.

**`test/lib/stripe/events.test.ts`** — the pure event→intent mapper (§5). No `next-auth`/Prisma import,
so it's safe in Vitest. Cover: `checkout.session.completed` with `client_reference_id` vs
`metadata.userId` fallback; customer/subscription id as **string vs expanded object**; status →
`isActive` matrix (`active`/`trialing` → true; `canceled`/`past_due`/`unpaid`/`incomplete`/`paused` →
false); `subscription.deleted` → clear intent; unknown type → no-op.

**`test/lib/db/billing.test.ts`** — mock `@/lib/prisma`. Assert `linkCheckout` calls `update` by `id`
with both ids + `isPro:true`; `syncSubscription` calls **`updateMany`** by `stripeCustomerId` with the
computed `isPro`; `clearSubscription` calls `updateMany` setting `isPro:false` + `stripeSubscriptionId:null`.
**Retry-ordering / zero-match (R1, R6):** `syncSubscription` against an unlinked customer — mock
`prisma.user.updateMany` resolving `{ count: 0 }` — **resolves without throwing** and performs no other
write (proves an out-of-order `subscription.created` arriving before the customer link is a safe no-op,
not a `P2025`). Pair with an `events.ts` case asserting that same event still maps to the correct
`syncSubscription` intent (the no-match is a DB outcome, not a mapping error).

**`test/actions/billing.test.ts`** — mock `@/auth`, `@/lib/prisma`, `getStripe`. Cover
`createCheckoutSession`: no session, no email, invalid period, already-Pro (rejected), no customer
(Checkout creates one — `customer` undefined, `customer_email` set), reused `stripeCustomerId`
(`customer` set, `customer_email` undefined), happy path **payload-shape assertions**
(`client_reference_id`, `line_items[0].price` from the mocked `STRIPE_PRICE_IDS`, `success_url`,
`cancel_url`, `subscription_data.metadata.userId`, `automatic_tax.enabled === false`). And
`createPortalSession`: no session, no `stripeCustomerId`, happy path (`return_url`).

**`test/actions/profile.test.ts`** (extend) — `deleteAccount` (or the `softDeleteAccount` wrapper) with
a `stripeSubscriptionId` calls `stripe.subscriptions.cancel`; without one skips cleanly; a thrown Stripe
error still completes the soft-delete.

**Not unit-tested:** `src/app/api/stripe/webhook/route.ts` (importing it pulls `next/server` +
`next-auth` resolution into the Vitest worker — same constraint that kept other route handlers out of
unit tests) and `src/lib/stripe.ts` (thin wrapper). The webhook is covered by the §13 Stripe-CLI
checklist; its logic lives in the unit-tested `events.ts` + `db/billing.ts`.

**Build + suite:** `npm run test:run` (429 baseline + ~20–30 new) and `npm run build` must pass.

---

## 11. Divergences from the copied DevStash specs (ledger — nothing silently dropped)

| ID | DevStash draft said | Spendly does | Why |
|---|---|---|---|
| **D1** | Thread `isPro` through JWT + `session.user.isPro`; add a `SELECT isPro` to the `jwt` callback on every validation. | **Skip entirely.** No `next-auth.d.ts` change, no `jwt`/`session` callback change. | Spendly already reads `isPro` fresh from the DB at every consumption point (`getReportProfile`, `getUserOverview` on `force-dynamic` `/settings`). The webhook→flip guarantee (§5) holds without a JWT field. Threading it in is the documented upgrade path **only** if a future *client* component needs `isPro` without a DB round-trip. |
| **D2** | `src/lib/billing.ts` with `FREE_TIER_LIMITS = { items, collections }`, `PRO_ONLY_ITEM_TYPES`, `checkItemCapacity`, `checkCollectionCapacity`, `getUserIsPro`. | **Drop the whole module.** | Spendly has no items/collections/uploads. The only gate is Reports history, already enforced in `report-period.ts`. A capacity module would be dead code (principle #6). |
| **D3** | Enforce gates in `createItemAction` / `createCollectionAction` / `/api/upload`; build `UpgradePromptDialog`. | **None of these exist** → omit. | No such actions/routes/paywalled creates in Spendly. |
| **D4** | Sidebar Pro-badge gating via `session.user.isPro`. | Omit. | Spendly's sidebar has no per-item Pro badge to gate. |
| **D5** | `deleteAccountAction` hard-deletes the user. | Hook cancel-on-delete into Spendly's **soft-delete** (`softDeleteAccount`); accept the reactivation tension (§9). | Spendly delete is a 30-day soft-delete, not a hard delete. |
| **D6** | Env `STRIPE_PRICE_ID_MONTHLY/YEARLY`; remove `STRIPE_PUBLISHABLE_KEY`. | Same, **plus** reconcile `project-overview.md`'s `STRIPE_PRO_*_PRICE_ID` names to match. | The doc and `.env.example` disagreed; code wins. |
| **D7** | Marketing CTA → `/settings#billing` for authed users (had a TODO). | **Optional/out.** Spendly's CTA already points at `/register`; no TODO to clear. | Landing page is logged-out; low value for this slice. |
| **D8** | Prices `$8/mo`, `$72/yr`; product "DevStash Pro". | **`€3/mo`, `€25/yr`** (from `PRICING`); product "Spendly Pro". Marketing `PRICING.currency` flips `$`→`€` in the same slice. | Spendly's actual pricing; currency resolved to EUR to match the product (§12.1). |
| **D9** | Stripe SDK `^17.5.0`. | **`^22.2.2`**, apiVersion `2026-05-27.dahlia`. | Current as of 2026-06; see §3 + the Basil note. |

---

## 12. Decisions & open questions

- **§12.1 — Pricing currency — RESOLVED: EUR `€3/€25`.** The marketing page previously rendered `$3` /
  `$25` while the finance data is EUR-only. Resolved to **EUR end-to-end**: configure the Stripe Prices
  in EUR (`€3.00/mo`, `€25.00/yr`, §2) **and** flip marketing `PRICING.currency` `"$"`→`"€"` (§7) so
  display, billing, and reporting share one currency and the ambiguity is gone. Amounts unchanged
  (`monthly: 3`, `yearly: 25`); `STRIPE_PRICE_IDS` and `PRICING` must agree.
- **§12.2 — Pin `apiVersion` explicitly.** Set `"2026-05-27.dahlia"` and let the literal type be the
  tripwire on SDK upgrades (vs omitting it, which silently rides the SDK default). Update the string +
  re-test the webhook whenever `stripe` is bumped.
- **§12.3 — Extract a shared `getBaseUrl()`.** Both email helpers
  ([send-verification-email.ts](../../src/lib/email/send-verification-email.ts),
  [send-password-reset-email.ts](../../src/lib/email/send-password-reset-email.ts)) define a private
  `baseUrl()`. Billing makes a **third** consumer → extract `getBaseUrl()` to `src/lib/url.ts` and have
  all three import it. Small, in-scope, kills the duplication before it spreads.
- **§12.4 — No new rate limiter.** Webhook is signature-authed (S5). Checkout/portal are
  `auth()`-guarded user actions with no abuse vector worth a limiter at MVP. `RATE_LIMITS` is untouched.
- **§12.5 — No idempotency/dedup table *(re-evaluate on first non-idempotent side effect)*.** Writes
  are last-write-wins on idempotent columns (R3), so Stripe re-delivery is safe **today**. This holds
  **only** while webhook handling has no side effect beyond those idempotent column writes. **The
  moment a non-idempotent effect is introduced** — a confirmation/dunning email, an analytics or
  referral event, a counter increment, an outbound integration — the "re-delivery is free" assumption
  breaks (Stripe *will* re-deliver, and the user gets two emails / double-counted analytics). That is
  the explicit trigger to add a processed-`event.id` table (true exactly-once) **before** shipping the
  effect, not after. Tracked as F3.
- **§12.6 — Keep the webhook Prisma-free.** Route → §4 writers only, mirroring the data-export ESLint
  `no-restricted-imports` boundary. (Adding the route path to that ESLint override is optional but
  consistent; at minimum, don't import `@/lib/prisma` in the route.)
- **§12.7 — Ship the `?checkout=success` return-side reconciliation (§5).** Default **on** — it closes
  the only user-visible webhook race at first paint, is idempotent with the webhook, and reuses
  `linkCheckout` verbatim. The param-only banner is the acceptable fallback if you want the minimal
  MVP; it can be upgraded later with no schema/contract change.

---

## 13. Acceptance criteria

Functional (Stripe CLI: `stripe listen --forward-to localhost:3000/api/stripe/webhook` + `npm run dev`):
- [ ] **Subscribe monthly** — Settings → "Upgrade — €3/mo" → Checkout (`4242 4242 4242 4242`) →
  `/settings?checkout=success&session_id=…` → card shows **Pro** + "Manage subscription". DB:
  `isPro=true`, `stripeCustomerId` + `stripeSubscriptionId` set.
- [ ] **Subscribe yearly** — same via the €25/yr button.
- [ ] **Manage** — "Manage subscription" → Portal → return to `/settings`.
- [ ] **Plan switch in Portal** (monthly→yearly) — `subscription.updated` fires; stays `isPro=true`.
- [ ] **Cancel at period end** — `subscription.updated` (`cancel_at_period_end=true`) → user **stays
  Pro**; then `stripe trigger customer.subscription.deleted` → `isPro=false`, `stripeSubscriptionId=null`,
  `stripeCustomerId` retained.
- [ ] **Forged signature** → 400, no DB change. **Unknown event** (`stripe trigger
  payment_intent.created`) → 200, no DB change.
- [ ] **Out-of-order retry (R1/R6)** — replay a `customer.subscription.created` for a customer **not
  yet linked** (e.g. Dashboard "Resend" before the `checkout.session.completed`, or `stripe trigger`
  the subscription event in isolation) → handler returns 2xx, `updateMany` matches zero rows, **no
  crash and no wrong grant**; the subsequent `checkout.session.completed` still flips `isPro=true`.
  End state Pro regardless of arrival order.
- [ ] **Return-side reconciliation (§5/§12.7)** — simulate the webhook lagging the redirect (e.g. stop
  `stripe listen` briefly, complete Checkout): the **first** `/settings?checkout=success&session_id=…`
  render already shows **Pro** (the page-side `checkout.sessions.retrieve` + `linkCheckout` ran); when
  the delayed webhook then arrives it is a no-op (idempotent, R3).
- [ ] **Reports gate** — Free user `?period=12m` clamps to 3m + banner; after subscribing, renders 12m.
- [ ] **Cancel-on-delete** — Pro user deletes account → subscription cancelled in Stripe within ~5s;
  soft-delete still completes even if the cancel call throws.
- [ ] **Render sync** — subscribe in window A; navigate window B to any fresh server render → Pro state
  shows with no re-sign-in.

Engineering:
- [ ] `npm run test:run` (429 baseline + new) and `npm run build` pass.
- [ ] No `@/lib/prisma` import in the webhook route; no `session.user.isPro` introduced; no new
  `RATE_LIMITS` entry; no dev `isPro` override added.
- [ ] `.env.example` cleaned (§8); `project-overview.md` env names reconciled.

**Test cards:** success `4242 4242 4242 4242`; 3DS `4000 0027 6000 3184`; declined
`4000 0000 0000 9995`. Any future expiry, any CVC.

---

## 14. Files changed

**New**
- `src/lib/stripe.ts` — SDK singleton, `STRIPE_PRICE_IDS`, `BillingPeriod`.
- `src/lib/stripe/events.ts` — pure event→intent mapper (unit-tested).
- `src/lib/db/billing.ts` — `linkCheckout` / `syncSubscription` / `clearSubscription` (+ optional `getBillingUser`) + `reconcileCheckoutReturn` (§5 return-side, §12.7).
- `src/lib/url.ts` — shared `getBaseUrl()` (§12.3).
- `src/actions/billing.ts` — `createCheckoutSession` / `createPortalSession`.
- `src/app/api/stripe/webhook/route.ts` — verified webhook glue.
- `src/components/settings/billing-actions.tsx` — Free/Pro action buttons + `?checkout=` banner.
- `test/lib/stripe/events.test.ts`, `test/lib/db/billing.test.ts`, `test/actions/billing.test.ts`.

**Modified**
- `package.json` / lockfile — add `stripe@^22.2.2`.
- `.env.example` — §8 cleanup.
- `src/app/settings/page.tsx` — replace the §8 seam with `<BillingActions/>`; read `?checkout=` +
  `?session_id=`; call `reconcileCheckoutReturn` on the success return (§5 / §12.7).
- `src/actions/profile.ts` **or** `src/lib/auth/account.ts` — cancel-on-delete (§9).
- `src/lib/email/send-verification-email.ts` + `send-password-reset-email.ts` — import shared `getBaseUrl()`.
- `src/lib/marketing/pricing.ts` — `PRICING.currency` `"$"`→`"€"` (§7 / §12.1).
- `test/actions/profile.test.ts` — extend for cancel-on-delete.
- `test/lib/marketing/pricing.test.ts` — update if it asserts the `$` glyph.
- `docs/project-overview.md` — env-var name reconciliation (§8 / D6).
- `docs/ROADMAP.md` / `docs/project-overview.md` — flip §8 / Routes-table Stripe note to ✅ on completion.

**No schema migration** — the three `User` Stripe columns already exist (§2).

---

## 15. Implementation order

1. **SDK + env** (§3, §8) — add `stripe`, create `src/lib/stripe.ts`, clean `.env.example`, extract `getBaseUrl()`.
2. **DB writers + pure mapper** (§4, §5-`events.ts`) — with their unit tests. Pure, no UI.
3. **Webhook route** (§5) — test with `stripe trigger checkout.session.completed` /
   `customer.subscription.deleted`; verify `isPro` flips in the DB.
4. **Billing actions** (§6) — end-to-end Checkout with `stripe listen` running; action tests.
5. **Settings UI** (§7) — real subscribe/manage from `/settings`; `?checkout=` banner.
6. **Cancel-on-delete** (§9) — close the billing leak; extend `profile` tests.
7. **Verify gate + acceptance** (§9, §13); reconcile docs; flip ROADMAP §8 to ✅.

Each step is mergeable behind the existing real gate — nothing breaks for current users because Pro is
already DB-driven; this slice simply gives users a way to *become* Pro.

---

## 16. Forward notes (post-MVP — documented, **not** built in this slice)

These are deliberately **out of scope** for §8 but recorded so the chosen design doesn't paint us into
a corner. Each is cheap to add later **without** reworking this slice.

- **F1 — Richer subscription metadata.** A future "renews on <date>" / "cancels at period end" /
  "Monthly vs Yearly plan" Billing UI needs `currentPeriodEnd`, `cancelAtPeriodEnd`, and `priceId`/
  `planInterval`. **We do not store them now** — Spendly's column discipline is "no field without a
  consumer" ([getUserOverview](../../src/lib/db/profile.ts) comment), and there is no UI for them yet
  (principle #6). When that UI lands, add the columns in one migration and populate them from the
  **same `subscription.*` webhook events already handled here** — note `currentPeriodEnd` reads from
  `subscription.items.data[i].current_period_end` (the Basil change, §3), **not** the subscription
  object. The webhook switch already receives these events, so it's an additive write, not a new
  integration. (Pre-creating the columns "just in case" is explicitly rejected: a nullable column with
  no writer is the dead-schema equivalent of dead UI.)
- **F2 — Multiple paid tiers / feature entitlements.** `User.isPro: boolean` is sufficient for the one
  Pro tier today. If a second tier or à-la-carte entitlements arrive, migrate from the boolean to a
  `plan` enum (or an `entitlements` set) and a `priceId`→entitlement map — the **gating call sites
  read through `getReportProfile` / `getUserOverview`**, so a future `getEntitlements(userId)` can
  replace the `isPro` read in one place per gate without touching the webhook or actions. Keep new
  gates funneling through a single resolver (as Reports already does) so this swap stays local.
- **F3 — Webhook delivery hardening.** A processed-events audit table (true exactly-once for any
  *non-idempotent* side effect like dunning emails), an automated failed-event backfill job, and
  APM/metrics dashboards. MVP relies on idempotent writes (R3) + the Stripe failure alert + structured
  logs (§5.1) + manual "Resend"; promote to a table only when a non-idempotent side effect is added.
- **F4 — `invoice.payment_failed` dunning.** Subscribed in §2 only as a *log-only* event in MVP. A
  user-facing "update your card" prompt + grace handling is the natural follow-up; it slots into the
  existing switch with a new case.
