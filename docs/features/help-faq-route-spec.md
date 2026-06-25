# Help / FAQ Route — Implementation Spec

> **✅ Shipped (`feature/help-faq-route`, POST-MVP §2).** The `/help` page is live — a static,
> server-rendered FAQ wrapped in `AppShell`, retiring the dead sidebar Help link (was a hard 404).
> Content is a typed module `src/lib/help/content.ts` (`HELP_SECTIONS` — 10 sections, each carrying a
> Lucide `icon` + hex accent `color`; `HelpItem`/`HelpSection` types). Renderers in
> `src/components/help/` (`help-content.tsx` + `help-section.tsx`): per-section tinted icon squares
> (matching the dashboard `CategoryIcon`/`MetricStrip` pattern), a header icon square, stacked
> term/detail explainer lines, and a prominent green-accented **"On this page"** TOC gated on
> `HELP_SECTIONS.length >= HELP_TOC_MIN_SECTIONS` (`= 5`, in `system-constants.ts`). Guard is
> `getSessionOrRedirect` (auth-gated, **not** onboarding-gated); `/help` added to `isProtected` in
> `auth.config.ts`; sidebar Help link gained the Settings-style active highlight. **No DB, no
> mutations, no schema change** — the only fetches are the AppShell chrome (`getUserAccounts`,
> `getSidebarUser`); no `force-dynamic` (D3 — dynamic only via `auth()`). Tests:
> `test/lib/help/content.test.ts` (structural invariants — non-empty sections, unique anchor ids,
> non-empty details, icon + hex color present). 514 tests pass; build + lint clean.

> **Goal:** Stand up the `/help` page the sidebar already links to — a single, scannable,
> server-rendered FAQ that explains each entity and the non-obvious behaviours that surprise
> users (derived balances, draft-confirm recurring, no-rollover budgets, virtual goals, the
> Reports gate, EUR-only, free export). This **retires a live bug**: the sidebar Help link
> currently 404s.

This spec implements [POST-MVP-ROADMAP.md](../POST-MVP-ROADMAP.md) §2 (Delivery Sequence slot 2)
and the "▶ Next up" tracker at the top of that roadmap. It follows the page/shell patterns of the
shipped escape-hatch surfaces (`/accounts`, `/settings`) and the constants/content conventions in
[coding-standards.md](../coding-standards.md).

---

## 1. Why this slice

The sidebar renders a Help link pointing at a route that does not exist:

