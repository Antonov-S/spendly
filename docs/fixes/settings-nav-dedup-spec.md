# Fix Spec: De-duplicate Settings / Accounts in the Sidebar Nav

After the Account Surfaces IA Consolidation slice repointed the `UserMenu` "Profile" entry to
**Settings**, the sidebar bottom now surfaces the same destinations twice. This fix removes that
redundancy. Markup-only; no logic, no data, no new routes.

Branch: `fix/settings-nav-dedup`

---

## Issue — the same links appear in two stacked clusters

The sidebar bottom utility group renders, top → bottom:

- **Accounts** → `/accounts`
- **Settings** → `/settings`
- **Help** → `/help`
- the **avatar row** (`UserMenu`) — a drop-up anchored directly beneath those links

The `UserMenu` drop-up
([src/components/dashboard/user-menu.tsx](../../src/components/dashboard/user-menu.tsx)) currently
contains:

- **Settings** → `/settings`
- **Accounts** → `/accounts`
- **Sign out**

So clicking the avatar reveals the *same two links* (Settings, Accounts) that are already visible as
persistent labels one row above it. Two of the menu's three items duplicate the utility group directly
above. The duplication reads as a mistake, not a convenience.

> Note: the consolidation spec's Decision **D2** explicitly accepted "two entry points is fine and
> consistent." This fix revisits that under a strict good-UI lens once the duplication became literally
> *stacked* (menu directly under the same sidebar links). It does **not** change any destination — only
> where each is reached from.

## Decision — keep the visible sidebar links, slim the avatar menu to identity + Sign out

**Rationale (good UI as the deciding criterion):**

1. **Discoverability + speed favour the sidebar.** A persistent, labelled, one-click link beats a
   destination buried behind a drop-up. Hiding Settings/Accounts behind the avatar makes two important
   surfaces *less* findable, not more.
2. **The avatar menu's strongest, most universal job is "who am I + sign out."** Anchoring Sign out to
   the avatar is the near-universal convention (Linear, Notion, Slack); Settings-behind-avatar is also a
   convention but here it *competes* with a visible sidebar link, whereas Sign out has no other natural
   home.
3. **One home per destination.** After the trim, each target has exactly one obvious place:
   Settings / Accounts / Help in the sidebar, Sign out under the avatar. No redundancy.

The rejected alternative — strip Settings/Accounts from the sidebar and keep the rich avatar menu (the
more conventional "settings behind avatar" pattern) — trades away discoverability and leaves the sidebar
bottom sparse (just Help). For this app, visibility wins.

## Fix

In [src/components/dashboard/user-menu.tsx](../../src/components/dashboard/user-menu.tsx):

- **Remove** the `<Link href="/settings">Settings</Link>` and `<Link href="/accounts">Accounts</Link>`
  items from the drop-up. Keep the **Sign out** `<form action={signOutAction}>` button.
- The drop-up now contains only Sign out. The avatar row already renders the user's name + email
  (identity), so the menu stays meaningful as an "identity + sign out" control.
- Drop the now-unused imports: `Link` (from `next/link`) and `Settings` / `Wallet` (from `lucide-react`)
  — verify each is unused after the deletion before removing. `LogOut` (Sign out icon) stays.
- Update the component doc comment to "…opens a drop-up menu with a sign-out action."

**Do not change** the sidebar utility group itself (`Accounts`, `Settings`, `Help` links stay exactly as
they are) — they are the retained, canonical entry points. The separate sidebar `Settings` link added by
the Settings Page slice is the keeper.

### Optional polish (only if it reads better in QA)

With a single item, the drop-up may feel thin. If so, either (a) leave it — a one-item account menu with
the identity row above is still clear and conventional; or (b) add a non-duplicating affordance (e.g. the
plan badge or email is already shown). **Do not** re-add Settings/Accounts to "fill" it — that reinstates
the duplication this fix removes. Default to (a); no extra work.

## What we are not doing

- **Not** removing the sidebar `Settings` or `Accounts` links (the visible, discoverable home stays).
- **Not** adding, renaming, or removing any route.
- **Not** touching `/settings`, `/accounts`, `/help`, or any page — this is confined to the sidebar
  `UserMenu` component.

## Testing

### Unit (Vitest)

No server-action or `src/lib` logic changes — no new tests. Existing suites stay green
(`npm run test:run`).

### Build / lint

`npm run build` + `npm run lint` must pass. ESLint `no-unused-vars` is the real check here — it confirms
the `Link` / `Settings` / `Wallet` import cleanup is complete (a leftover unused import surfaces as an
error).

### Manual (Playwright)

1. Sidebar bottom still shows **Accounts**, **Settings**, **Help** as visible links, each navigating
   correctly.
2. Click the avatar row → drop-up shows **only Sign out** (no Settings, no Accounts).
3. Sign out from the drop-up still ends the session and lands on `/sign-in`.
4. Mobile overlay (`< 768px`): the avatar menu + sidebar links behave the same; `onNavigate` still closes
   the overlay on link tap.
