# Account Surfaces IA — `/profile` ↔ `/settings` Consolidation

> **Status: forward guidance, not scheduled work.** This note records the *intended* end-state for
> Spendly's account-management surfaces so that later slices don't each invent their own answer. It is
> referenced from [features/settings-page-spec.md](./features/settings-page-spec.md) §7/§13 but is
> deliberately kept **out** of that implementation spec to keep the spec focused on its deliverables.

## The overlap (post Settings slice)

The Settings Page slice (ROADMAP §7) deliberately leaves two pages that both describe "the account":

- **`/profile`** — identity, security, danger zone (avatar, plan/currency/member-since read-out, usage
  stats, change-password, delete-account, sign-out).
- **`/settings`** — preferences (display name), billing (plan + Stripe §8), and data export (relocated
  from `/accounts`).

That split is the right *incremental* step for one slice, but two "account" pages will accrete
confusion if left undirected.

## Target end-state (post-MVP)

One coherent "Account" area with clearly-labelled sub-surfaces, so a user has exactly one place to look
for each concern:

| Concern | Today | Target home |
|---|---|---|
| Display name | `/settings` Preferences | **Settings → Profile/Preferences** |
| Email / password / sign-out | `/profile` | **Settings → Security** |
| Plan + billing | `/settings` Billing (+ §8) | **Settings → Billing** |
| **Data export** | `/settings` "Your data" | **Settings → Data & privacy** |
| **Account deletion** | `/profile` danger zone | **Settings → Data & privacy** (co-located with export) |
| Usage stats | `/profile` | Settings → overview, or dropped |

**Why export + deletion should eventually co-locate:** the product already says a user is *"prompted to
export before deletion"* ([project-overview.md](./project-overview.md) → Monetization / account
deletion). Today export (`/settings`) and deletion (`/profile`) sit on different pages, so that prompt
can't link directly to the adjacent control. Putting both under one "Data & privacy" group makes the
export-before-you-delete flow a single, legible surface.

## Suggested phased path (each a small, independent slice)

1. **(Settings slice)** Stand up `/settings`; move export onto it. ✅
2. **(With Stripe §8)** Billing actions land in the Settings billing card.
3. **(Post-§8 IA pass)** Migrate change-password + delete-account from `/profile` into `/settings`
   sub-sections; reduce `/profile` to a thin redirect → `/settings` (or a read-only identity summary)
   to avoid a dead duplicate route. Co-locate export + deletion under "Data & privacy" and wire the
   export-before-delete prompt.

**Constraint for whoever does step 3:** keep `/profile` resolvable (redirect, don't 404) — it's linked
from the `UserMenu` drop-up and may be bookmarked. Do not orphan inbound links.
