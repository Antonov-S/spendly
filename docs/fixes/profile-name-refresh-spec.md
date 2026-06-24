# Fix Spec: Display Name Doesn't Refresh After Edit

Editing the display name on `/settings` persists to the database but the **sidebar profile
row keeps showing the old name** until the user signs out and back in. Saving also feels
sluggish. This fix makes the name update propagate without a re-login and trims the
unnecessary work that makes the save feel slow.

Branch: `fix/profile-name-refresh`

---

## Root cause

The app uses a **JWT session strategy** (`session: { strategy: "jwt" }`,
[auth.ts:22](../../src/auth.ts#L22)). With JWT sessions, the user's `name` (and `email` /
`picture`) is baked into the **token** at sign-in. The sidebar reads its display name from
the session, not the database:

- `updateProfile` writes only the `name` column and calls
  `revalidatePath("/settings")` + `revalidatePath("/profile")`
  ([profile.ts:39-46](../../src/actions/profile.ts#L39-L46)). It never updates the JWT.
- Every authenticated page passes the sidebar user from the **session**, e.g.
  `user={{ name: session.user.name, … }}`
  ([dashboard/page.tsx:55-59](../../src/app/dashboard/page.tsx#L55-L59)), which flows into
  `AppShell` → `Sidebar` → `UserMenu`, where the name is rendered
  ([user-menu.tsx:33](../../src/components/dashboard/user-menu.tsx#L33)).
- The `session` callback only copies `token.sub` → `session.user.id` and otherwise returns
  the token's stale `name` ([auth.ts:61-66](../../src/auth.ts#L61-L66)).

So `revalidatePath` re-renders the page, but the page re-reads the **same stale token** —
the name never changes. "Back to dashboard" shows the old name for the same reason.

---

## Desired behaviour

After a successful name save, the new name appears in the sidebar profile row (and anywhere
else sourced from `session.user.name`) **without a sign-out/in cycle** — on the next render
of any authenticated page.

---

## Fix — refresh the JWT on update (primary approach)

Update the token in place so the session reflects the new name. Three small edits:

### 1. `src/auth.ts` — expose `update` and add a `jwt` callback

- Add `unstable_update` to the destructured `NextAuth(...)` return, aliased as `update`:

  ```ts
  export const { auth, handlers, signIn, signOut, unstable_update: update } =
    NextAuth({ … });
  ```

- Add a `jwt` callback alongside the existing `session` callback that merges an
  update-triggered name into the token:

  ```ts
  async jwt({ token, trigger, session }) {
    if (trigger === "update" && typeof session?.name === "string") {
      token.name = session.name;
    }
    return token;
  },
  ```

  > Note: a `jwt` callback is not currently defined (only `signIn` and `session` are). Add
  > it; do not disturb the existing two. NextAuth's default JWT→session mapping already
  > carries `token.name` onto `session.user.name`, so no `session`-callback change is needed.

### 2. `src/actions/profile.ts` — call `update` after the DB write

In `updateProfile`, after the `prisma.user.update(...)` and before returning, push the new
name into the token:

```ts
await update({ user: { name: parsed.data.name } });
```

Keep the `revalidatePath` calls — they refresh the server-rendered pages that read the
(now-updated) session. Import `update` from `@/auth`.

> If `unstable_update` proves unreliable from a Server Action in this Next.js/NextAuth
> version (the cookie write must happen during the action's response), fall back to the
> alternative below rather than spending more than ~2 attempts on it.

### Alternative (fallback) — source the sidebar name from the DB

If the JWT-update path is flaky, stop trusting the token for display: fetch the user's
current `name` / `image` / `email` from the database in each authenticated page (a
`getUserOverview`-style projection already exists in
[`src/lib/db/profile.ts`](../../src/lib/db/profile.ts)) and pass *that* into `AppShell`
instead of `session.user.*`. This is always-fresh and avoids JWT mechanics, at the cost of
one lightweight indexed read per page and edits at each page's `user={…}` call site. Prefer
the primary approach; document this one as the chosen path if you switch.

---

## Secondary — "edit mode is slow"

The name form is an always-editable form (no separate edit toggle), so the perceived
slowness is the **save round-trip**, not entering edit mode. Two contributors, both cheap to
address:

- `updateProfile` revalidates **two** full routes (`/settings` + `/profile`) on every save.
  `/profile` does not show an editable name and is a separate surface — dropping
  `revalidatePath("/profile")` removes a full-route re-render from the hot path. Keep
  `revalidatePath("/settings")`. (If the alternative DB-sourced approach is taken, the
  sidebar updates via its own page render and `/profile` still need not be revalidated from
  here.)
- Do **not** add optimistic UI (the settings slice deliberately chose no optimistic update,
  decision B4) — this fix keeps the server-confirmed model, just lighter.

If, after these, save latency is still notably worse than other actions, stop and report
findings rather than guessing — it may be environmental (dev server / DB round-trip) and not
worth further code change.

---

## What we are not doing

- **Not** switching off the JWT session strategy.
- **Not** changing what `updateProfile` writes (still `name` only — security decision S3).
- **Not** adding optimistic UI.
- **Not** touching `changePassword` / `deleteAccount` or any other profile action.

## Testing

### Unit (Vitest)

- Extend `test/actions/profile.test.ts`: assert `updateProfile` calls the mocked `update`
  (mock `@/auth`'s `update` alongside the existing `auth` mock) with the parsed name after a
  successful `prisma.user.update`, and that it still returns `{ success: true, at: <number> }`.
  Assert the auth-guard and validation branches are unchanged (no `update` call on failure).
- If the revalidation change lands, assert `revalidatePath` is called for `/settings` and
  (per the decision) not for `/profile`.

### Manual

1. Sign in; note the sidebar name.
2. `/settings` → change the display name → **Save changes**.
3. Without reloading or re-authenticating, the sidebar profile row shows the new name (on
   the next navigation, e.g. clicking "Dashboard"). The success banner still appears and
   auto-dismisses.
4. Hard-reload `/dashboard` → name persists (DB-backed).
5. Sign out / in → name still correct (token re-minted from DB).
