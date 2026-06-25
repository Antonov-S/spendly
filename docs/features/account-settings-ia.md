# Account Surfaces IA — `/profile` ↔ `/settings` Consolidation

> **Status: realized.** `/settings` is now **the** account-management surface and `/profile` is a thin
> permanent redirect → `/settings`. This note is the **canonical reference** for where account/user-level
> settings live, so later slices inherit a predefined destination instead of re-deciding. Implemented by
> [features/account-surfaces-ia-consolidation-spec.md](./account-surfaces-ia-consolidation-spec.md).

## How we got here

The Settings Page slice (ROADMAP §7) deliberately left two pages that both described "the account" —
`/profile` (identity, security, danger zone) and `/settings` (preferences, billing, data export). That
split was the right *incremental* step for one slice, but two "account" pages accrete confusion if left
undirected. The consolidation slice merged everything onto `/settings` and reduced `/profile` to a
redirect.

## Canonical Settings IA

`/settings` is a single centered column of cards. Every account/user-level concern belongs to exactly
one sub-section:

| Sub-section | Owns | Examples of future homes |
|---|---|---|
| **Preferences** | Identity + display/user-level preferences | display name; identity header (avatar / email / member-since); later: locale, theme, multi-currency **preferred currency** picker (Roadmap §11) |
| **Security** | Auth + session | change password; sign out; later: 2FA, active sessions |
| **Billing** | Plan + Stripe | upgrade/manage; later: invoices, AI usage/limits readout |
| **Categories** | Category management | (unchanged) |
| **Data & privacy** | Data ownership | export; account deletion (co-located, danger zone last); later: data-import (Roadmap §15), consent/opt-out for telemetry (§0) |

**Card order:** Preferences → Security → Billing → Categories → Data & privacy (export + danger zone
last, danger zone at the very bottom). This is a deliberate baseline, not frozen: new sections slot in
by the ownership model above (a new card joins its owning group, or a new group is placed by concern),
with Data & privacy / danger zone kept last.

**Export before deletion.** Export and account deletion live together under "Data & privacy": the
`<ExportLinks>` CSV/JSON controls sit *inside* a prominent export-before-delete callout, and the
delete-confirm dialog repeats a one-line export reminder. This realizes the product's documented
*"prompted to export before deletion"* flow ([project-overview.md](../project-overview.md) →
Monetization) as a single legible surface.

## Rule — no new account routes

Future *user-level* settings (notification preferences, AI-assistant preferences, telemetry consent,
multi-currency, theme, etc.) are added as a **card/group under `/settings`**, *not* as a new top-level
route. New routes are justified only for genuinely distinct surfaces (e.g. `/help`, Roadmap §2), never
for another slice of "account/preferences".

## `/profile` is a permanent redirect

`/profile` stays resolvable indefinitely (`redirect("/settings")`, Next.js 307) — it's linked from the
`UserMenu` drop-up and may be bookmarked. It is **not** scheduled for removal. It remains in
`auth.config.ts` `isProtected`; the hop is one-directional (`/settings` never redirects back), and an
unauthenticated hit is caught by the shared guard → `/sign-in`, so there is no loop.
