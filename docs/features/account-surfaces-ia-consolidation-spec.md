# Account Surfaces IA Consolidation — Spec

> **✅ Shipped (`feature/account-surfaces-ia-consolidation`).** Implemented as specced. `/settings` is
> now the sole account-management surface (Preferences with identity header → Security → Billing →
> Categories → Data & privacy with the export-before-delete callout + deletion danger zone last);
> `/profile` is a permanent `redirect("/settings")`; `UserMenu` repointed to **Settings**. D3 (drop
> usage stats) and D4 (drop `preferredCurrency` from the projection) confirmed and applied; the two
> profile components moved to `src/components/settings/`. The §10 canonical-IA doc
> ([account-settings-ia.md](../account-settings-ia.md)) was flipped to "realized". 508 tests + build +
> lint pass; no schema change. **Follow-up (separate branch):** sidebar/UserMenu nav de-dup —
> `docs/fixes/settings-nav-dedup-spec.md`.

> **Post-MVP Roadmap §1** (Delivery Sequence order **1**). Effort: M · Value: medium (clears
> structural debt). **Not Pro-gated.** This is the implementation spec for **step 3** of
> [account-settings-ia.md](../account-settings-ia.md) — the only step left; steps 1 (stand up
> `/settings` + move export) and 2 (Billing actions) already shipped.
>
> **Scope note:** this slice is **§1 only**. §0 (Product Analytics / Telemetry) and §2 (Help / FAQ
> route) are separate `/feature` slices with their own specs — do not bundle them here.

---

## 1. Problem

The MVP left **two** pages that both describe "the account", which will only accrete confusion as
more surfaces (Help, future AI settings) land on Settings:

- **`/profile`** ([src/app/profile/page.tsx](../../src/app/profile/page.tsx)) — identity card
  (avatar, name, email), a plan/currency/member-since read-out, usage stats, change-password,
  delete-account (danger zone), and a sign-out button.
- **`/settings`** ([src/app/settings/page.tsx](../../src/app/settings/page.tsx)) — Preferences
  (display-name edit), Billing (plan + Stripe Upgrade/Manage), Categories, and "Your data" (export).

A user has **no single place** to manage "the account", and the product's documented
*"prompted to export before deletion"* flow ([project-overview.md](../project-overview.md) →
Monetization) is impossible to wire cleanly because export (`/settings`) and deletion (`/profile`)
sit on different pages.

## 2. Goal / End-state

**One coherent "Account" area at `/settings`**, with clearly-labelled sub-sections, and `/profile`
reduced to a **thin redirect** so no inbound link breaks. Mapping (from
[account-settings-ia.md](../account-settings-ia.md) target table):

| Concern | Today | After this slice |
|---|---|---|
| Display name | `/settings` Preferences | **Settings → Preferences** (unchanged) |
| Avatar / email / member-since | `/profile` identity card | **Settings → Preferences** header (folded in) |
| Change password | `/profile` | **Settings → Security** |
| Sign out | `/profile` + UserMenu | **Settings → Security** + UserMenu (both kept) |
| Plan + billing | `/settings` Billing | **Settings → Billing** (unchanged) |
| Categories | `/settings` | **Settings → Categories** (unchanged) |
| Data export | `/settings` "Your data" | **Settings → Data & privacy** |
| Account deletion | `/profile` danger zone | **Settings → Data & privacy** (co-located with export) |
| Usage stats | `/profile` | **Dropped** (see §6, Decision D3) |
| Preferred currency row | `/profile` | **Dropped** (dormant EUR-only — see Decision D4) |

## 3. Decisions (resolve up front)