- [sidebar.tsx:152-159](../../src/components/dashboard/sidebar.tsx#L152) — `<Link href="/help">`
- There is **no** `src/app/help/` directory → clicking **Help** today is a hard **404**.

That is a direct violation of principle #6 (*"never UI without backing function"* — no dead nav).
This slice is the cheapest possible fix that also delivers real orientation value: a static,
read-only content page. **No DB, no mutations, no schema, no new infra.** It is the firm next slot
after §1 (Account Surfaces IA) shipped, and it has **zero external dependencies** — unlike §0
Telemetry (blocked on the analytics-sink / consent decision) and §3 AI (blocked on provider + cost
cap). It builds on conviction.

---

## 2. Scope

### In scope

- A new route `src/app/help/page.tsx` — **static, server-rendered** (no `"use client"`, no DB call,
  no Server Action). Page-title metadata `"Help"`.
- Reuse **`AppShell`** so Help opens inside the familiar chrome (sidebar + topbar), consistent with
  every other authenticated surface. Auth-guarded but **not onboarding-gated** (an escape hatch like
  `/accounts` / `/settings`).
- A typed, structured **content module** `src/lib/help/content.ts` (the FAQ data — sections + items),
  rendered by the page. Copy lives in data, not inline JSX. Alongside the per-entity explainer
  sections, include **one short "Common questions" section organized by point-of-confusion** (real
  questions a user asks — *"Why doesn't my balance match my bank?"*, *"Where did my deleted
  transaction go?"*) rather than by entity. This is the same data shape (a `HelpSection`), just framed
  as Q→A — it catches the user who doesn't yet know which entity their confusion maps to.
- Presentational help components in `src/components/help/` (section card, entity-explainer list,
  optional table-of-contents).
- Add `/help` to the protected-route matcher in `auth.config.ts`.
- **Optional polish:** give the sidebar Help link an active-state highlight (it currently has none,
  unlike Settings).

### Out of scope (explicit)

- **No DB, no Prisma, no fetcher in `src/lib/db/`.** The page reads only the static content module +
  the session (for the shell's sidebar user / topbar accounts, same as any AppShell page).
- **No mutations, no Server Actions, no forms.** Purely informational.
- **No schema change, no migration, no new entity.**
- **No search, no collapsible accordions requiring client JS** unless a TOC anchor list is chosen
  (anchors are plain links — still server-only). Keep it one scannable page, not a docs site.
- **No marketing/landing reuse.** The public `/` marketing copy in `src/lib/marketing/` is a separate
  audience; do not couple Help to it. (Help is in-app, post-auth, behaviour-focused.)
- **No support line / contact affordance in this slice.** Spendly has **no support domain or mail
  service wired up**, so there is *nothing real to point at* — and principle #6 forbids a dead or
  placeholder `mailto:`. A support line is a **future** addition gated on that infra existing; when it
  does, the address comes from config (env → `system-constants.ts`), never hardcoded. Not built here.
- **No contact-form / ticketing backend.**
- **No i18n.** English-only, consistent with the rest of the app.

---

## 3. Architectural decisions

### D1 — Reuse `AppShell`, not a bespoke shell. **(recommended, default)**

`AppShell` ([app-shell.tsx](../../src/components/layout/app-shell.tsx)) is the chrome every
authenticated page already uses; it takes `user: SidebarUser` + `accounts: AccountOption[]` and
renders the sidebar (which contains the Help link), topbar, and mobile nav. Reusing it means:

- The Help link the user clicked stays visible and consistent — no jarring context switch.
- Mobile/tablet/desktop responsiveness is inherited for free.
- The page matches `/accounts` and `/settings`… **except** `/settings` deliberately uses its **own**
  centered `max-w-lg` layout (not AppShell). Help is closer to `/accounts`: it lives **inside**
  AppShell. Follow the `/accounts` pattern exactly (see §5).

> Rejected alternative — a lighter standalone shell (logo + back link, like the auth pages). It saves
> two cheap fetches (`getSidebarUser`, `getUserAccounts`) but loses nav continuity and re-introduces a
> second chrome to maintain. Not worth it for one page. If a future "public/marketing FAQ" is wanted
> (un-authed), that is a **separate** route under the marketing layout — not this one.

### D2 — Content as a typed data module, not MD-in-component.

Per the §2 roadmap open decision and [coding-standards.md](../coding-standards.md) (*"no magic
strings in components; reusable/domain values in the constants files"*), the FAQ is a typed array in
`src/lib/help/content.ts`, mirroring how `src/lib/marketing/features.ts` holds the landing copy. This
keeps the page component a dumb renderer, makes the copy reviewable/diffable in one place, and lets a
trivial Vitest assert structural invariants (unique anchor ids, non-empty sections).

> Why a dedicated `src/lib/help/` module and **not** `constants.ts`: the FAQ is a sizable structured
> content blob, not a reused app constant. Bloating `constants.ts` with paragraphs of prose works
> against the constants-split rule's intent (small shared values). Marketing copy set the precedent by
> living in `src/lib/marketing/*`; Help follows it with `src/lib/help/content.ts`.

### D3 — Static render. No `force-dynamic`.

The page has no per-request data beyond the shell's session-derived sidebar (which AppShell handles).
The **content** is fully static, so the page itself needs no `dynamic` export driven by content. It
will still be dynamic by virtue of `auth()` in the guard — that is fine and matches the other shell
pages; do **not** add `force-dynamic` for the content's sake (there is nothing to revalidate).

---

## 4. File plan

| Layer | File | Action |
|---|---|---|
| Content | `src/lib/help/content.ts` | **create** — typed `HELP_SECTIONS` array + types |
| Constants | `src/lib/system-constants.ts` | **modify** — `HELP_TOC_MIN_SECTIONS` (~5) |
| Page | `src/app/help/page.tsx` | **create** — server component, AppShell-wrapped |
| Component | `src/components/help/help-content.tsx` | **create** — renders sections from data |
| Component | `src/components/help/help-section.tsx` | **create** — one section card (heading + items) |
| Auth | `src/auth.config.ts` | **modify** — add `/help` to `isProtected` |
| Sidebar (optional) | `src/components/dashboard/sidebar.tsx` | **modify** — Help active-state highlight |
| Tests | `test/lib/help/content.test.ts` | **create** — structural invariants |

No new route besides `/help`, no nav-item addition (the Help link already exists), no migration, no
action, no DB fetcher.

> Component granularity is a guideline — if `help-content.tsx` stays comfortably under the 50-line
> guideline rendering sections inline, `help-section.tsx` may be folded in. Split only if it earns it.

---

## 5. Page (`src/app/help/page.tsx`)

Mirror [accounts/page.tsx](../../src/app/accounts/page.tsx) — same guard, same two shell fetches,
same `AppShell` wrap. The only difference is the body renders static content instead of a data view.

```tsx
export const metadata = { title: "Help" };

import { getSessionOrRedirect } from "@/lib/auth/guards";
import { getUserAccounts } from "@/lib/db/accounts";
import { getSidebarUser } from "@/lib/db/profile";
import { AppShell } from "@/components/layout/app-shell";
import { HelpContent } from "@/components/help/help-content";

export default async function HelpPage() {
  const session = await getSessionOrRedirect();
  const userId = session.user.id;

  // Shell chrome only — the page body is fully static content.
  const [accounts, sidebarUser] = await Promise.all([
    getUserAccounts(userId),
    getSidebarUser(userId),
  ]);

  return (
    <AppShell accounts={accounts} user={sidebarUser}>
      <HelpContent />
    </AppShell>
  );
}
```

**Guard choice — `getSessionOrRedirect`, not `requireOnboarded`.** Help must be reachable by a
brand-new, zero-account user (it explains how to *start*). It is an escape hatch exactly like
`/accounts` and `/settings`, which both use `getSessionOrRedirect`. Do **not** gate it behind
onboarding — a stuck first-run user is precisely who needs Help.

> The two shell fetches (`getUserAccounts`, `getSidebarUser`) are not "Help data" — they are the
> price of reusing `AppShell` (sidebar profile row + topbar selector). They are the same lean PK/active
> lookups every shell page already runs. The page itself fetches **no** help content (it is imported,
> not queried).

---

## 6. Content module (`src/lib/help/content.ts`)

A typed array. Each **section** is one entity/topic card; each **item** is a labelled explainer line.
Anchor `id`s drive the optional in-page TOC.

```ts
export interface HelpItem {
  /** Bolded lead-in, e.g. "Derived balance". Optional for plain paragraphs. */
  term?: string;
  /** The explainer body. Keep to 1–2 sentences. */
  detail: string;
}

export interface HelpSection {
  /** Stable anchor id for the TOC + deep links (e.g. "accounts"). Unique. */
  id: string;
  /** Card heading, sentence case (e.g. "Accounts"). */
  title: string;
  /** One-line orientation under the heading. */
  intro?: string;
  items: HelpItem[];
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "getting-started",
    title: "Getting started",
    intro: "Spendly is fast manual tracking — capture each transaction in a few seconds.",
    items: [
      { detail: "Create at least one account with a starting balance, then add transactions to it." },
      { term: "The account selector", detail: "in the topbar is a global filter — it scopes the whole app to one account when active." },
    ],
  },
  {
    // Framed by point-of-confusion, not entity — the user who doesn't yet know
    // which entity their question maps to lands here first.
    id: "common-questions",
    title: "Common questions",
    items: [
      { term: "Why doesn't my balance match my bank?", detail: "Balances are derived from the transactions you've entered — Spendly doesn't sync with your bank. Add the missing transactions and it reconciles." },
      { term: "Where did my deleted transaction go?", detail: "Deletes are soft with an 8-second undo. After that it's gone from the app (no Trash view in the current version)." },
      { term: "Why is my recurring expense not in the ledger?", detail: "Recurring templates create drafts you confirm — they never write silently. Confirm the draft on the Recurring page to post it." },
      { term: "Why can't I see older Reports?", detail: "Free shows the last 3 months; Pro unlocks 12. Upgrade in Settings → Billing." },
    ],
  },
  {
    id: "accounts",
    title: "Accounts",
    items: [
      { term: "Derived balance", detail: "An account's balance is starting balance + the sum of its transactions — it is never edited directly." },
      { term: "Liability accounts", detail: "Credit cards can start negative — the starting balance is signed." },
      { term: "Archiving", detail: "Archived accounts leave the selectors and totals but keep their history; they can't receive new transactions." },
    ],
  },
  {
    id: "transactions",
    title: "Transactions",
    items: [
      { term: "Three types", detail: "Income, expense, and transfer. A transfer is one logical move shown as a single row across two accounts." },
      { term: "Undo", detail: "Deleting is a soft delete with an 8-second snackbar undo." },
    ],
  },
  {
    id: "budgets",
    title: "Budgets",
    items: [
      { term: "Monthly ceilings", detail: "One budget per category per month, with green / amber / red progress." },
      { term: "No rollover", detail: "Budgets reset each month — an unspent remainder does not carry over." },
    ],
  },
  {
    id: "recurring",
    title: "Recurring",
    items: [
      { term: "Drafts you confirm", detail: "Recurring templates generate drafts for you to confirm — never silent ledger entries. That keeps the conscious-capture moment without the typing." },
    ],
  },
  {
    id: "goals",
    title: "Goals",
    items: [
      { term: "Virtual progress", detail: "Goals track savings progress only — they don't touch account balances or budgets." },
      { term: "Contributions", detail: "Add contributions (or negative withdrawals); goals can be overfunded (\"Over 100%\")." },
      { term: "Completion is manual", detail: "Reaching the target doesn't auto-complete a goal — you mark it complete." },
    ],
  },
  {
    id: "reports",
    title: "Reports",
    items: [
      { detail: "Reports are analysis over time; the Dashboard is your current state. Free shows the last 3 months, Pro the last 12." },
    ],
  },
  {
    id: "categories",
    title: "Categories",
    items: [
      { detail: "20 system categories plus your own. Deleting a custom category sends its transactions to Uncategorized." },
    ],
  },
  {
    id: "data-privacy",
    title: "Data & privacy",
    items: [
      { term: "Export is free", detail: "Export everything to CSV or JSON on any plan, from Settings → Data & privacy." },
      { term: "Deletion", detail: "Account deletion has a 30-day grace period — you're prompted to export first." },
      { term: "Currency", detail: "Spendly is EUR-only today." },
    ],
  },
];
```

> Copy above is a **starting draft** — refine wording during build. The structure (sections + items +
> anchor ids) is the contract the component and test depend on. Every behavioural claim is drawn from
> the §2 content list in [POST-MVP-ROADMAP.md](../POST-MVP-ROADMAP.md) and reconciled against
> [project-overview.md](../project-overview.md); do not invent behaviour the app doesn't have
> (principle #6 again — Help must describe the *real* app).

---

## 7. Components (`src/components/help/`)

`HelpContent` maps `HELP_SECTIONS` to `HelpSection` cards; an optional TOC renders anchor links to
each section id. All server components (no client JS) — anchors are plain `<a href="#id">`.

**Visual rules (Design System):**
- Section cards reuse the surface pattern from `/settings`: `rounded-xl border border-line bg-surface
  p-6`, `text-[13px] font-medium text-ink` headings, `text-[12px] text-ink-2` body — so Help looks
  native, not bolted on.
- A page header row ("Help" / short subtitle) at the top, matching other pages' header rhythm.
- Each item: bold `term` (`font-medium text-ink`) + `detail` (`text-ink-2`) on one line / wrapped
  paragraph. Sentence case, no decoration beyond the subtle border (no gradients/shadows).
- **Conditional TOC.** Render the table of contents only when the page is long enough to justify the
  extra navigation — gate on section count via a constant, e.g.
  `HELP_SECTIONS.length >= HELP_TOC_MIN_SECTIONS` (start at ~5). Below the threshold a TOC is just
  noise above a short, already-scannable page; above it, it earns its place. When shown: a compact list
  of section links at the top (a sticky `lg` aside is a later upgrade, not the default). Either way each
  `<HelpSection>` gets `id={section.id}` so anchors land (pair with `scroll-smooth`, already on
  `<html>`) — the anchor ids exist regardless of whether the TOC renders, so deep links keep working.

> Keep any tone/spacing class variants in a small in-component lookup, not scattered magic strings —
> consistent with the insights-strip `TONE_CLASS` convention.

**No support line in this slice.** Spendly has no support domain or mail service today, so there is no
real address to link — and a placeholder/dead `mailto:` violates principle #6. Ship Help **without** a
contact affordance. When support infra exists later, add a single closing "Still stuck? Email …" line
whose address is read from config (env → `system-constants.ts`, e.g. `SUPPORT_EMAIL`, like
`EMAIL_FROM`) and rendered only when that value is set. Deferred, not built here.

---

## 8. Auth wiring (`src/auth.config.ts`)

Add `/help` to the protected-route set so an unauthenticated visitor is redirected to sign-in (same as
`/settings`, `/accounts`, `/onboarding`). It is **protected but not onboarding-gated** — the guard in
the page (`getSessionOrRedirect`) handles auth; onboarding is intentionally not required (§5).

```ts
// in the isProtected check, alongside the existing entries:
//   "/dashboard", "/transactions", …, "/settings", "/onboarding"
// add:
"/help"
```

> Match the existing pattern exactly (prefix vs. exact match) — read the current `isProtected`
> implementation and extend it the same way the Settings slice did; don't introduce a new matching
> style.

---

## 9. Optional polish — sidebar Help active state

Today the Help link ([sidebar.tsx:152](../../src/components/dashboard/sidebar.tsx#L152)) has **no**
active styling, unlike Settings, which highlights on `pathname === "/settings"`. With a real `/help`
page, give Help the same treatment so the user sees where they are:

```tsx
// mirror the Settings link's active pattern:
className={cn(
  "flex items-center gap-3 rounded-md px-3 py-2 transition-colors",
  pathname === "/help"
    ? "border border-line bg-surface text-ink"
    : "text-ink-2 hover:bg-surface-2 hover:text-ink"
)}
// and tint the icon green when active, like Settings:
<HelpCircle size={16} className={cn("shrink-0", pathname === "/help" && "text-success")} />
```

Low-risk markup-only change; include it in this slice (it's part of "making Help real"), but it is not
strictly required to close the bug.

---

## 10. Edge cases & rules

- **Zero-account / first-run user.** Help is reachable (not onboarding-gated). The AppShell topbar
  selector simply has no active accounts — that's fine; the content is static and account-agnostic.
- **OAuth-only vs. credentials user.** No difference — Help reads nothing user-specific beyond the
  shell's sidebar identity (handled by AppShell, same as every page).
- **Mobile.** Inherited from AppShell (sidebar overlay + bottom nav). Cards stack; the TOC, if used,
  collapses to a simple top list — keep it one scannable column.
- **No `Decimal`, no currency formatting, no dates** cross any boundary here — the page renders only
  static strings. `formatCurrency` is not imported.
- **Anchor ids must be unique** (TOC correctness) — asserted by the test (§11).
- **Accessibility:** each section card is a `<section aria-labelledby>` with a real heading (matching
  `/settings`); the TOC is a `<nav aria-label="On this page">`. Sentence case throughout.

---

## 11. Testing (`test/lib/help/content.test.ts`, Vitest)

Components are out of test scope per [coding-standards.md](../coding-standards.md); the page has no
action/fetcher. The only logic surface is the content module's structural invariants — cheap, high
value (they guard the TOC contract and catch copy-edit mistakes):

- `HELP_SECTIONS` is non-empty.
- Every section `id` is unique (no duplicate/clashing anchors).
- Every section has a non-empty `title` and at least one `item`.
- Every item has a non-empty `detail`.
- (If a TOC is built from the same array) the set of section ids the TOC links === the set of section
  ids rendered — assert against `HELP_SECTIONS` so they can't drift.

Run `npm run test:run` and `npm run build` before commit (per
[ai-interaction.md](../ai-interaction.md) workflow).

> If §6 ends up with **no** extractable logic (pure inline data with no derivation), these structural
> tests still apply to the exported `HELP_SECTIONS` constant — that's the unit. Don't skip them; they
> are the guardrail that keeps the anchor/TOC contract honest.

---

## 12. Implementation order

1. `src/lib/help/content.ts` — types + `HELP_SECTIONS` draft, and `test/lib/help/content.test.ts`
   (TDD-friendly; no deps).
2. `src/components/help/help-section.tsx` + `help-content.tsx` (dumb renderers over the data).
3. `src/app/help/page.tsx` — AppShell-wrapped, `getSessionOrRedirect` + the two shell fetches.
4. `src/auth.config.ts` — add `/help` to `isProtected`.
5. Sidebar Help active-state polish (optional, §9).
6. `npm run test:run` + `npm run build`; manual browser pass:
   - signed-in: click **Help** in the sidebar → page renders (no 404), Help highlights (if §9 done);
   - all sections present, TOC anchors jump correctly, copy reads cleanly;
   - mobile width (375px): cards stack, nav works, content scannable;
   - signed-out: visiting `/help` redirects to sign-in;
   - zero-account user: `/help` still renders (not bounced to onboarding).

---

## 13. Maintenance contract — keep Help in sync with the app

Help is only valuable while it's accurate; stale Help is worse than none. To stop it silently rotting:

- **Every user-facing feature slice must evaluate whether `src/lib/help/content.ts` needs an update**
  as part of its definition of done — the same way the workflow already requires Vitest + build to
  pass. If a slice changes a behaviour a Help section describes (e.g. budget rollover lands in §7 and
  flips the "no rollover" line; a Trash UI lands and changes "where did my deleted transaction go?"),
  updating the relevant section is part of that slice, not a follow-up.
- **Make it a checklist item, not a hope.** Add a one-line "Help content reviewed (update
  `help/content.ts` or note N/A)" bullet to the feature workflow so it's an explicit, auditable step.
  Centralizing the copy in one typed module (D2) is what makes this a cheap, single-file edit.
- **Roadmap cross-references.** The POST-MVP items that will most obviously invalidate Help copy are
  **Budget Rollover (§7)** ("no rollover" line), **Trash UI (§8)** (the deleted-transaction answer),
  and **Multi-Currency (§11)** (the "EUR-only" line). Each of those specs should call out the Help edit
  it owes. (This spec notes it here so the dependency is recorded from both directions.)

---

## 14. Decisions

### Resolved (baked into this spec)

- **Reuse `AppShell`** (D1) — nav continuity + responsiveness for free; follow the `/accounts` page
  pattern, not the bespoke `/settings` centered layout.
- **Content as a typed module** `src/lib/help/content.ts` (D2) — not MD-in-component, not `constants.ts`;
  mirrors `src/lib/marketing/*`.
- **Static, no `force-dynamic`** (D3) — nothing to revalidate; the content is import-time data.
- **Auth-guarded but NOT onboarding-gated** (§5) — escape hatch like `/accounts`/`/settings`; a
  first-run user must reach Help. Add `/help` to `isProtected`.
- **No DB fetcher, no mutation, no schema** — read-only informational page; the only fetches are the
  AppShell chrome (`getUserAccounts`, `getSidebarUser`).
- **Sidebar Help active-state highlight included** as part of "making Help real" (§9), optional but
  recommended in-slice.
- **Content is the §2 list, reconciled against `project-overview.md`** — describe only real behaviour.
- **A point-of-confusion "Common questions" section** sits alongside the entity sections (§2, §6) —
  catches the user who doesn't know which entity their question maps to.
- **TOC is conditional** on section count (`HELP_SECTIONS.length >= HELP_TOC_MIN_SECTIONS`, §7) — it
  renders only once the page is long enough to need it; anchor ids always exist regardless.
- **No support line in this slice** (§2, §7) — no support domain/mail service exists, so no
  contact affordance ships. Deferred until that infra lands; the address would then come from config,
  never hardcoded.
- **Maintenance contract** (§13) — feature slices must evaluate Help-content updates as part of done.

### Open (decide during build — low-stakes)

- **TOC presentation when shown:** simple top list (default) vs. sticky `lg` aside — and the exact
  `HELP_TOC_MIN_SECTIONS` threshold (~5). Tune against the final section count.
- **Component granularity:** keep `help-section.tsx` separate or fold into `help-content.tsx` per the
  50-line guideline (§4).
- **"Tips" / data-privacy extras:** the roadmap suggests optional "Tips" (5-second capture, the account
  selector as global filter) and a privacy note (soft-delete, 30-day grace). Folded into the
  `getting-started` and `data-privacy` sections above; expand only if it stays one scannable page.
