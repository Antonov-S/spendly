# Settings Page — Implementation Spec

> **✅ Shipped (`feature/settings-page`).** Implemented per this spec, with two resolved corrections:
> (1) `getUserOverview` lives in the existing `src/lib/db/profile.ts` (alongside `getProfileStats`),
> **not** a new `src/lib/db/user.ts` as decision #5 stated — `/profile` was migrated onto it. (2) The
> "reuse an existing lightweight accounts fetcher" in §4 had no such fetcher to reuse (`getUserAccounts`
> is active-only `{id,name}`), so a new `getAccountLabels` (active + archived, `{id,name,isArchived}`)
> was added to `src/lib/db/accounts.ts` for scope-label resolution. The display-name form ships with an
> **auto-dismissing** success banner (`useActionState` + a hide-only timeout + an `at` nonce for repeat
> saves) so the message clears itself; a `w-full` was added to the `/settings` and `/profile` columns so
> the flex-column body doesn't collapse them below `max-w-lg`. Billing ships the plan read-out only
> (Upgrade/Manage buttons deferred to §8). See `docs/ROADMAP.md` §7. 429 Vitest tests + `npm run build`
> pass; no schema change.

> **Goal:** Ship the `/settings` route — the user-preferences and billing surface that
> [project-overview.md](../../docs/project-overview.md) → Routes lists and
> [ROADMAP.md](../ROADMAP.md) §7 (Delivery Sequence slot **#6**) calls for. It introduces the first
> profile-mutation Server Action (`updateProfile` for the display name) and stands up the **billing
> surface that the Stripe slice (§8) will wire into** — without shipping any dead, backing-function-less
> UI in the meantime.

This spec follows [entity-crud-architecture.md](../entity-crud-architecture.md) and mirrors the
already-shipped slices. It is a **small** slice: one page, one new action, one validation schema, one
nav entry, and a deliberate decision about where Data Export lives (§7).

**How to read this spec (layering).** Ordered **contract → model → implementation → tests**:

| Layer | Section | What it is |
|---|---|---|
| **Contract** | §1 | Every binding rule, stated once. The single source of truth. |
| **Model** | §3 | The data the page reads + the `updateProfile` mutation. |
| **Implementation** | §4 (page), §5 (preferences), §6 (billing), §7 (export decision), §8 (nav) | Surface specifics that reference §1, never restate them. |
| **Process** | §9 (tests), §10 (decisions), §11 (acceptance), §12 (files) | Test plan, resolved questions, done criteria, change surface. |
| **Forward** | §13 | Pointer to the separate [account-settings-ia.md](../account-settings-ia.md) note — guidance, not this slice's work. |

If a later section appears to contradict §1, **§1 wins** — the prose elsewhere is rationale.

---

## 1. The contract (single source of truth)

Each rule is tagged **MUST/SHOULD/MAY** (RFC-2119) and **`[inv]`** (hard invariant — correctness/
security; a change is a bug) or **`[prod]`** (a product reading that may evolve).

### 1.1 Security & access — MUST (all `[inv]`)

- **S1** `/settings` is a protected page: it calls `getSessionOrRedirect()` and renders only for an
  authenticated user. It is **not** an onboarding-gated data surface — like `/profile` and
  `/accounts`, it stays reachable for a zero-account user (escape hatch; see §4).
- **S2** `updateProfile` reads the target `userId` from the **session only**, never from the client.
  It is `auth()`-guarded and returns an error result (no throw) when unauthenticated.
- **S3** `updateProfile` writes **only** the `name` column of the **session user's own** row. It must
  not accept or write `email`, `isPro`, `preferredCurrency`, `stripe*`, or any other field.
- **S4** Every value rendered in the Billing section (plan, subscription state) is read from the
  **database** (`User.isPro` / `stripe*`), never from the session JWT (the session carries only
  `user.id`). Mirrors the Reports `getReportProfile` precedent.

### 1.2 Product surface — MUST/SHOULD

- **P1** `[prod]` MUST The page has exactly **three** sections in this slice: **Preferences**
  (display-name edit, §5), **Billing** (plan state, §6), and **Your data** (the relocated export
  links, §7). No currency picker — the app is EUR-only and `preferredCurrency` is dormant (shown
  read-only at most; see §5). *(Preferences + Billing are the net-new sections; "Your data" is the
  export entry point moving in from `/accounts`, not net-new functionality.)*
- **P2** `[inv]` MUST **No UI without backing function** (product principle #6). The Billing section
  ships **only the plan-state display now**; the "Upgrade to Pro" / "Manage subscription" buttons are
  **not** rendered until the Stripe slice (§8) gives them a working action. No disabled placeholder
  button, no "coming soon" hint. §6 defines the exact now-vs-§8 split.
- **P3** `[prod]` SHOULD The page reuses the existing `/profile` visual language (`max-w-lg`, card =
  `rounded-xl border border-line bg-surface p-6`, section heading `text-[13px] font-medium`,
  `ProfileRow` pattern) so Settings and Profile read as siblings, not two design dialects.
- **P4** `[prod]` MUST A **Settings** entry is added to the sidebar bottom utility group, between
  **Accounts** and **Help** (ROADMAP §7). It is the only new nav surface.

### 1.3 Behavior — MUST

- **B1** `[inv]` `updateProfile` returns the `{ success, error? }` shape consumed by a client form's
  `useActionState` hook (mirrors `changePassword`), validates input with Zod `safeParse`, trims the
  name, and calls `revalidatePath("/settings")` + `revalidatePath("/profile")` on success (both
  surfaces render the name; the sidebar profile row re-renders on navigation).
- **B2** `[prod]` An empty/whitespace-only name is **rejected** (the schema requires ≥1 non-space
  char). `name` stays a required-when-present display string; we do not let a user blank it to fall
  back to "Account".
- **B3** `[prod]` **Display names are NOT unique.** `name` is a presentation label, not an identifier
  — `email` is the sole unique key. Two users (or the same user over time) may hold identical names.
  **No** DB unique constraint, **no** server-side uniqueness check, **no** "name taken" error. (§5.)
- **B4** `[inv]` **Concurrency = last-write-wins on the user's own single row.** `name` is a single
  scalar on a row only its owner can write (S2/S3), so there is no lost-update hazard worth a version
  column — the *latest* submit is the correct value by definition. **No** optimistic-concurrency token,
  **no** `updatedAt` precondition. Double-submit is prevented at the **UI** layer only: the form's
  `SubmitButton` is disabled while the `useActionState` transition is pending (the existing
  `ChangePasswordForm` pattern). The server stays idempotent — re-applying the same name is a no-op
  write. **No optimistic UI**: the field reflects server-confirmed state after revalidation, never a
  pre-confirmation guess. (§5.)

---

## 2. Why this slice

`/settings` is the last unbuilt page in the Routes table. Today `/profile` covers **identity, security,
and the danger zone** (avatar, plan/currency/member-since read-out, usage stats, change-password,
delete-account, sign-out). What's missing is a **configuration** surface: a place to *edit* the
display name, and — more importantly — the **host for Stripe billing** (§8). §8 has a hard dependency
on this page existing ("wire after Settings exists", Delivery Sequence). So this slice is mostly about
**standing up the surface and its nav entry** with one genuinely-functional control (name edit) and a
real plan read-out, leaving a clean seam for §8 to fill in the upgrade/manage actions.

---

## 3. Model

### 3.1 Read — shared user projection (drift guard)

`/profile` and `/settings` read overlapping `User` columns (`name`, `email`, `isPro`,
`preferredCurrency`, plus billing/`stripe*`). Today `/profile` inlines its `findUnique`. Rather than
add a **second** inline projection on `/settings` — which would let the two surfaces silently disagree
about what "the user" is (a Free badge here, a stale name there) — **extract the read into one shared
helper** and have both pages consume it.

New fetcher `src/lib/db/user.ts`:

```ts
import "server-only";
import { prisma } from "@/lib/prisma";

/** Columns both /profile and /settings render. One projection, no drift. */
export async function getUserOverview(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      image: true,             // /profile avatar
      password: true,          // PROFILE-ONLY: gates the change-password card (null ⇒ OAuth user, no card). Settings never reads this.
      isPro: true,             // Billing plan badge (DB read, S4)
      stripeSubscriptionId: true, // Billing: "subscription active" affordance (§8)
      preferredCurrency: true, // /profile read-only row; /settings omits it (§5)
      createdAt: true,         // /profile "member since"
    },
  });
}
```

- `/settings` calls `getUserOverview(session.user.id)` and uses the `name`/`email`/`isPro`/
  `stripeSubscriptionId` fields; it simply ignores the columns it doesn't render.
- `/profile` is **migrated** to the same helper (replacing its inline `findUnique`), so there is
  exactly one definition of the projection. `getProfileStats` (the per-entity counts) is unrelated and
  stays where it is.
- Both pages keep their own `if (!user) redirect("/sign-in")` guard at the call site.

> **Why a fetcher and not just a shared `select` object?** A bare exported `select` constant would
> stop the *column list* from drifting but still scatter the `findUnique` call. A single async fetcher
> co-locates the query + projection in one server-only place — the established `src/lib/db/*` pattern —
> and gives §8 one spot to enrich Stripe state without re-touching either page. (This refines the
> earlier "inline like /profile" stance: one consumer justified inline; **two** consumers justify the
> shared helper.)

> **Note — `password` is a Profile-only column riding along.** The projection is a deliberate
> *superset*: `password` and `image`/`createdAt` exist purely for `/profile`'s avatar, member-since,
> and change-password gating — **Settings reads none of them**. This is a small, accepted coupling
> (one projection feeding two pages always carries the union of their needs). It is **not** a license
> for Settings to start branching on `password`; if the two pages' column needs ever diverge sharply,
> split into `getUserOverview` (shared core) + page-specific selectors rather than widening this one.

> **Projection growth guard.** `getUserOverview` is a *union of two pages' needs*, not a general-purpose
> user query. Add a column **only** when `/profile` or `/settings` actually renders it, and annotate it
> with which page (as the `select` comments already do). Do **not** let it become a catch-all "fetch the
> user" helper that other call sites reach for — a third consumer with different needs is a signal to
> split, not to widen. Keeping the projection minimal is what makes the drift guard cheap.

### 3.2 Write — `updateProfile` (new)

New action in [src/actions/profile.ts](../../src/actions/profile.ts), alongside `changePassword` and
`deleteAccount` (same file, same `"use server"` module, same result-shape conventions):

```ts
export interface UpdateProfileState {
  success?: boolean;
  error?: string;
}

export async function updateProfile(
  _prevState: UpdateProfileState,
  formData: FormData
): Promise<UpdateProfileState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You must be signed in to update your profile." };
  }

  const parsed = updateProfileSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid name." };
  }

  await prisma.user.update({
    where: { id: session.user.id },     // session-derived, S2
    data: { name: parsed.data.name },   // name only, S3
  });

  revalidatePath("/settings");
  revalidatePath("/profile");
  return { success: true };
}
```

### 3.3 Validation — `updateProfileSchema` (new)

New file `src/lib/validations/profile.ts` (no profile schema exists yet — auth schemas live in
`validations/auth.ts` but this is a profile mutation, not an auth flow):

```ts
import { z } from "zod";
import { PROFILE_NAME_MAX } from "@/lib/system-constants";

export const updateProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name cannot be empty.")
    .max(PROFILE_NAME_MAX, `Name must be ${PROFILE_NAME_MAX} characters or fewer.`),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
```

Add `PROFILE_NAME_MAX = 80` to `src/lib/system-constants.ts` (no magic numbers in schemas — coding
standards). 80 matches the goal-name ceiling already used elsewhere.

---

## 4. Page — `src/app/settings/page.tsx`

- `export const dynamic = "force-dynamic";` (reads live `User` row; same as `/profile`).
- `getSessionOrRedirect()` → `getUserOverview()` (§3.1) → `redirect("/sign-in")` if missing.
- **Reads `searchParams`** to recover the active `?account=` scope (a `Promise` in Next 16 — `await`
  it) and passes that `accountId` to both `<ExportLinks>` and the scope label (§7). This is the only
  reason the page is param-aware; nothing else on the page is scoped.
- **Loads the user's account list** — `(id, name, isArchived)` for active **and** archived accounts —
  to resolve `?account=` → a display name and to apply the §7 invalid-scope normalization (an id that
  matches no owned account is dropped). Reuse an existing lightweight accounts fetcher in
  `src/lib/db/accounts.ts` (a name/id/isArchived projection — not the balance-bearing
  `getAccountsWithBalances`, which this page doesn't need). This is the page's one extra read beyond
  `getUserOverview`, and it exists **solely** for scope-label resolution (§7).
- **Not** behind `requireOnboarded()` — Settings is an escape hatch like `/profile`/`/accounts`
  (S1). Do **not** add `/settings` to the onboarding redirect set in the guards.
- `/settings` **is** added to `auth.config.ts` `isProtected` (it's a signed-in-only page), exactly as
  `/profile` and `/onboarding` are.
- Layout mirrors `/profile`: a centered `max-w-lg` column with a "Back to dashboard" link, then the
  **Preferences** card (§5), the **Billing** card (§6), and the **Your data** card (§7).

> **Render shell question — settled.** `/profile` renders as its **own centered surface** (no
> `AppShell` sidebar/topbar). `/settings` follows the same pattern for visual consistency and because
> a zero-account user must reach it without the data-surface chrome. The sidebar **Settings** nav link
> (§8) deep-links into this standalone page — consistent with how the bottom-group **Accounts** and
> the **Profile** menu item already leave the app shell.

---

## 5. Preferences section

A single card titled **Preferences** containing the display-name editor.

- A client form (`SettingsNameForm`, `src/components/settings/settings-name-form.tsx`) using
  `useActionState(updateProfile, {})` — same shape as `ChangePasswordForm`.
- One `InputFormField` (`name`, prefilled with `user.name ?? ""`), a `SubmitButton`, and inline
  success/error text driven by the action result.
- Account identity context (email) may be shown read-only above the field for orientation; the email
  itself is **not editable** here (changing a login email is an auth-flow concern, out of scope).

> **Currency is not shown as an editable control.** EUR-only MVP: `preferredCurrency` is dormant
> (`docs/features/onboarding-currency-spec.md`). It is already displayed read-only on `/profile`;
> duplicating it here adds nothing. **Decision: omit currency from Settings entirely** until the
> multi-currency upgrade introduces a real picker. (P1.)

---

## 6. Billing section

A single card titled **Billing**. This is the surface the **Stripe slice (§8)** plugs into. Per P2,
build **only what has backing function in this slice**:

### 6.1 Ships now (this slice)

- **Plan badge** — Free / Pro pill, read from `User.isPro` (DB, S4). Reuse the exact `PlanBadge`
  component already defined inline in `/profile` — **extract it** to
  `src/components/settings/plan-badge.tsx` (or `components/billing/`) and import it from both pages so
  the two never diverge. (Small, justified extraction; not gold-plating.)
- **A one-line plan summary** — e.g. "You're on the Free plan." / "You're on Pro." Real text from real
  state. For Pro, if `stripeSubscriptionId` is present, "Pro · subscription active."

### 6.2 Deferred to §8 (do NOT render now)

- **"Upgrade to Pro"** button → `createCheckoutSession` (Stripe Checkout) — has no action yet.
- **"Manage subscription"** button → `createPortalSession` (Stripe Customer Portal) — has no action yet.

Rendering either now would be a dead button — a direct violation of principle #6 ("Never UI without
backing function. No … 'coming soon' hints."). §8's acceptance criteria include adding these two
buttons into this exact card. Leave a single short HTML comment marking the insertion point so §8 has
an obvious seam; ship no visible placeholder.

> **Why stand up the section at all if the buttons wait for §8?** Because the **plan state read-out is
> itself a real, functional surface** (it tells a user which plan they're on and is the canonical
> billing home), and because §8 is explicitly sequenced to "wire after Settings exists." Shipping the
> card now with genuine content — not a stub — is the point of slot #6.

---

## 7. Should Data Export move here? — design decision

**The question (from the build request):** Data Export already shipped as `<ExportLinks>` on
`/accounts` (`feature/data-export`). Should it move into `/settings`?

**Decision: Yes — surface export in `/settings` under a "Your data" section, and retire the
`/accounts` entry point so there is a single canonical home.** Rationale and caveats:

**Why it's a good move:**

1. **Convention & discoverability.** "Export my data" is something users instinctively look for in
   *Settings*, next to account-level/data-ownership controls — not on a financial-account CRUD page.
   It clusters naturally with delete-account ("export before you delete", which the spec's account-
   deletion flow already calls for).
2. **The component was built for this.** `<ExportLinks>` is deliberately **host-agnostic** — it takes
   only `accountId` and its own doc-comment says "so it can move to `/settings` later with no route
   change." Moving it is the use it was designed for; zero refactor.
3. **`/accounts` stays focused.** That page is about creating/editing/archiving financial accounts.
   Export is a different concern (data portability), and removing it keeps the page's job singular.
4. **The account scope still works everywhere.** Export is scoped by the global `?account=` selector,
   which lives in the topbar and persists across **all** pages. So `/settings` has the same scope
   context `/accounts` did — functionality is identical.

**The one real caveat (and its fix):** on `/accounts` the `?account=` scope is *visually obvious* (the
user is literally looking at the account list and the topbar filter). On `/settings` that scope is
less legible. **Mitigation:** the "Your data" section MUST render the **active scope as a label** next
to the buttons — e.g. "Exporting: All accounts" or "Exporting: Checking" — so the user knows exactly
what the download will contain. This reads the same `?account=` param `<ExportLinks>` already consumes.

**Scope-label reactivity — settled.** The label is **derived server-side from the `?account=`
searchParam, not from client state.** Changing the topbar account selector *is* a navigation (it
rewrites the URL's `?account=`), which re-renders this `force-dynamic` server page — so the label and
the export links **update together, in lockstep with the filter, with no manual reload and no client
JS**. There is deliberately **no** client subscription to the selector: a stale label that disagrees
with the actual download URL would be worse than none, and tying both to the single server-read param
makes that disagreement impossible. (If the selector ever became a purely client-side control that
*didn't* touch the URL, this guarantee would break — but it doesn't; the selector is URL-driven across
the whole app, which is exactly why export scoping works everywhere.)

**Scope-label fallback — invalid/unknown `?account=` (settled).** The page already loads the user's
own account list to map `?account=` → a display name. Resolve the label against **that** list:

| `?account=` value | Label | Scope forwarded to `<ExportLinks>` |
|---|---|---|
| absent | "Exporting: All accounts" | none (all accounts) |
| resolves to an owned account | "Exporting: \<name\>" (suffix " (archived)" if archived) | that id |
| present but **does not resolve** to any owned account (stale bookmark, deleted account, tampering) | "Exporting: All accounts" | **none** — the id is dropped |

The key rule: **an unresolvable id is normalized away — the page forwards no `?account=` to the export
links and labels it "All accounts."** This keeps the label and the actual download in agreement and
avoids a silently-empty file. (Left raw, an unknown id would hit the export route's ownership-safe
empty path — data-export-spec **C1** — producing a header-only/empty download with no explanation; the
Settings entry point pre-empts that by sanitizing the scope.) This is the same "unknown id ⇒ fall back
to all" resolution the topbar selector itself uses, so the two never disagree.

> **Label strings are illustrative copy (`[prod]`), not a contract.** "Exporting: All accounts",
> "Exporting: \<name\>", and the " (archived)" suffix are *example wording* — the binding rules are the
> three **behaviors** in the table above (none/owned/unresolvable → which scope is forwarded), not the
> exact glyphs. Reword the copy freely (match it to the topbar selector's own phrasing for archived
> accounts) without treating it as a spec change. The one behavior that *is* binding: an archived but
> *resolvable* account must be **visibly distinguished** from an active one (so a user doesn't think
> they're exporting a live account) — whether that's "(archived)", a badge, or a muted style is a copy/
> design call.

**Scope of this slice:** moving export is **in scope** here because it's cheap (relocate one
host-agnostic component + add the scope label + delete the `/accounts` usage) and it's the natural
moment — we're building the page that should host it. If schedule pressure appears, the *fallback* is
to leave `<ExportLinks>` on `/accounts` and skip the move; the export feature itself is unaffected
either way. **Recommended: do the move.**

> **Note for the broader IA (not this slice):** the cleanest long-term grouping co-locates *all*
> data-ownership controls — export **and** account deletion (currently on `/profile`) — under one
> "Your data / Danger zone" area. That's a `/profile` ↔ `/settings` reorganization beyond this slice's
> remit; flagged here, not actioned. This slice only moves **export** into Settings.

---

## 8. Navigation entry point

Add a **Settings** link to the sidebar bottom utility group in
[src/components/dashboard/sidebar.tsx](../../src/components/dashboard/sidebar.tsx), positioned
**between the Accounts link and the Help link** (ROADMAP §7), styled identically to the existing
`Accounts` bottom-group link (same active/hover treatment, `Settings` Lucide icon, green icon when
active on `/settings`). Optionally also add a "Settings" item to the `UserMenu` drop-up alongside
"Profile"/"Accounts" — **decision: add it to the sidebar group only** (P4); the drop-up already routes
identity (Profile) and the menu shouldn't grow unbounded. Keep the change minimal.

No topbar change. No mobile-bottom-nav change (Settings is a utility surface, not daily-use).

---

## 9. Tests

Per coding standards, test `src/actions/**` and `src/lib/**` only (no component tests).

**`test/actions/profile.test.ts`** (extend the existing file or create if absent) — `updateProfile`:

- Unauthenticated (`auth()` → null) → `{ error }`, **no** `prisma.user.update` call.
- Valid name → `prisma.user.update` called with `where.id === session.user.id` and `data` containing
  **only** `name` (assert no `email`/`isPro`/`preferredCurrency` keys) → `{ success: true }`; both
  `revalidatePath` calls fire.
- Name is trimmed before write (`"  Ann  "` → `"Ann"`).
- Empty / whitespace-only name → `{ error }`, **no** update (B2).
- Over-length name (> `PROFILE_NAME_MAX`) → `{ error }`, no update.

**`test/lib/validations/profile.test.ts`** (new) — `updateProfileSchema`:

- Trims; rejects empty/whitespace; rejects > max; accepts a normal name.

**`test/lib/db/user.test.ts`** (new) — `getUserOverview` **projection-shape** test:

- A deliberate, *narrow* exception to the "skip trivial pass-throughs" rule (coding standards): the
  projection is a **drift-prevention contract**, so pin its shape. Mock `prisma.user.findUnique`, call
  `getUserOverview("u1")`, and assert the `select` passed to Prisma contains **exactly** the agreed
  columns (`name`, `email`, `image`, `password`, `isPro`, `stripeSubscriptionId`, `preferredCurrency`,
  `createdAt`) and is scoped by `where.id === "u1"`. This catches an accidental column drop/add in a
  future refactor — the whole point of centralizing the read. Keep it to this one assertion; don't test
  Prisma itself.

Mock `@/lib/prisma`, `@/auth`, and `next/cache` (`revalidatePath`) at the module boundary, as the
existing action tests do. Run `npm run test:run` + `npm run build` — both must pass before commit.

---

## 10. Resolved decisions

| # | Question | Decision |
|---|---|---|
| 1 | Render with `AppShell` or standalone? | **Standalone centered surface**, matching `/profile` (§4). |
| 2 | Onboarding-gate `/settings`? | **No** — escape hatch like `/profile`/`/accounts` (S1). Added to `auth.config.ts` `isProtected` only. |
| 3 | Currency picker in Preferences? | **No** — EUR-only, `preferredCurrency` dormant (§5). |
| 4 | Ship Upgrade/Manage buttons now? | **No** — no backing action until §8; dead UI violates principle #6 (P2, §6.2). |
| 5 | Shared user projection? | **Yes — extract `getUserOverview` to `src/lib/db/user.ts`** and migrate `/profile` onto it too. Two consumers justify one fetcher; prevents drift (§3.1). *(Refines an earlier "inline like /profile" note.)* |
| 6 | Move Data Export here? | **Yes** — relocate `<ExportLinks>` to a "Your data" section, add an active-scope label, retire the `/accounts` usage (§7). |
| 7 | Nav entry location? | **Sidebar bottom group, between Accounts and Help**; not added to the user-menu drop-up (§8). |
| 8 | Name validation home? | New `src/lib/validations/profile.ts` (profile mutation, not an auth flow); `PROFILE_NAME_MAX = 80` in `system-constants.ts` (§3.3). |
| 9 | Display-name uniqueness? | **Not unique** — names are labels, not identifiers; no constraint, no check (B3, §5). |
| 10 | Concurrency / optimistic UI? | **Last-write-wins**, no version token; double-submit blocked at UI only; **no** optimistic UI (B4). |
| 11 | Export scope-label reactivity? | **Server-derived from `?account=`** — updates in lockstep with the topbar selector (a URL navigation); no client state, no reload (§7). |
| 12 | Unknown/invalid `?account=`? | **Normalize away** — drop the id, forward no scope, label "All accounts" (avoids a silently-empty export; §7 table). |

---

## 11. Acceptance criteria

- `/settings` renders for a signed-in user (incl. zero-account users) and redirects anonymous users to
  sign-in.
- **Preferences:** editing the display name persists via `updateProfile`, shows success, and the new
  name appears on `/profile` and in the sidebar profile row after navigation.
- `updateProfile` writes only `name` for the session user; ownership and field-scoping enforced.
- **Billing:** the correct Free/Pro badge + plan summary render from the DB. **No** Upgrade/Manage
  button is present yet (it arrives with §8).
- **Data export** is reachable from `/settings` ("Your data" section) with a visible active-scope
  label; the `/accounts` export entry is removed; CSV/JSON downloads still work and still honor
  `?account=`.
- **Export relocation breaks nothing pre-existing:**
  - A direct GET / existing bookmark to `/api/export/csv` and `/api/export/json` (with or without
    `?account=<id>`) still downloads — the **API routes are unchanged**; only the entry-point UI moved.
  - Changing the topbar account selector while on `/settings` re-navigates and updates **both** the
    scope label and the export-link hrefs together; switching back to "All accounts" clears `?account=`.
  - The global account-filter persistence is unaffected on every other page (`/dashboard`,
    `/transactions`, `/reports`, `/accounts`): selecting an account still scopes those surfaces as
    before — moving the export UI touched no selector logic.
  - A bogus/stale `?account=<unknown>` on `/settings` shows "Exporting: All accounts" and the export
    links carry **no** `?account=` (the id is dropped, not passed through to an empty download).
- **Display name accepts duplicates** (two accounts can share a name; no uniqueness error). A rapid
  double-submit is prevented at the UI (`SubmitButton` disabled while pending); even if two writes did
  reach the server concurrently, the outcome is correct by **last-write-wins** on the single owned row
  (B4) — no corruption, no partial state.
- A **Settings** link appears in the sidebar bottom group between Accounts and Help and highlights on
  `/settings`.
- `npm run test:run` and `npm run build` pass.

---

## 12. Files

**New**
- `src/app/settings/page.tsx`
- `src/components/settings/settings-name-form.tsx` (client)
- `src/components/settings/plan-badge.tsx` (extracted from `/profile`; imported by both)
- `src/lib/validations/profile.ts`
- `test/lib/validations/profile.test.ts`
- `test/lib/db/user.test.ts` (projection-shape guard for `getUserOverview`)

**Modified**
- `src/actions/profile.ts` — add `updateProfile` + `UpdateProfileState`
- `src/lib/system-constants.ts` — add `PROFILE_NAME_MAX`
- `src/components/dashboard/sidebar.tsx` — add Settings nav link
- `src/app/profile/page.tsx` — import the extracted `PlanBadge` (drop the inline copy)
- `src/components/accounts/accounts-view.tsx` — remove the `<ExportLinks>` mount (its current host)
- `src/components/settings/*` — host `<ExportLinks>` in a "Your data" section with the scope label
- `auth.config.ts` — add `/settings` to `isProtected`

**New (drift guard / improvements)**
- `src/lib/db/user.ts` — `getUserOverview` shared projection (§3.1)

**No schema change. No migration.**

---

## 13. Future IA — `/profile` ↔ `/settings` consolidation (pointer)

This slice deliberately leaves an overlap: identity/security/danger-zone live on `/profile`, while
`/settings` hosts preferences + billing + (now) data export. That is the right *incremental* split for
slot #6, but the longer-term consolidation — folding security + account-deletion into `/settings`,
co-locating export + deletion under a "Data & privacy" group, and reducing `/profile` to a redirect —
is **out of scope here** and recorded separately so this spec stays focused on deliverables:

➡ **[docs/account-settings-ia.md](../account-settings-ia.md)** — target end-state, rationale, and the
phased path. Forward guidance only; nothing in it is built in this slice. This slice ships only §1–§12.