| # | Decision | Resolution |
|---|---|---|
| **D1** | Reduce `/profile` to a **redirect** or a **read-only identity summary**? | **Thin redirect → `/settings`.** A read-only summary is just a second place to look — exactly the confusion we're removing. The route stays resolvable (never 404). |
| **D2** | What does the `UserMenu` "Profile" item point to? | **Repoint to `/settings`, relabel "Settings"** (icon `Settings`). Keeps a familiar drop-up entry; no dead "Profile" concept. The sidebar already has a Settings link — two entry points is fine and consistent. |
| **D3** | Keep the usage-stats grid? | **Drop it.** It's a vanity readout; the same counts are visible on each entity's own page. Removes `ProfileStats` component, `getProfileStats` fetcher, and the `ProfileStats` type + its test. *(This is the one removal needing sign-off — flagged because it deletes shipped code.)* **Telemetry check:** these are static per-user DB **counts**, not engagement/retention signals — the §0 telemetry layer is an event stream (feature opens, transaction created, upgrade clicked), a different and richer source. Dropping the counts does **not** foreclose any future engagement/retention initiative; those will draw on §0 events, not this grid. The `getProfileStats` query can be re-introduced cheaply if a Settings "overview" ever wants it back. |
| **D4** | Keep the "Preferred currency" read-only row? | **Drop it.** `preferredCurrency` is dormant in the EUR-only MVP (`formatCurrency` renders `€` directly). Re-surface it when multi-currency lands (Roadmap §11). |
| **D5** | Where do the moved components live? | Move `change-password-form.tsx` + `delete-account-dialog.tsx` from `src/components/profile/` → **`src/components/settings/`** (the `/profile` folder is being retired). Update imports. |
| **D6** | How is "export before delete" wired? | A **visually prominent callout** (not plain inline copy) inside the Data & privacy card, above the danger zone — a bordered/tinted note: *"Exporting before you delete? Download a copy above — deletion is permanent after the 30-day grace period."* It must be **immediately actionable, not just informational**: render the `<ExportLinks>` CSV/JSON controls *inside* (or directly adjacent to, visually grouped with) the callout, so the recommendation and the action are one unit — don't make the user hunt back up the card. This is a key product safeguard ([project-overview.md](../project-overview.md) → Monetization). The delete-confirm dialog also carries a one-line export reminder/link. No new flow — just legible proximity now that both live together. |
| **D7** | Section order on `/settings` | Preferences → Security → Billing → Categories → **Data & privacy** (export + danger zone last, danger zone at the very bottom). **This order is a deliberate baseline, not frozen:** future sections slot in by the §10 ownership model (a new card joins its owning group, or a new group is placed by concern, with Data & privacy/danger zone kept last). Specs should follow that model rather than re-debate ordering. |

## 4. `/settings` — new layout

A single centered `max-w-lg` column (unchanged shell), cards top → bottom:

1. **Back to dashboard** link — unchanged.
2. **Preferences** — gains a compact identity header above the name form:
   `<Avatar>` + name + email + a muted "Member since {month year}" line. Then the existing
   `<SettingsNameForm>`. (Absorbs `/profile`'s identity card; email stays read-only here.)
3. **Security** *(new card)* — `<ChangePasswordForm>` rendered only when `user.password !== null`
   (OAuth-only users have no password), followed by the **Sign out** button (moved from `/profile`,
   reusing `signOutAction` + `<SubmitButton>`). When `hasPassword` is false, the card still renders
   for the sign-out control.
4. **Billing** — unchanged (`<PlanBadge>` + `planSummary` + `<BillingActions>`).
5. **Categories** — unchanged (`<ManageCategories>`).
6. **Data & privacy** *(renamed from "Your data")* — the export block: scope label +
   `<ExportLinks>` wrapped in a **prominent export-before-delete callout** (bordered/tinted, not plain
   text), so the recommendation and the CSV/JSON controls read as one actionable unit (D6); then,
   below a divider, the `<DeleteAccountDialog>` danger-zone block. The delete-confirm dialog also
   carries a one-line export reminder/link (D6).

> The existing `?account=` scope resolution, `reconcileCheckoutReturn`, and `?checkout=` banner
> logic on the page are **unchanged** — this slice only adds/relocates cards.

## 5. `/profile` — redirect

Replace the whole page body with a redirect. Keep auth handling so an unauthenticated hit lands on
sign-in (via `/settings`'s own guard) rather than looping:

```tsx
import { redirect } from "next/navigation";

export default function ProfilePage() {
  redirect("/settings");
}
```

- `/profile` **stays in `auth.config.ts` `isProtected`** ([src/auth.config.ts:20](../../src/auth.config.ts#L20))
  — the redirect target is protected and bookmarks should hit auth, not a flash.
- Drop the page's `force-dynamic` / `metadata` exports (no content to render).
- **No redirect loop:** the hop is strictly one-directional (`/profile → /settings`); `/settings`
  never redirects back to `/profile`. An unauthenticated hit on either is caught by the shared auth
  guard and sent to `/sign-in` — a terminal destination — so there is no cycle. Verify in QA (§9).
- **Permanent compatibility route — not a temporary migration aid.** `/profile` is kept resolvable
  *indefinitely*: it's linked from the `UserMenu` and is a plausible bookmark / manually-typed URL,
  and there is no migration window after which those inbound paths expire. Do **not** schedule its
  removal in a later slice. (Use the default `redirect()` — Next.js 307 — rather than a permanent
  308, since `/settings` is the live surface and we want clients to keep resolving via `/profile`.)

## 6. Cleanup (orphaned by D3/D4/D5)

- **Delete** `src/components/profile/profile-stats.tsx` and `src/types/profile.ts`'s `ProfileStats`
  type **iff** D3 confirmed; remove `getProfileStats` from `src/lib/db/profile.ts`.
- **Move** `change-password-form.tsx` + `delete-account-dialog.tsx` into `src/components/settings/`.
- After the move the `src/components/profile/` folder is empty → remove it.
- Update the `getUserOverview` doc comment in [src/lib/db/profile.ts](../../src/lib/db/profile.ts):
  `/settings` is now the **sole** consumer (the projection's `password`/`image`/`createdAt` columns
  are still all used — by Security gating, the Preferences avatar, and "Member since" respectively).
  If D4 confirmed, drop `preferredCurrency` from the projection.

## 7. Files touched

**Edit**
- `src/app/settings/page.tsx` — add Security card; fold identity header into Preferences; rename
  "Your data" → "Data & privacy" and nest the delete dialog; new imports.
- `src/app/profile/page.tsx` — reduce to `redirect("/settings")`.
- `src/components/dashboard/user-menu.tsx` — repoint "Profile" → `/settings`, relabel "Settings",
  swap icon (D2).
- `src/lib/db/profile.ts` — remove `getProfileStats` (D3); update `getUserOverview` comment; maybe
  drop `preferredCurrency` (D4).
- `src/components/settings/delete-account-dialog.tsx` (after move) — add export-before-delete copy (D6).

**Move**
- `src/components/profile/change-password-form.tsx` → `src/components/settings/`
- `src/components/profile/delete-account-dialog.tsx` → `src/components/settings/`

**Delete** *(D3, pending sign-off)*
- `src/components/profile/profile-stats.tsx`
- `ProfileStats` type in `src/types/profile.ts` (and the file if it becomes empty)

## 8. Tests

This slice adds **no new server actions or `src/lib` logic** — `updateProfile`, `changePassword`,
`deleteAccount`, and `softDeleteAccount` are untouched. So:

- **No new Vitest files required.**
- **Update** `test/lib/db/profile.test.ts` — remove the `getProfileStats` assertions (D3); adjust the
  `getUserOverview` projection-shape guard if `preferredCurrency` is dropped (D4).
- `test/actions/profile.test.ts` and `test/lib/validations/profile.test.ts` — unchanged.
- Run `npm run test:run` + `npm run build` + `npm run lint` (the standards gate). The lint run is the
  real check here — it catches dead imports left by the component moves and the D3 deletions.

## 9. Manual QA (Playwright)

1. `/profile` (signed in) → **redirects to `/settings`** (no 404, no flash of old content) and
   **settles** — exactly one redirect, no loop, no further bounce.
2. `/profile` (signed out) → lands on `/sign-in` (terminal — does not loop back through `/profile`).
3. `UserMenu` "Settings" item → `/settings`.
4. `/settings` shows all six cards in order (§4); Security shows change-password **only** for a
   credentials user, sign-out always.
5. Change-password and delete-account flows still work from their new home (the delete flow signs out
   to `/sign-in?deleted=1`).
6. Data & privacy: export links carry the active `?account=` scope; the export-before-delete line is
   visible in the delete dialog.
7. **Back-navigation:** after `/profile → /settings`, pressing browser Back lands on the page
   *before* `/profile` (e.g. the dashboard), **not** in a `/profile`↔`/settings` ping-pong. Check
   both real entry paths: a bookmarked/typed `/profile` URL, and a `/profile` click from the
   `UserMenu`.
8. Breakpoints 375 / 768 / 1440px — cards stack cleanly (mirrors existing `/settings`).

## 10. Canonical Settings IA (forward guidance — prevents future drift)

Once this slice ships, `/settings` is **the** account-management surface and `/profile` is a redirect.
To stop the duplicate-page problem from recurring as new surfaces land, this is the canonical IA — and
the rule that governs future additions:

| Sub-section | Owns | Examples of future homes |
|---|---|---|
| **Preferences** | Identity + display/user-level preferences | display name; later: locale, theme, multi-currency **preferred currency** picker (Roadmap §11) |
| **Security** | Auth + session | change password; sign out; later: 2FA, active sessions |
| **Billing** | Plan + Stripe | upgrade/manage; later: invoices, AI usage/limits readout |
| **Categories** | Category management | (unchanged) |
| **Data & privacy** | Data ownership | export; account deletion; later: data-import (Roadmap §15), consent/opt-out for telemetry (§0) |

**Rule — no new account routes.** Future *user-level* settings (notification preferences,
AI-assistant preferences, telemetry consent, multi-currency, theme, etc.) are added as a **card/group
under `/settings`**, *not* as a new top-level route. New routes are justified only for genuinely
distinct surfaces (e.g. `/help`, Roadmap §2), never for another slice of "account/preferences".

**Action for this slice:** after implementation, **update
[account-settings-ia.md](../account-settings-ia.md)** — flip its "target end-state (post-MVP)" framing
to "realized", and record the table above + the no-new-routes rule as the canonical reference. That
doc (already linked from the settings-page spec) becomes the single source future feature specs point
at, so AI-settings / notification-preference slices inherit a predefined destination instead of
re-deciding.

## 11. Out of scope

- §0 Telemetry, §2 Help/FAQ — separate slices.
- Any change to billing, categories, or export **behaviour** (only relocation/relabelling).
- Reviving `preferredCurrency` (Roadmap §11 multi-currency).
- A "trash"/restore surface for the soft-deleted account (Roadmap §8 covers transactions only).
