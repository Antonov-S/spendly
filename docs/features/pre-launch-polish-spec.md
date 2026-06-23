# Pre-Launch Polish — Spec (ROADMAP §9)

> **Status:** ✅ Shipped — code + audit slice (`feature/pre-launch-polish`). The §1 security and §4 empty-state audits found no code gaps; code changes were confined to §7 (`error.tsx`, `not-found.tsx`, page titles, `.env.example` cleanup) plus a lint-gate fix (React-Compiler advisory rules → warn). Gates green; Playwright golden-path + breakpoint + Free-clamp smoke passed. Operator/launch-day items (§2.4 live Stripe, §11 backup, §12 observability + §12.4 audit logging, §13 prod env, full §8/§10 a11y + cross-browser, §16–§19) remain as a launch checklist.  
> **Effort:** M · **Value:** Required before ship  
> **Depends on:** All prior slices (§0–§8) complete ✅

---

## Overview

This is the final gate before Spendly ships to real users. No new features are built here — the goal is to harden everything already built: verify security invariants hold, confirm the Pro gate is exercisable end-to-end, walk every page on every breakpoint, audit empty states, and ensure the build and test suite are clean. Nothing in this slice changes behavior; it only catches gaps left by the individual feature slices.

---

## Scope

| Area | What it covers |
|---|---|
| **1. Security review** | Row-level ownership, auth guards, financial data in URLs, Stripe webhook |
| **2. isPro gate + Stripe** | Reports gate is real for Free/Pro; full Stripe checkout/portal/cancel/webhook acceptance |
| **3. Responsive QA** | Every page on mobile / tablet / desktop; drawers as bottom sheets |
| **4. Empty state audit** | Every page has actionable guidance, not a blank screen |
| **5. Build + test pass** | `npm run test:run`, `npm run build`, `npm run lint` are clean |
| **6. Prisma migrate** | No pending migrations on the production branch |
| **7. Additional checks** | Env vars, error/404 pages, page titles, console errors |
| **8. Accessibility** | Keyboard nav, focus trapping, contrast, ARIA, screen reader, reduced motion |
| **9. Performance smoke** | Bundle size, hydration, load smoke, no N+1 regressions |
| **10. Cross-browser QA** | Chrome, Safari (incl. iOS), Firefox, Edge |
| **11. Backup & rollback** | DB snapshot/restore, Stripe replay, atomic deploy rollback |
| **12. Observability** | Error monitoring, logging hygiene, alerting |
| **13. Prod env validation** | OAuth callbacks, Stripe live config, domain/HTTPS, email sender |
| **14. Data integrity smoke** | Balances, budget spend, goal progress, recurring, export, reports consistency |
| **15. Dependency audit** | `npm audit`, outdated security packages, committed-secret scan |
| **16. Support readiness** | Privacy policy, ToS, support/billing contact, incident plan |
| **17. Launch-day runbook** | Ordered release sequence: backup → migrate → deploy → smoke → Stripe → watch |
| **18. Post-launch metrics** | Registrations, onboarding completion, checkout conversion, webhook success |
| **19. Change freeze** | No upgrades/merges after sign-off except launch-blocking fixes |

---

## Risk Classification

Every issue found during this audit is triaged into one of three severities. This keeps decisions consistent — "do we fix this before launch?" has a defined answer per tier, not a per-issue debate.

| Severity | Definition | Action |
|---|---|---|
| **Launch Blocker** | Breaks a core invariant: any cross-user data exposure, an auth bypass, a missing row-level ownership check, money/Pro-grant correctness bug, a failed/irreversible migration, data loss, or no working rollback path. | **Must** be fixed before launch. No exceptions, no "documented risk" escape. |
| **High** | Materially degrades the launch but is not a security/correctness breach: a broken page on a major breakpoint, a non-functional empty state, a missing privacy policy on a public launch, no error monitoring at all, a known high/critical `npm audit` advisory in a runtime path. | Fix before launch **or** record an explicit, owner-approved accepted-risk note with a dated fast-follow. |
| **Medium** | Polish and resilience gaps that don't block the core loop: minor responsive glitches, a missing `aria-label`, a cosmetic contrast miss on non-essential text, a nice-to-have alert. | Track as a fast-follow; does not gate launch. |

Apply this to `/security-review` output too: map its CRITICAL/HIGH to **Launch Blocker**, its MEDIUM to **High** or **Medium** by the definitions above. When in doubt, escalate one tier.

---

## 1. Security Review

Run `/security-review` against the full branch first, then manually verify the items below. This checklist is ordered by blast radius — auth bypasses first, data leaks second.

### 1.1 Auth guards on every Server Action

Every file in `src/actions/` must call `auth()` at the top and return early if no session. Check each file:

| File | Guard present? |
|---|---|
| `src/actions/transactions.ts` | Every exported action has `auth()` + userId check |
| `src/actions/financial-accounts.ts` | Every exported action has `auth()` + userId check |
| `src/actions/budgets.ts` | Every exported action has `auth()` + userId check |
| `src/actions/goals.ts` | Every exported action has `auth()` + userId check |
| `src/actions/recurring.ts` | Every exported action has `auth()` + userId check |
| `src/actions/categories.ts` | Every exported action has `auth()` + userId check |
| `src/actions/profile.ts` | Every exported action has `auth()` + userId check |
| `src/actions/billing.ts` | Every exported action has `auth()` + userId check |

The pattern to verify:

```typescript
const session = await auth();
if (!session?.user?.id) return { success: false, error: "Unauthorized" };
const userId = session.user.id;
// All Prisma queries below use `userId`, never a client-supplied value
```

### 1.2 Auth guards on every API route

| File | Guard |
|---|---|
| `src/app/api/export/csv/route.ts` | `auth()` → 401 JSON (not redirect) |
| `src/app/api/export/json/route.ts` | `auth()` → 401 JSON (not redirect) |
| `src/app/api/stripe/webhook/route.ts` | Stripe `stripe-signature` header validated — NOT user session |
| `src/app/api/auth/*` | Unauthenticated by design (registration, login) |

### 1.3 Row-level ownership on all Prisma queries

Every Prisma `findMany`, `findUnique`, `update`, and `delete` call in `src/actions/` and `src/lib/db/` must include `userId` in the `where` clause. Spot-check the entities with the most complex ownership chains:

- **Goal contributions** — `deleteContribution` must verify the contribution's goal belongs to `userId`, not just that the contribution exists (`contribution.goal.userId !== userId`).
- **Recurring drafts** — `confirmDraft` and `dismissDraft` must verify the draft's template belongs to `userId` (join through `recurringTemplate.userId`).
- **Budget archive/unarchive** — must scope by `{ id, userId }`.
- **Category mutations** — must scope by `{ id, userId, isSystem: false }` (system categories are never mutable).

Pattern to verify for indirect ownership (join-through):

```typescript
// WRONG — does not verify userId
const draft = await prisma.recurringDraft.findUnique({ where: { id: draftId } });

// CORRECT — joins through to verify ownership
const draft = await prisma.recurringDraft.findUnique({
  where: { id: draftId },
  include: { recurringTemplate: true },
});
if (!draft || draft.recurringTemplate.userId !== userId) {
  return { success: false, error: "Not found" };
}
```

### 1.4 No financial data in URL parameters

The security rule: **no financial data in URL parameters or query strings**. Verify:

- `/transactions?account=<id>` — account ID is acceptable (public identifier, not financial data); amount/balance must never appear in the URL.
- `/reports?period=3m&account=<id>` — period and account ID are acceptable.
- `/budgets?month=6&year=2026` — month/year are acceptable.
- `/settings?checkout=success` — status string, acceptable.
- No route should ever expose amounts, balances, or transaction data in URL params.
- Export routes (`/api/export/*`) stream data as file downloads — they must never embed data in query params.

### 1.5 Stripe webhook signature verification

`src/app/api/stripe/webhook/route.ts` must:

1. Read the raw request body via `request.text()` (not `.json()` — body parsing invalidates the signature).
2. Read the `stripe-signature` header.
3. Call `stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET)` inside a try/catch.
4. Return 400 on `WebhookSignatureVerificationError`.
5. Return 500 on handler throw (so Stripe retries).
6. Return 200 on unknown/unhandled event types (don't 400 them — Stripe will retry unnecessarily).
7. Never import Prisma directly — ESLint boundary enforces reads must go through `src/lib/db/billing.ts`.

### 1.6 Input validation coverage

Every Server Action that accepts user-supplied data must run Zod `safeParse` before touching Prisma. Verify the Zod schema files exist and are imported:

| Action file | Validation schema |
|---|---|
| `src/actions/transactions.ts` | `src/lib/validations/transaction.ts` |
| `src/actions/budgets.ts` | `src/lib/validations/budget.ts` |
| `src/actions/goals.ts` | `src/lib/validations/goal.ts` |
| `src/actions/recurring.ts` | `src/lib/validations/recurring.ts` |
| `src/actions/financial-accounts.ts` | `src/lib/validations/financial-account.ts` |
| `src/actions/categories.ts` | `src/lib/validations/category.ts` |
| `src/actions/profile.ts` | `src/lib/validations/profile.ts` |

### 1.7 `server-only` guard on DB fetchers

Every file in `src/lib/db/` must have `import "server-only"` at the top to prevent accidental client-side import. Verify the following files have it:

- `src/lib/db/dashboard.ts`
- `src/lib/db/transactions.ts`
- `src/lib/db/accounts.ts`
- `src/lib/db/budgets.ts`
- `src/lib/db/goals.ts`
- `src/lib/db/recurring.ts`
- `src/lib/db/reports.ts`
- `src/lib/db/export.ts`
- `src/lib/db/categories.ts`
- `src/lib/db/profile.ts`
- `src/lib/db/billing.ts`

### 1.8 ESLint boundary — no Prisma in API routes

The `no-restricted-imports` rule forbids `@/lib/prisma` in `src/app/api/export/**` and `src/app/api/stripe/**`. Run `npm run lint` and confirm zero violations in those directories. Route handlers in those folders must reach the DB only through the DB-layer modules in `src/lib/db/`.

### 1.9 Rate limiting

Auth endpoints have rate limits via Upstash. Verify:

- Login: 5 attempts per 15 minutes per IP+email (enforced in `auth.ts` `authorize` callback).
- Register, forgot-password, reset-password: IP-keyed limits exist in their route handlers.
- Resend-verification: IP+email-keyed limit exists.
- Export routes: per-user rate limit (`RATE_LIMITS.export`) — fail-open if Redis is unreachable (fail-open must not fail-closed in a way that blocks legitimate exports).

Rate limiting must fail open — if Upstash is unreachable, the request proceeds. Confirm `checkRateLimit` returns `{ allowed: true }` on any error rather than throwing.

### 1.10 Soft-deleted user accounts

`User.deletedAt` gates both sign-in paths:

- **Credentials:** `verifyCredentials` must return null (not an error string) when `deletedAt` is set, so NextAuth denies sign-in without leaking the deletion state.
- **Google OAuth:** the `signIn` callback in `auth.ts` must check `user.deletedAt` and return `false` to block OAuth sign-in.

### 1.11 Session & storage persistence

Session-handling bugs are a classic launch-day failure. Verify the JWT session strategy behaves correctly across the browser lifecycle:

- [ ] **Logout → login:** signing out clears the session cookie; the protected pages redirect to `/sign-in`; signing back in restores access. No stale session survives logout.
- [ ] **Refresh:** a hard refresh on any protected page keeps the user signed in (the session cookie persists, not just in-memory state).
- [ ] **Expired session:** with an expired/invalid session cookie, a protected page redirects to `/sign-in` (handled by `auth.config.ts` `authorized` + the per-page guards) — it does **not** render with stale data or throw.
- [ ] **Multiple tabs:** signing out in one tab invalidates the others on their next navigation/action (no tab keeps mutating with a dead session — Server Actions re-check `auth()` independently, so a dead session returns "Unauthorized").
- [ ] **No financial data in client storage:** confirm nothing sensitive (balances, transactions, tokens) is persisted to `localStorage` / `sessionStorage`. The session is an httpOnly cookie; app data is fetched server-side per request.
- [ ] **Plan changes mid-session:** because all billing UI reads `isPro` fresh from the DB (never the JWT), a plan change reflects without re-sign-in — re-confirm here against the live session (overlaps §2.4.3).

---

## 2. isPro Gate Enforcement

**Status from build history:** `isPro` is already real and DB-driven — there is no dev-wide override. The seed creates `demo-pro@spendly.io` (`isPro: true`) and `demo-nonpro@spendly.io` (`isPro: false`). Every gate reads the live DB value.

The only Pro-gated feature is Reports history (Free ≤ 3 months, Pro ≤ 12 months). Verify:

### 2.1 Reports period gate — Free user

1. Sign in as `demo-nonpro@spendly.io`.
2. Navigate to `/reports`.
3. The period selector shows three pills: `This month`, `Last 3 months`, `Last 12 months`.
4. `Last 12 months` must be **visually disabled** with an upgrade prompt — not just hidden.
5. Selecting `?period=12m` via manual URL entry must:
   - Clamp the query to 3 months (`resolveEffectivePeriod` in `src/lib/report-period.ts`).
   - Render the 3-month charts (not blank, not a full 12-month view).
   - Show an upgrade banner above the chart grid.
   - Never run the 12-month DB query (`getReportProfile` → `isPro = false` → `resolveEffectivePeriod` clamps before any fetch).

### 2.2 Reports period gate — Pro user

1. Sign in as `demo-pro@spendly.io`.
2. Navigate to `/reports?period=12m`.
3. All four charts render with 12 months of data.
4. No upgrade banner is shown.

### 2.3 No other accidental gates

Verify these features work for Free users without any `isPro` check:

- Transactions (create/edit/delete)
- Budgets (all CRUD)
- Goals (all CRUD including contributions)
- Recurring templates (all CRUD including draft confirm)
- Data export (both CSV and JSON)
- Settings (name edit, billing UI visible — upgrade button shown to Free users)
- Financial accounts (all CRUD)
- Custom categories (all CRUD)

### 2.4 Stripe acceptance criteria

With real Stripe keys configured (test mode) and the Stripe CLI webhook listener running (`stripe listen --forward-to localhost:3000/api/stripe/webhook`). These are launch-day acceptance tests, not per-build checks.

#### 2.4.1 Checkout (Free → Pro)

1. Sign in as `demo-nonpro@spendly.io`.
2. Navigate to `/settings` → Billing card.
3. Click "Upgrade — €3/mo".
4. Stripe Checkout page opens with the correct price (€3.00/month).
5. Complete checkout with a Stripe test card (`4242 4242 4242 4242`, any future expiry, any CVC).
6. Return to `/settings?checkout=success`.
7. `reconcileCheckoutReturn` fires — `isPro` flips to `true` in the DB within one page load (webhook race closes at first paint).
8. `/reports?period=12m` now renders all 12 months with no banner.
9. Repeat for the annual plan ("Upgrade — €25/yr") — verify the €25.00/year price and Pro grant.
10. Cancelled checkout: start checkout, click back/cancel, return to `/settings?checkout=cancelled` — the cancellation banner shows and `isPro` stays `false`.

#### 2.4.2 Customer Portal (manage subscription)

1. Sign in as a Pro user.
2. `/settings` → Billing card shows "Manage subscription" (not the upgrade buttons).
3. Click it → `createPortalSession` redirects to the Stripe Customer Portal.
4. The portal shows the active subscription, payment method, and invoice history.
5. Return link from the portal lands back on `/settings`.

#### 2.4.3 Subscription cancellation (Pro → Free)

1. From the Customer Portal, cancel the subscription.
2. Stripe emits `customer.subscription.deleted` (or `customer.subscription.updated` with `status: canceled` at period end, depending on portal config).
3. The webhook's event→intent mapper resolves the subscription to Free; `clearSubscription`/`syncSubscription` sets `isPro = false`.
4. `/settings` reflects Free **without a re-sign-in** (UI reads `isPro` fresh from the DB, never the JWT).
5. `/reports?period=12m` reverts to the clamped 3-month view with the upgrade banner.
6. Verify "cancel at period end" vs "cancel immediately" both land on the correct `isPro` value per the mapper's status rules (`active`/`trialing` → Pro, everything else → Free).

#### 2.4.4 Webhook recovery / resilience

- **Out-of-order delivery:** replay a `customer.subscription.updated` event *before* the `checkout.session.completed` that links the customer. Because subscription writers use `updateMany` keyed on `stripeCustomerId`, the early event matches zero rows (safe no-op, no `P2025`), and the later checkout link + a re-sent subscription event converge on the correct state.
- **Bad signature:** send a payload with an invalid `stripe-signature` → 400, no DB write.
- **Handler throw:** simulate a DB error inside a handler → route returns 500 so Stripe retries (verify via `stripe trigger` + forced fault, or inspect the retry in the Stripe CLI).
- **Unknown event type:** send an event the app does not handle (e.g. `invoice.paid`) → 200, no-op, no error logged as fatal.
- **Idempotent redelivery:** replay the same `checkout.session.completed` twice → `isPro` stays `true`, no duplicate side effects.

#### 2.4.5 Cancel-on-account-deletion

1. As a Pro user, run the delete-account flow on `/profile`.
2. `softDeleteAccount` best-effort cancels the live Stripe subscription before stamping `deletedAt`.
3. Verify the subscription is cancelled in the Stripe Dashboard.
4. Verify a Stripe API outage during this step does **not** block account deletion (error is logged and swallowed; `stripeCustomerId` is retained for audit).

---

## 3. Responsive QA

Walk every page in each breakpoint category. Use browser DevTools device emulation:

- **Mobile:** 375×812 (iPhone 14 portrait)
- **Tablet:** 768×1024 (iPad portrait) — the icon-only sidebar breakpoint
- **Desktop:** 1440×900

### 3.1 Layout system

| Breakpoint | Expected sidebar behavior |
|---|---|
| < 768px | Hamburger overlay; bottom navigation bar visible |
| 768–1024px | Icon-only collapsed sidebar; no bottom nav |
| ≥ 1024px | Full labeled sidebar |

The bottom nav (Home, Transactions, Budgets, More + floating Add) must be visible and functional at < 768px. Verify each nav item routes correctly. The floating Add button must open the transaction drawer.

### 3.2 Drawer behavior

On mobile (< 768px), all slide-in drawers must behave as **bottom sheets** (~90vh, slides up from bottom). On desktop (≥ 768px), they must be right-side panels (420px wide).

Pages with drawers to test:

| Page | Drawer(s) |
|---|---|
| `/transactions` | Transaction create/edit drawer |
| `/budgets` | Budget create/edit drawer |
| `/goals` | Goal create/edit drawer; Contribution add drawer |
| `/recurring` | Template create/edit drawer |
| `/accounts` | Account create/edit drawer |
| `/settings` | Category form drawer (via Manage categories) |

For each: open on mobile, verify it slides up from the bottom. Open on desktop, verify it slides in from the right. Close by clicking the backdrop — verify it dismisses cleanly.

### 3.3 Page-by-page QA checklist

#### `/dashboard`

- [ ] Hero balance, metric strip, insights strip, transactions panel, budgets panel, goals widget all visible at all breakpoints.
- [ ] Account selector pill in topbar works and scopes data.
- [ ] Insights strip pills link to the correct pages.
- [ ] No horizontal overflow at any breakpoint.

#### `/transactions`

- [ ] Date-grouped feed renders correctly on mobile (2-column card layout) and desktop (4-column table).
- [ ] Filter pills (All / Income / Expense) work.
- [ ] Search input works.
- [ ] "Load more" button works.
- [ ] Transfer rows collapse correctly in all-accounts mode.

#### `/budgets`

- [ ] Period stepper (← month → month) navigates correctly.
- [ ] Progress bars render at all widths.
- [ ] Budget form drawer opens and saves.
- [ ] Archive with Sonner undo works.

#### `/recurring`

- [ ] Drafts inbox and templates list both visible.
- [ ] Confirm / dismiss draft works.
- [ ] Overdue drafts highlighted.

#### `/goals`

- [ ] Active and completed sections render.
- [ ] Progress bars and Over 100% pill visible.
- [ ] Overdue badge visible on qualifying goals.
- [ ] Goal form drawer and contribution drawer both open and save.

#### `/reports`

- [ ] Period selector pills render correctly.
- [ ] All four SVG charts render and are readable on mobile.
- [ ] Donut chart legend is visible (not clipped) at 375px width.
- [ ] Income vs Expenses grouped bar chart does not overflow at narrow widths — verify bars scale down or the chart scrolls horizontally rather than overflowing the viewport.
- [ ] Account filter scopes all charts.
- [ ] Free-user upgrade banner appears and is not dismissible (it persists as long as `isPro = false`).

#### `/accounts`

- [ ] Account list with derived balances renders.
- [ ] Create/edit/archive/unarchive all work.
- [ ] Export links visible (relocated from here to `/settings` — confirm they are gone from this page).

#### `/onboarding`

- [ ] Step 1 (create account) renders correctly at all breakpoints.
- [ ] Step 2 (starter budgets) renders correctly.
- [ ] Step 3 (done) renders correctly.
- [ ] A user with zero active accounts is redirected here from `/dashboard`.
- [ ] `/accounts` and `/profile` remain reachable from onboarding (escape hatches).

#### `/settings`

- [ ] Preferences card: name edit, submit, auto-dismissing success banner.
- [ ] Billing card: correct plan badge (Free / Pro), Upgrade buttons for Free / Manage for Pro.
- [ ] Your data card: Export CSV / JSON links work, scope label is correct.
- [ ] Manage categories card: list, edit, delete with impact dialog.

#### `/profile`

- [ ] User data (name, email, plan badge, stats) renders.
- [ ] Change password form visible only when `password != null` (i.e. not shown for OAuth-only users).
- [ ] Delete account dialog requires email confirmation.

#### Auth pages (`/sign-in`, `/register`, `/forgot-password`, `/reset-password`)

- [ ] All render correctly on mobile (centered card, inputs full-width).
- [ ] Google OAuth button visible and functional.
- [ ] No layout overflow on small screens.

### 3.4 Topbar across breakpoints

- [ ] Logo and wordmark visible on desktop; wordmark hidden on small screens.
- [ ] Account selector pill visible at all breakpoints.
- [ ] Settings icon and avatar visible at all breakpoints.
- [ ] No topbar items overlap or overflow at 375px.

---

## 4. Empty State Audit

Every page must show an **actionable** empty state — a guidance message with a CTA button — when there is no data. A blank screen or a spinner that never resolves is a launch blocker.

| Page | Empty condition | Expected empty state |
|---|---|---|
| `/dashboard` | Zero active accounts | "Create your first account →" card (defensive fallback, already built) |
| `/dashboard` | Has accounts but no transactions | Transaction feed area shows "No transactions yet" placeholder |
| `/transactions` | No transactions match filters | "No results. [Clear filters]" link |
| `/transactions` | Zero transactions ever | "No transactions yet. Add your first one." with Add button |
| `/budgets` | No budgets for current month | `<BudgetEmptyState>` — "Use starter budgets" CTA (existing) |
| `/recurring` | No templates | `<RecurringEmptyState>` — "No templates yet" (existing) |
| `/goals` | No goals | `<GoalEmptyState>` — "Set your first savings goal" CTA (existing) |
| `/accounts` | No accounts | `<AccountEmptyState>` — "Create your first account" (existing) |
| `/reports` | < `REPORTS_MIN_TRANSACTIONS` (15) for trend charts | Per-chart nudge copy: "Add 15 more transactions to see spending trends" |
| `/reports` | Zero transactions at all | Category and balance charts show empty-state nudge; trend charts show the same nudge |
| `/settings` → Manage categories | No user categories | "No custom categories yet." with a hint to use the + button in category pickers |

**Verify against real data:** For each empty state, either use the `demo-nonpro` account (which may have no data in a reset state) or temporarily archive all accounts to trigger the guards.

The `requireOnboarded()` guard on `/dashboard`, `/transactions`, `/budgets`, `/recurring`, `/goals`, and `/reports` redirects to `/onboarding` when there are zero active accounts — this prevents most "empty app" states. The empty states above are for the case where an onboarded user simply has no data in a category yet.

---

## 5. Build and Test Pass

Before committing the final §9 changes:

```bash
npm run test:run   # must exit 0, no failing tests
npm run build      # must exit 0, no TypeScript errors
npm run lint       # must exit 0, no ESLint violations
```

Current baseline: **506 Vitest tests** (as of `feature/user-category-management`). The §9 work is audit/verification, not new code — no new tests are required unless the audit uncovers a gap in an existing action's coverage.

If `npm run build` surfaces TypeScript errors introduced by the audit fixes, resolve them before declaring §9 complete. Do not suppress errors with `@ts-ignore` or `as any`.

### 5.1 TypeScript strict mode

`tsconfig.json` has `"strict": true`. Verify there are no type assertions (`as SomeType`) added during §9 fixes that paper over real type errors. The codebase must not use `any` types — use `unknown` + type narrowing where the type is genuinely unknown.

### 5.2 No unused exports

Run the build and check for "exported but never used" warnings (TypeScript's `noUnusedLocals` / `noUnusedParameters` catches some of these, bundler treeshaking catches others). Dead exports in `src/actions/` are particularly risky — a Server Action file's exports are all callable from the client by design, so unused ones expand the attack surface.

---

## 6. Prisma Migrations

### 6.1 Check migration status on development branch

```bash
npx prisma migrate status
```

Expected output: "All migrations have been applied." If any pending migrations exist, run:

```bash
npx prisma migrate dev
```

### 6.2 Production migration plan

Before launch, run on the production Neon branch:

```bash
npx prisma migrate deploy
```

Migrations to verify are applied to production:

| Migration name | What it does |
|---|---|
| `init` | Full initial schema |
| `add_user_deleted_at` | Adds `User.deletedAt` for the 30-day grace period |
| `reconcile_currency_eur_default` | Flips `preferredCurrency` + `currency` defaults to EUR; backfills USD→EUR |
| Any `--create-only` migrations | The `category_name_ci_unique` functional index (`(lower(name), userId)`) and the `RecurringDraft` partial unique index |

> **Rule from `coding-standards.md`:** Never use `db push` or directly modify the database. Always run `prisma migrate deploy` on production — never `migrate dev`.

### 6.3 Verify seed is not run on production

`prisma/seed.ts` creates demo users (`demo-pro@spendly.io`, `demo-nonpro@spendly.io`) and sample data. The seed must **never** run against the production database. Confirm `package.json` does not call `prisma db seed` in any production startup script.

---

## 7. Additional Checks

These are not in the ROADMAP's §9 bullet list but are required before ship:

### 7.1 Environment variables

Verify `.env.example` is complete and up to date. Every variable the app reads at runtime must have an entry. Current list:

```bash
DATABASE_URL=
AUTH_SECRET=
AUTH_URL=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID_MONTHLY=
STRIPE_PRICE_ID_YEARLY=
UPSTASH_REDIS_REST_URL=        # optional — rate limiting fails open if absent
UPSTASH_REDIS_REST_TOKEN=      # optional — same
EMAIL_VERIFICATION_ENABLED=    # optional — defaults to "true"
```

Verify no variable is read in source code but absent from `.env.example`.

### 7.2 Error boundaries

Next.js uses `error.tsx` files as error boundaries. Verify that the app-level shell has an error boundary so a runtime error on one page does not produce an unstyled Next.js error page. A minimal `src/app/error.tsx` (client component with a "Something went wrong" message and a retry/home link) is sufficient.

### 7.3 Not-found page

Verify `src/app/not-found.tsx` exists and renders a styled 404 page with a link back to `/dashboard`. A blank Next.js 404 page before launch is a trust signal failure.

### 7.4 Page titles and meta

Each page should have a descriptive `<title>` via Next.js `metadata` exports. Check:

- `/dashboard` — "Dashboard — Spendly"
- `/transactions` — "Transactions — Spendly"
- `/reports` — "Reports — Spendly"
- `/settings` — "Settings — Spendly"
- Auth pages — "Sign in — Spendly", "Create account — Spendly"

The homepage (`/`) already has OpenGraph metadata from the homepage slice.

### 7.5 Console errors in production build

Start the production build locally (`npm run build && npm run start`) and walk the golden path (register → onboard → add transaction → view dashboard → view reports → export). Check the browser console for:

- React hydration errors
- Missing `key` props on list renders
- Network 4xx/5xx errors in the network tab
- Unhandled promise rejections

---

## 8. Accessibility (a11y) Audit

The app is dark-mode-first with dense financial data. Walk each surface with keyboard-only and screen-reader checks. Use the browser's accessibility inspector and (optionally) axe DevTools for an automated first pass — but automated tools catch only ~40% of issues, so the manual checks below are mandatory.

### 8.1 Keyboard navigation

- [ ] Every interactive element (nav links, buttons, form inputs, drawer triggers, table rows that act as buttons) is reachable via `Tab` and activatable via `Enter`/`Space`.
- [ ] Tab order is logical (follows visual order; no jumps).
- [ ] No keyboard traps — `Tab` always escapes a component.
- [ ] The transaction feed rows (clickable buttons) are focusable and respond to `Enter`.
- [ ] Skip-to-content affordance or logical landmark order so keyboard users don't tab through the full sidebar on every page.

### 8.2 Focus management (drawers and dialogs)

The Sheet (Radix Dialog) and native `<dialog>` confirm dialogs must manage focus correctly:

- [ ] Opening a drawer/dialog moves focus into it (first focusable element or the dialog container).
- [ ] Focus is **trapped** inside the open drawer/dialog (`Tab` cycles within it, does not reach the page behind).
- [ ] `Escape` closes the drawer/dialog.
- [ ] Closing returns focus to the trigger element that opened it.
- [ ] The backdrop is not focusable but a click on it dismisses the drawer.

Surfaces to check: transaction drawer, budget drawer, goal drawer, contribution drawer, recurring template drawer, account drawer, category form drawer, delete-confirm dialogs (goals, categories, account deletion).

### 8.3 Color contrast

Dark-mode-first means contrast is easy to get wrong. Verify WCAG AA (4.5:1 for normal text, 3:1 for large text / UI components):

- [ ] Body text and metadata (the `text-ink-2` muted tone) against `bg-app` / `bg-sidebar` / `bg-tertiary`.
- [ ] Eyebrow labels (9–10px caps) — small text needs the full 4.5:1.
- [ ] Semantic status colors (green `#1D9E75`, amber `#EF9F27`, red `#E24B4A`) against their backgrounds, including on progress bars and pills.
- [ ] Disabled states (e.g. the Free-user "Last 12 months" pill) — must still be legible, just clearly inactive.

### 8.4 Color is never the only signal

Per the existing Reports work, color must not be the sole carrier of meaning:

- [ ] Budget progress states (green/amber/red) are reinforced by the percentage text, not color alone.
- [ ] Goal overdue state has the "Overdue" badge text, not just a red tint.
- [ ] Insights strip pills carry text labels, not just colored dots.
- [ ] Reports chart series have legends and `aria-label` summaries (already built — verify they survived).

### 8.5 ARIA and semantics

- [ ] Form inputs have associated `<label>` elements (or `aria-label` where a visible label is absent).
- [ ] Icon-only buttons (sidebar collapsed, overflow menus, floating Add) have `aria-label`.
- [ ] The four Reports SVG charts keep `role="img"` + data-summarizing `aria-label` (capped at `ARIA_SUMMARY_MAX`), with decorative shapes `aria-hidden` — verify none regressed.
- [ ] Status banners (success, error, upgrade prompt) use `role="status"` or `role="alert"` so screen readers announce them.
- [ ] Toasts (Sonner) announce to assistive tech (Sonner provides this; verify it is not suppressed).
- [ ] Decorative elements (the homepage cube animation, chart gridlines) are `aria-hidden`.

### 8.6 Screen reader smoke test

Run one full pass with a screen reader (VoiceOver on macOS, NVDA on Windows) through the golden path: sign in → dashboard → add a transaction → view a budget → view reports. Confirm:

- [ ] Page changes are announced (the page `<title>` updates — see §7.4).
- [ ] The hero balance and metric strip read as meaningful values, not bare numbers.
- [ ] Form validation errors are announced when they appear.

### 8.7 Reduced motion

- [ ] `prefers-reduced-motion` is honored — the homepage cube animation already has a static path; verify drawer transitions and any other motion respect it or are subtle enough to be safe.

---

## 9. Performance Smoke Test

Not a full performance pass (that is post-MVP per `project-overview.md`), but a guard against obvious regressions before launch.

### 9.1 Production build profile

After `npm run build`, inspect the build output:

- [ ] No route's First Load JS is alarmingly large (flag anything well above the app average — likely an accidental client-side import of a server-only module or a heavy dependency pulled into a client bundle).
- [ ] The Reports page does **not** ship a charting library to the client — charts are hand-rolled SVG and should add negligible JS.
- [ ] No `src/lib/db/*` or Prisma code leaked into a client bundle (the `server-only` guards in §1.7 should prevent this; the build will error if violated — confirm it does).

### 9.2 Runtime smoke (local production)

Run `npm run build && npm run start`, then with DevTools open:

- [ ] No React hydration mismatch warnings in the console on any page (overlaps §7.5).
- [ ] No layout shift jank on dashboard/reports load (skeletons should hold layout).
- [ ] Largest pages (dashboard with `Promise.all` of 7 fetchers; reports with 4 chart fetchers) load without a visible multi-second stall on a seeded demo account.
- [ ] No N+1 query smell — verify the known no-N+1 fetchers (`getAccountsWithBalances` 2-query groupBy, `getCategoryBreakdown` batched lookup) still issue a constant number of queries (spot-check via Prisma query logging if needed).

### 9.3 Image / asset weight

- [ ] No unoptimized large images in the marketing pages or app shell.
- [ ] Fonts are subset/loaded efficiently (no flash of invisible text blocking render).

---

## 10. Cross-Browser QA Matrix

§3 covers viewport sizes; this covers browser engines. Walk the golden path (sign in → dashboard → add transaction → reports → export) plus open one drawer in each browser.

| Browser | Engine | Priority | Notes |
|---|---|---|---|
| Chrome (latest) | Blink | P0 | Primary dev target |
| Safari (latest, macOS + iOS) | WebKit | P0 | iOS Safari is the main mobile target; test the bottom-sheet drawer and `<dialog>` here specifically |
| Firefox (latest) | Gecko | P1 | |
| Edge (latest) | Blink | P1 | Shares Blink with Chrome; quick confirmation pass |

Browser-specific things to watch:

- [ ] Native `<dialog>` (delete-confirm dialogs) behaves consistently — backdrop, `Escape`, focus.
- [ ] The Popover API (mobile nav menu on the marketing page) works in Safari/Firefox or has a fallback.
- [ ] CSS `bg-linear-to-r` gradient text (hero "Clarity" accent) renders in all four.
- [ ] Date inputs (`<input type="date">`) render and accept the local calendar date in each browser — this is the source of the no-UTC-conversion rule, so verify the value submitted is the local date.
- [ ] Sheet drawer transitions (300ms) are smooth, not janky, in Safari.
- [ ] CSV download (`Content-Disposition: attachment`) triggers a file download (not an in-tab navigation) in every browser, and the UTF-8 BOM + `sep=,` hint opens cleanly.

---

## 11. Backup & Rollback Verification

Before flipping production live, confirm the recovery paths exist — not just the happy path.

### 11.1 Database

- [ ] Neon point-in-time restore / branching is available on the production project — confirm the retention window covers at least the launch window.
- [ ] A pre-launch snapshot/branch of production is taken immediately before running `prisma migrate deploy`, so a bad migration can be rolled back to a known-good state.
- [ ] Migration rollback plan: for each migration in §6.2, know whether it is reversible. The `reconcile_currency_eur_default` backfill (USD→EUR) is **not** automatically reversible — document that a restore-from-snapshot is the rollback path, not a down-migration.
- [ ] Confirm `DATABASE_URL` (pooled) and `DIRECT_URL` (unpooled, for migrations) both point at production and are distinct from development.

### 11.2 Stripe

- [ ] The production webhook endpoint is registered in the Stripe Dashboard and its signing secret is set as `STRIPE_WEBHOOK_SECRET` in production env.
- [ ] If a launch issue forces a rollback, document that subscriptions already created in Stripe persist independently of the app — `isPro` can be re-reconciled by replaying webhook events from the Stripe Dashboard ("Resend" on past events), so a brief app outage does not strand paying users.
- [ ] Verify the live "Spendly Pro" product + two EUR prices match the IDs in `STRIPE_PRICE_ID_MONTHLY` / `STRIPE_PRICE_ID_YEARLY`.

### 11.3 Deployment

- [ ] Deployment is atomic / supports instant rollback to the previous build (e.g. Vercel's previous-deployment promote).
- [ ] `prisma migrate deploy` runs **before** the new app version serves traffic (additive migrations only — none of the shipped migrations drop columns, so old→new is forward-compatible during the brief overlap).
- [ ] Env vars are present in the production environment before the first deploy (cross-check against §7.1).

### 11.4 Disaster recovery drill (actual restore, not just "backups exist")

A backup you've never restored is a hypothesis, not a recovery plan. Perform a real restore once before launch:

- [ ] Take a snapshot/branch of production (or a representative dataset) and **actually restore it onto a fresh Neon staging branch**.
- [ ] Point a local/staging app instance at the restored branch and confirm it boots, signs in, and renders real data (balances, transactions) correctly.
- [ ] Time the restore end-to-end and record it — this is the real RTO (recovery time objective) number to cite in an incident, not a guess.
- [ ] Confirm `prisma migrate status` against the restored branch reports all migrations applied (the snapshot captured schema + data consistently).
- [ ] Tear down the staging branch afterward so it doesn't drift or accrue cost.

> Run this drill against a **staging branch only** — never restore over the live production branch as a "test".

---

## 12. Observability

So that post-launch issues are detected rather than reported by users.

### 12.1 Error monitoring

- [ ] An error-tracking integration (e.g. Sentry, or the hosting platform's built-in error capture) is wired for both server (Server Actions, API routes, webhook) and client (the `error.tsx` boundary) — or, if deferred, this is a documented, accepted launch risk.
- [ ] The Stripe webhook logs handler failures (the 500 path) with enough context to diagnose a reconciliation gap.
- [ ] Server Actions do not swallow unexpected errors silently — the `{ success: false, error }` return is for *expected* failures; genuinely unexpected throws should surface to the error tracker.

### 12.2 Logging

- [ ] No secrets, passwords, tokens, or full financial records are written to logs. Verify the rate-limit fail-open path, the email-send-failure catch, and the Stripe cancel-on-delete catch log a message without leaking PII or tokens.
- [ ] Auth events (failed logins beyond the rate limit, account deletions) are logged at a level useful for security review.

### 12.3 Alerting

- [ ] A minimal alert exists for: production 5xx spike, Stripe webhook failure rate, and database connection failures — or this is documented as a fast-follow with a manual-monitoring plan for the launch window.
- [ ] A health check / uptime monitor pings the deployed app.

### 12.4 Destructive-action audit trail

Irreversible or hard-to-reverse mutations should leave a trace so a "where did my data go?" support request can be answered. The MVP bar is a structured log line (with `userId`, entity id, timestamp), not a dedicated audit table — but confirm each destructive path emits at least that:

| Action | Reversibility | Audit signal to confirm |
|---|---|---|
| Delete account (`softDeleteAccount`) | 30-day grace, then purge | Log the soft-delete + the Stripe cancel outcome (success/swallowed error) |
| Delete category (`deleteCategory`) | Hard delete (FK SetNull/Cascade) | Log `userId` + category id + the affected-rows impact |
| Delete goal (`deleteGoal`) | Hard delete, cascades to contributions | Log `userId` + goal id |
| Delete goal contribution (`deleteContribution`) | Hard delete, decrements `currentAmount` | Log `userId` + contribution id + goal id |
| Delete recurring template (`deleteTemplate`) | Hard delete, cascades to drafts | Log `userId` + template id |
| Transaction soft-delete (`softDeleteTransaction`) | Recoverable (8s undo / `deletedAt`) | Lower priority — recoverable, but a log line is cheap |

- [ ] Each hard-delete action above writes a structured log entry routed to the error/observability sink (§12.1) — not a bare `console.log` swallowed in prod.
- [ ] No PII or financial amounts in the log line beyond ids and counts (cross-check §12.2 log hygiene).
- [ ] If a dedicated audit-log table is desired, that is explicitly **post-MVP** — note it as a fast-follow rather than building it here (no new schema in §9).

> **MVP-appropriate scope:** Full APM and dashboards are post-launch. The bar here is "if Pro grants stop working or the app starts 500ing, someone finds out within minutes, not from a support email." Anything beyond that can be a documented fast-follow.

---

## 13. Production Environment Validation

Misconfiguration of external services is one of the most common launch failures — everything passes locally, then breaks because a callback URL points at `localhost`. Verify each integration's **production** configuration, not just that the env var exists.

### 13.1 Auth

- [ ] `AUTH_URL` is set to the production origin (e.g. `https://spendly.app`), not `localhost`.
- [ ] `AUTH_SECRET` is a fresh production secret — **not** the dev value (rotated per the Security section of `project-overview.md`).
- [ ] **Google OAuth callback URL** — the production redirect URI (`https://<prod-domain>/api/auth/callback/google`) is registered in the Google Cloud Console OAuth client. A missing prod callback is the classic "works in dev, 400 in prod" failure.
- [ ] `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` are the production OAuth client's credentials (a separate client from dev is recommended).
- [ ] The Google OAuth consent screen is published (not stuck in "Testing", which limits sign-in to allowlisted accounts).

### 13.2 Stripe

- [ ] `STRIPE_SECRET_KEY` is a **live-mode** key (`sk_live_…`), not a test key, for the production deploy.
- [ ] The **production webhook endpoint** (`https://<prod-domain>/api/stripe/webhook`) is registered in the Stripe Dashboard with the events the app handles (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`).
- [ ] `STRIPE_WEBHOOK_SECRET` is the **live-mode** signing secret for that endpoint (test and live secrets differ).
- [ ] The **Customer Portal** is activated and configured in live mode (cancellation behavior, invoice history, allowed updates) — `createPortalSession` 500s if the portal is not configured.
- [ ] `STRIPE_PRICE_ID_MONTHLY` / `STRIPE_PRICE_ID_YEARLY` are the **live** price IDs for the live "Spendly Pro" product, and their amounts (€3 / €25) match `PRICING`.

### 13.3 Domain, HTTPS, and email

- [ ] The production domain resolves and serves over **HTTPS**; HTTP redirects to HTTPS at the infra level (per the Security section).
- [ ] Email sender is configured: the Resend API key is set in production, and `EMAIL_FROM` uses a **verified sending domain** — the dev `onboarding@resend.dev` sender will not deliver reliably to real users at volume. Verify SPF/DKIM for the production sending domain.
- [ ] Send one real verification email and one real password-reset email to an external address and confirm delivery (not spam-foldered).
- [ ] `DATABASE_URL` / `DIRECT_URL` point at the **production** Neon branch (cross-check with §11.1).

### 13.4 Rate limiting

- [ ] `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are set in production. They are optional (fail-open), but launching without them means auth endpoints have **no** rate limiting — decide deliberately whether that is acceptable for launch, and document the decision.

### 13.5 Email deliverability audit

Every transactional email the app sends must actually land in the inbox — a verification email caught in spam blocks the entire registration flow. The app sends three kinds: **email verification**, **password reset**, and (from Stripe, not the app) **billing receipts/invoices**.

- [ ] **SPF, DKIM, and DMARC** are all configured and passing for the production sending domain (Resend's dashboard shows domain verification status; use a mail-tester tool to confirm all three pass on a real send).
- [ ] `EMAIL_FROM` is an address on the verified domain — not `onboarding@resend.dev` (dev only).
- [ ] **Verification email:** register a real external address → email arrives in the inbox (not spam), the link works, and it lands on `/sign-in?verified=1`.
- [ ] **Password reset:** request a reset for a real address → email arrives, link works, reset completes. Confirm the enumeration-safe behavior still sends only when the user has a password.
- [ ] **Stripe billing emails:** in the Stripe Dashboard, confirm customer emails (receipts, payment-failed, subscription updates) are enabled in live mode so paying users get receipts.
- [ ] **Sender reputation:** the sending domain is not on a blocklist; ideally warm it with a few sends before launch volume.
- [ ] Email send failures are non-fatal — registration still succeeds if the verification email fails to send (already built; re-confirm the catch logs without throwing).

---

## 14. Data Integrity Smoke Test

Verify the derived/denormalized values stay internally consistent after real workflows. These are the invariants the architecture depends on — a drift here is a correctness bug, not a cosmetic one.

Run on a fresh (non-seeded) account after exercising each workflow:

### 14.1 Account balances (derived)

- [ ] Create an account with a known starting balance; add a mix of income and expense transactions. The dashboard hero balance and the `/accounts` derived balance equal `startingBalance + SUM(non-deleted amounts)`.
- [ ] Soft-delete a transaction → balance updates immediately; undo → balance reverts.
- [ ] Archived-account transactions are excluded from the dashboard hero/metric strip but the account's own derived balance still reconciles.

### 14.2 Transfers

- [ ] A transfer creates two legs sharing a `transferPairId` with opposite signs; the **net** effect across both accounts is zero. `SUM(amount)` over all transactions (including both transfer legs) reconciles with the CSV export's `SUM(Amount)`.

### 14.3 Budget spend

- [ ] Budget `spent` equals the sum of that category's EXPENSE transactions within the month window (half-open `[from, to)`).
- [ ] Per `entity-crud-architecture.md`, archived-account expenses **still** count toward budget spend (intentional asymmetry) — verify this holds and is not "fixed".
- [ ] Progress-bar state thresholds (green < 60%, amber 60–90%, red > 100%) match the computed fraction.

### 14.4 Goal progress (denormalized `currentAmount`)

- [ ] `Goal.currentAmount` equals `SUM(contributions.amount)` after adding several contributions and at least one withdrawal (negative).
- [ ] Deleting a contribution decrements `currentAmount` by exactly that contribution's amount — the invariant never drifts.
- [ ] Overfunded (`currentAmount > targetAmount`) and overdue states render per `isGoalOverdue`.

### 14.5 Recurring confirm

- [ ] Confirming a draft creates exactly one Transaction with `merchant = template.name`, marks the draft `CONFIRMED`, and advances `nextOccurrence` by the cadence — all three, atomically (no partial state on failure).
- [ ] The confirmed transaction shows the template name (not the category name or "Transaction") in both the feed and the dashboard.

### 14.6 Export ↔ app consistency

- [ ] The JSON export's account balances match the in-app derived balances.
- [ ] The CSV row count equals the non-deleted transaction count (transfers as two rows).
- [ ] `?account=` scoping in the export matches what the in-app account filter shows (account-bound entities scoped; budgets/goals/categories full — the deliberate C2 asymmetry).

### 14.7 Reports ↔ source data

- [ ] The Reports "Income vs Expenses" totals for the current month match the dashboard metric strip for the same account scope.
- [ ] Category breakdown totals sum to the total expenses for the period.

---

## 15. Dependency & Security Audit

Catch known-vulnerable packages and stale dependencies before they ship.

- [ ] Run `npm audit` — review all **high** and **critical** advisories. Fix (upgrade) or document an accepted risk with rationale for each. Do not blanket-`--force` fix (it can introduce breaking major bumps).
- [ ] Run `npm outdated` — note any major-version gaps in security-sensitive packages (`next-auth`, `stripe`, `@auth/prisma-adapter`, `bcryptjs`, `zod`, `@prisma/client`). Patch/minor security updates should be applied; majors are a judgment call (don't churn the stack right before launch unless there's a CVE).
- [ ] Confirm lockfile (`package-lock.json`) is committed and the build uses it (`npm ci` semantics in CI/deploy).
- [ ] Verify no secrets are committed: scan the repo history for accidentally committed `.env`, API keys, or `AUTH_SECRET` values. `.env` files must be gitignored (per the project's `.gitignore` rules).
- [ ] If Dependabot (or equivalent) is available on the repo, confirm it is enabled so post-launch advisories surface automatically.

---

## 16. Support Readiness

Required only if Spendly onboards external users immediately at launch. If launch is a private/soft launch to known users, this can be a documented fast-follow — but decide explicitly.

- [ ] **Privacy policy** is published and linked (the footer or settings). A finance app handling personal financial data without a privacy policy is both a trust and a legal liability.
- [ ] **Terms of Service** published and linked.
- [ ] **Support contact path** exists — a support email or form reachable from the app (footer/settings).
- [ ] **Billing contact path** — users with subscription/payment issues have a clear route (the Stripe Customer Portal covers self-service cancellation; a human contact covers disputes).
- [ ] **Incident communication plan** — a lightweight plan for how users are told if there's an outage or a billing problem (status page, email, or banner). For MVP this can be a single documented procedure, not infrastructure.
- [ ] The account-deletion / data-export flows are reachable and documented, satisfying the data-portability promise (`/settings` → "Your data") — relevant for GDPR-style data requests.

---

## 17. Launch-Day Runbook

The exact ordered sequence for release, to reduce operational mistakes. Each step gates the next — do not proceed past a failed step.

1. **Pre-flight.** Confirm §13 (production env validation), §15 (dependency audit), and §11.2/§13.2 (Stripe live config) are green. Confirm the deploy targets the production branch and the build is the reviewed commit.
2. **Backup.** Take the pre-launch Neon snapshot/branch of production (§11.1). Record the snapshot ID / restore point.
3. **Migrate.** Run `npx prisma migrate deploy` against the production branch (never `migrate dev`, never `db push`). Confirm `npx prisma migrate status` reports all applied. Do **not** run the seed (§6.3).
4. **Deploy.** Promote the new build so it serves production traffic. Verify the previous build is retained for instant rollback (§11.3).
5. **Smoke test (production).** Walk the golden path on the live domain: register a real account → verify email → onboard (create account) → add a transaction → view dashboard → view reports → export CSV/JSON. Confirm no 5xx and no console errors.
6. **Stripe verification (live mode).** Run the §2.4 acceptance against live mode with a real card (or a live-mode test as Stripe allows): upgrade → `isPro` flips → portal opens → cancel → reverts to Free. Confirm the live webhook is receiving events (Stripe Dashboard → webhook deliveries show 2xx).
7. **Monitoring watch window.** For the first hour(s) post-launch, actively watch error monitoring and the Stripe webhook delivery log (§12). Treat any webhook non-2xx or 5xx spike as a launch incident.
8. **Rollback trigger (if needed).** If a launch-blocking issue appears: promote the previous build (fast), and only if data is corrupted, restore from the §11.1 snapshot. Re-reconcile Stripe `isPro` by replaying webhook events (§11.2) once the app is healthy.

> **Single owner.** One person runs this sequence end-to-end and announces "launched" only after step 7's watch window is clean. The runbook is the source of truth during release — not ad-hoc Slack messages.

---

## 18. Post-Launch Success Metrics

So launch health is measurable from minute one, not anecdotal. These are the funnel and reliability signals to watch in the first hours/days. The bar for MVP is "we can read these numbers," not "we have a dashboard" — they can be read from Stripe, the auth/DB, and the webhook log even without analytics tooling.

| Metric | Source | Why it matters | Healthy signal |
|---|---|---|---|
| **Registrations** | `User` count (or auth events) | Top of funnel — is anyone arriving? | Trending up, no error spike on `/register` |
| **Onboarding completion rate** | `% of registered users with ≥ 1 active account` (the `requireOnboarded` gate) | The §1 onboarding's whole job — are users getting past first-run? | Most registrations reach the dashboard |
| **Checkout conversion** | Stripe Dashboard (checkout sessions → completed) | Is the Pro flow actually working / converting? | Started sessions complete; no stuck "incomplete" |
| **Webhook success rate** | Stripe Dashboard → webhook deliveries | Pro grants depend on this — a failing webhook silently strands paid users on Free | ~100% 2xx; investigate any non-2xx immediately |
| **Error rate** | Error monitoring (§12.1) | Catch-all for runtime breakage | Flat, no 5xx spike |
| **Export usage** | Export route hits (logs) | Trust feature — confirms the data-portability promise is exercised | Any successful exports; no 413/500 |

- [ ] Confirm each metric above is **readable** post-launch (you know where to look), even if not yet dashboarded.
- [ ] Define a single "launch is healthy" glance: registrations > 0, onboarding completion reasonable, checkout conversion non-zero (once anyone tries), webhook success ~100%, error rate flat.
- [ ] Anything beyond reading these (funnels, cohorts, product analytics) is an explicit post-launch fast-follow.

---

## 19. Change Freeze

Once §9 is signed off, the branch is **frozen** until launch. The purpose of the freeze is to keep the audited artifact and the shipped artifact identical — every merge after sign-off invalidates part of the audit.

- [ ] **No feature merges** after §9 sign-off.
- [ ] **No dependency upgrades** after the §15 audit (an upgrade re-opens the dependency/security and build-pass checks).
- [ ] **Only launch-blocking fixes** may merge during the freeze — and each one re-triggers the relevant checks: the touched action's tests, `npm run build`, `npm run lint`, and a re-run of any §-check the change affects (e.g. a security fix re-runs §1; a Stripe fix re-runs §2.4).
- [ ] Each freeze-period fix is classified per the Risk Classification table — only **Launch Blocker** (and owner-approved **High**) issues justify breaking the freeze.
- [ ] The freeze lifts at launch (§17 step 7 clean); normal feature work resumes after.

> If a change feels worth breaking the freeze for but isn't a Launch Blocker, it's a post-launch item. The freeze exists precisely to resist "while we're here…" scope creep at the riskiest moment.

---

## Definition of Done

§9 is complete when all of the following are true:

- [ ] `/security-review` run; all HIGH and CRITICAL findings resolved.
- [ ] Row-level ownership manually spot-checked on at least: goal contributions, recurring draft confirm, category delete.
- [ ] No financial data found in URL parameters across all routes.
- [ ] Stripe webhook signature check confirmed working (Stripe CLI test in test mode).
- [ ] `isPro = false` user cannot access 12-month Reports via URL manipulation — query clamps to 3m.
- [ ] `isPro = true` user can access 12-month Reports end-to-end via Stripe Checkout (test mode).
- [ ] Stripe acceptance (§2.4) passed: checkout (monthly + annual), portal, cancellation → Free, webhook recovery (out-of-order, bad sig, retry, idempotent), cancel-on-delete.
- [ ] Every page verified at 375px, 768px, 1440px — no horizontal overflow, drawers behave correctly.
- [ ] Cross-browser golden path passed in Chrome, Safari (incl. iOS), Firefox, Edge.
- [ ] All empty states in §4 table verified against real (non-seeded) data.
- [ ] Accessibility (§8): keyboard nav, focus trapping/return on all drawers and dialogs, AA contrast, ARIA labels, and one full screen-reader golden-path pass complete.
- [ ] Performance smoke (§9): no oversized client bundles, no hydration warnings, no leaked server-only/Prisma code in client bundles.
- [ ] `npm run test:run` exits 0.
- [ ] `npm run build` exits 0.
- [ ] `npm run lint` exits 0.
- [ ] `npx prisma migrate status` shows all migrations applied on the development branch.
- [ ] Production migration plan documented and reviewed; pre-launch DB snapshot/branch taken (§11.1).
- [ ] Rollback paths verified: DB restore, Stripe webhook replay, atomic deploy rollback (§11).
- [ ] Observability (§12): error monitoring wired (or documented risk), log hygiene confirmed (no PII/secrets), launch-window alerting/uptime plan in place.
- [ ] Production environment validated (§13): Google OAuth prod callback, Stripe live keys + webhook + portal, HTTPS, verified email sender — all confirmed against production config, not dev.
- [ ] Data integrity smoke (§14): derived balances, budget spend, `Goal.currentAmount`, recurring confirm atomicity, and export ↔ app consistency all verified on a fresh account.
- [ ] Dependency audit (§15): `npm audit` high/critical resolved or risk-accepted; no secrets committed; lockfile committed.
- [ ] Support readiness (§16): privacy policy + ToS published and support/billing contact reachable — or documented as a fast-follow for a soft launch.
- [ ] Launch-day runbook (§17) reviewed and assigned a single owner.
- [ ] All audit findings triaged per the Risk Classification table; every **Launch Blocker** resolved (no exceptions); every **High** fixed or owner-approved as a dated fast-follow.
- [ ] Session/storage persistence (§1.11): logout/login, refresh, expired session, and multi-tab behavior verified; no financial data in client storage.
- [ ] Disaster recovery drill (§11.4): an actual restore onto a staging branch performed, app booted against it, and RTO recorded.
- [ ] Destructive-action audit trail (§12.4): each hard-delete action confirmed to emit a structured log entry to the observability sink.
- [ ] Email deliverability (§13.5): SPF/DKIM/DMARC passing on the production sender; real verification + reset emails confirmed inbox-delivered.
- [ ] Post-launch metrics (§18) confirmed readable (registrations, onboarding completion, checkout conversion, webhook success rate, error rate).
- [ ] Change freeze (§19) declared in effect — no feature merges or dependency upgrades past sign-off except triaged Launch Blockers.
- [ ] `.env.example` complete.
- [ ] `error.tsx` and `not-found.tsx` exist with styled output.

---

## What This Slice Does NOT Include

- New features of any kind.
- New Vitest tests for React components (out of scope per `coding-standards.md`).
- Performance optimizations (post-MVP per `project-overview.md`).
- Notification system (post-MVP).
- Mobile-native app work (post-MVP).
- Stripe Dashboard setup (register product, create prices, activate Customer Portal, register webhook URL) — these are operator tasks, not code tasks. They are the remaining launch-day steps from `feature/stripe-billing`.
