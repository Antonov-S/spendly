# Spec: Revoke JWT sessions on password change, reset, and account deletion

## Status

Not Started

## Problem

The app uses stateless JWT sessions ([src/auth.ts:22](src/auth.ts#L22),
`session: { strategy: "jwt" }`, NextAuth's default ~30-day lifetime). A JWT is valid until
it expires; there is **no server-side revocation**. Nothing that should end a session
actually ends existing tokens:

- **Password reset** — the "someone compromised my account, I'm resetting" flow. The new
  password is stored ([src/app/api/auth/reset-password/route.ts:55](src/app/api/auth/reset-password/route.ts#L55)),
  but the attacker's already-issued JWT keeps working for up to 30 days.
- **Password change** — same: [src/lib/auth/change-password.ts:58](src/lib/auth/change-password.ts#L58)
  rotates the hash but not live sessions.
- **Account deletion (soft-delete grace period)** — the `signIn` callback blocks *new*
  sign-ins for `deletedAt` accounts ([src/auth.ts:53-60](src/auth.ts#L53-L60)), but a JWT
  minted before deletion still authorizes full read/write on other devices, contradicting
  the "account deactivated immediately" promise in the product spec.

The `session` callback ([src/auth.ts:61-66](src/auth.ts#L61-L66)) only copies `token.sub`
onto `session.user.id` — it performs no freshness check against the database.

**Severity:** Medium (from the 2026-07-03 security review, finding #2). The most
user-impactful gap: the security actions users expect to lock others out do not.

## Goal

Give JWT sessions a revocation signal so that a password change, a password reset, or an
account soft-delete invalidates every previously issued token for that user at their next
request — without moving to database sessions (keeps the current stateless model and its
performance).

Non-goals: switching to `strategy: "database"`; per-device session management UI;
shortening the token lifetime.

## Approach

A monotonic **session epoch** stamped into the JWT at sign-in and re-validated on every
token read. When the user's server-side epoch advances past the token's — or the account
is soft-deleted, or the row is gone — the **`jwt` callback returns `null`**, which Auth.js
v5 treats as "no session": `auth()` yields `null` everywhere and the session cookie is
cleared wherever a `Set-Cookie` is possible (route handlers, the proxy; an RSC render
can't write cookies but still sees a `null` session for that request).

> **Why the check lives in the `jwt` callback, not the `session` callback.** An earlier
> draft stripped `session.user.id = ""` in the `session` callback and relied on
> `getSessionOrRedirect`'s falsy check. That ships an **infinite redirect loop**: two
> other checks test `session.user` (a still-truthy object), not `session.user.id` —
> `redirectIfAuthenticated` ([src/lib/auth/guards.ts:30](src/lib/auth/guards.ts#L30)) and
> the `authorized` callback's `isAuthPage` branch
> ([src/auth.config.ts:15](src/auth.config.ts#L15)), which bounces "signed-in" users away
> from `/sign-in`. Since [src/proxy.ts](src/proxy.ts) re-exports the **full** `auth` from
> `@/auth` (Node runtime — the same instance, Prisma included), the proxy runs the same
> callbacks: a revoked user would loop `/dashboard` → (page guard) → `/sign-in` → (proxy)
> → `/dashboard` forever. Returning `null` from the `jwt` callback kills the session at
> the source for every consumer, and the cookie cleanup stops the loop's fuel.

### 1. Schema: add a session epoch to `User`

```prisma
model User {
  // ...
  sessionEpoch Int @default(0) // bumped to invalidate all outstanding JWTs
}
```

Use an `Int` counter (simple, monotonic, cheap to compare) bumped via
`{ increment: 1 }`. Migration `add_user_session_epoch` — pure additive, no backfill (all
existing users default to `0`; their live tokens carry no epoch and are handled by the
"missing epoch" rule in `isTokenRevoked`). Apply to the `development` Neon branch via
`prisma migrate dev`; production deferred to deploy.

### 2. Pure revocation rule: `src/lib/auth/session-epoch.ts`

The compare is a pure helper that the `jwt` callback imports — single-sourced like
`isGoalOverdue` and `budgetRiskLevel`, and unit-testable without touching NextAuth:

```ts
interface RevocationRow {
  sessionEpoch: number;
  deletedAt: Date | null;
}

/**
 * A token is revoked when its user row is gone, the account is soft-deleted,
 * or the server-side epoch has advanced past the one stamped into the token.
 * A token with no epoch (minted before this feature deployed) counts as 0.
 */
export function isTokenRevoked(
  tokenEpoch: unknown,
  row: RevocationRow | null
): boolean {
  if (!row || row.deletedAt) return true;
  const epoch = typeof tokenEpoch === "number" ? tokenEpoch : 0;
  return row.sessionEpoch !== epoch;
}
```

### 3. `jwt` callback: stamp at sign-in, re-validate on every read

There is no `jwt` callback today — add one in `src/auth.ts` (Node runtime; it must NOT go
into `auth.config.ts`). On initial sign-in (`user` present) read the user's current
`sessionEpoch` and store it on the token. On every subsequent invocation, run the
revocation check and return `null` for a revoked token.

```ts
callbacks: {
  async jwt({ token, user }) {
    if (user) {
      // Sign-in: capture the epoch this token is bound to. `user.id` is
      // optional in v5's types (OAuth path) — fall back to token.sub.
      const id = user.id ?? token.sub;
      const row = id
        ? await prisma.user.findUnique({
            where: { id },
            select: { sessionEpoch: true },
          })
        : null;
      token.epoch = row?.sessionEpoch ?? 0;
      return token;
    }

    if (!token.sub) return token;

    const row = await prisma.user.findUnique({
      where: { id: token.sub },
      select: { sessionEpoch: true, deletedAt: true },
    });
    // Revoked: epoch advanced (password change/reset), account soft-deleted,
    // or row gone. null = no session; cookie cleared where possible.
    if (isTokenRevoked(token.epoch, row)) return null;

    return token;
  },
  // existing session callback unchanged — a null token never reaches it
}
```

**Performance note:** this adds one indexed PK lookup per **token read**, and there are
more of those than "one per request": the proxy runs the full auth instance on every
matched navigation, and each page-level `auth()` call (guards, Server Actions) triggers
the callback again. That is the deliberate cost of stateless-with-revocation — a single
two-column `findUnique` on the primary key each time, acceptable at this app's scale.
Optionally wrap the lookup in React `cache()` to dedupe multiple `auth()` calls within
one RSC render pass (it cannot dedupe proxy-vs-page, which are separate executions). If
it ever matters beyond that, cache the epoch in Redis with a short TTL — out of scope
here.

### 4. Align the two remaining "am I signed in" predicates on `user.id`

With the `jwt` callback returning `null`, revoked sessions are `null` and every existing
check already fails closed. But the codebase should still agree on **one** definition of
"signed in" as belt-and-braces (and because these two are the exact checks that made the
session-callback approach loop):

- `redirectIfAuthenticated` ([src/lib/auth/guards.ts:30](src/lib/auth/guards.ts#L30)):
  `if (session?.user)` → `if (session?.user?.id)`.
- `authorized` callback ([src/auth.config.ts:15](src/auth.config.ts#L15)):
  `const isLoggedIn = !!auth?.user` → `!!auth?.user?.id`.

`getSessionOrRedirect` ([src/lib/auth/guards.ts:16](src/lib/auth/guards.ts#L16)) already
checks `!session?.user?.id` — no change.

### 5. Bump the epoch on the three events

- **Password change** — in `changeUserPassword`
  ([src/lib/auth/change-password.ts:58](src/lib/auth/change-password.ts#L58)), add
  `sessionEpoch: { increment: 1 }` to the same `user.update` that sets the new hash
  (one write, atomic).
- **Password reset** — in the reset route
  ([src/app/api/auth/reset-password/route.ts:55](src/app/api/auth/reset-password/route.ts#L55)),
  add `sessionEpoch: { increment: 1 }` to the `user.update`.
- **Account deletion** — the `deletedAt` check in `isTokenRevoked` already covers this,
  but also bump the epoch in `softDeleteAccount`
  ([src/lib/auth/account.ts:41](src/lib/auth/account.ts#L41) — note: it lives in
  `src/lib/auth/account.ts`, not `src/actions/profile.ts`) so the intent is explicit and
  a future un-delete that clears `deletedAt` (e.g. `scripts/reactivate-account.ts`)
  still can't resurrect pre-deletion tokens.

### 6. Password change signs the user out of their **own** session too — make it explicit

The epoch bump invalidates the very token that made the change-password request. Left
alone, the current `ChangePasswordForm` would show its success message and the user's
next navigation would silently dump them at `/sign-in` with no explanation.

Decision: **sign out deliberately, everywhere including here** — that is the honest
semantics of "revoke all sessions", and it mirrors what `deleteAccount` already does
([src/actions/profile.ts:124](src/actions/profile.ts#L124)):

- In the `changePassword` Server Action ([src/actions/profile.ts:63](src/actions/profile.ts#L63)),
  after `changeUserPassword` succeeds, call
  `await signOut({ redirectTo: "/sign-in?passwordChanged=1" })`.
- `/sign-in` extends its existing status-banner pattern (`?verified=1`, `?deleted=1` —
  see [src/app/sign-in/page.tsx:12-13](src/app/sign-in/page.tsx#L12-L13)) with
  `passwordChanged`: a green "Password changed — please sign in with your new password."
  banner via a `justChangedPassword` prop on `SignInForm`.

Do **not** try to keep the current session alive by re-stamping the token via
`unstable_update` — this repo already found it unreliable from Server Actions (the
display-name staleness fix), and it would special-case the one session that least
deserves special treatment.

The **reset** flow needs no UX change (the user is unauthenticated on `/reset-password`
and already lands on sign-in), and **deletion** already ends with `signOut`.

### 7. JWT type augmentation

`epoch` lives on the token, so the augmentation goes in the **`next-auth/jwt`** module —
a separate `declare module` block from the existing `next-auth` one in
[src/types/next-auth.d.ts](src/types/next-auth.d.ts). (Augmenting the wrong module
compiles fine and silently does nothing — spell it out.)

```ts
declare module "next-auth/jwt" {
  interface JWT {
    epoch?: number;
  }
}
```

## Affected files

| File | Change |
| --- | --- |
| `prisma/schema.prisma` | add `User.sessionEpoch Int @default(0)` |
| `prisma/migrations/**/add_user_session_epoch` | **new** additive migration |
| `src/lib/auth/session-epoch.ts` | **new** — pure `isTokenRevoked` helper |
| `src/auth.ts` | add `jwt` callback (stamp at sign-in; revocation check → `null`) |
| `src/types/next-auth.d.ts` | augment `next-auth/jwt` `JWT` with `epoch?: number` |
| `src/lib/auth/guards.ts` | `redirectIfAuthenticated` predicate → `user.id` |
| `src/auth.config.ts` | `authorized` `isLoggedIn` predicate → `user.id` |
| `src/lib/auth/change-password.ts` | bump `sessionEpoch` in the update |
| `src/app/api/auth/reset-password/route.ts` | bump `sessionEpoch` in the update |
| `src/lib/auth/account.ts` | bump `sessionEpoch` in `softDeleteAccount` |
| `src/actions/profile.ts` | `changePassword` → `signOut({ redirectTo: "/sign-in?passwordChanged=1" })` on success |
| `src/app/sign-in/page.tsx` + `sign-in-form.tsx` | `passwordChanged` banner (existing `?verified=1` pattern) |

## Backward compatibility

Tokens issued before deploy carry no `epoch` → treated as `0` in the revocation check,
matching every existing user's default `sessionEpoch = 0`, so live sessions survive the
deploy (no forced mass sign-out). The first password change/reset/deletion after deploy
bumps the epoch and revokes as intended.

**Residual window (stated explicitly):** a pre-deploy token for a user who never triggers
a bump remains valid until its natural expiry — revocation is not retroactive; it becomes
possible from the first bump onward. Acceptable: any user who suspects compromise resets
their password, which *is* a bump.

## Security note

This closes the window where a leaked/hijacked session outlives the user's remediation. It
does **not** shorten the token lifetime for the normal case, and it is not a substitute for
the reset flow itself — it is what makes that flow actually protective.

## Testing

- `test/lib/auth/session-epoch.test.ts` — **new**, the core matrix on the pure helper:
  matching epoch + no `deletedAt` → valid; mismatched epoch → revoked; `deletedAt` set →
  revoked; missing row (`null`) → revoked; missing/non-numeric token epoch treated as `0`
  (valid against `sessionEpoch = 0`, revoked against `1`).
- `test/lib/auth/change-password.test.ts` — assert the success-path `user.update` includes
  `sessionEpoch: { increment: 1 }`.
- New/extended reset-route coverage — the `user.update` includes the epoch bump.
- `softDeleteAccount` coverage — the `deletedAt` update includes the epoch bump (this is
  what keeps pre-deletion tokens dead after `scripts/reactivate-account.ts` clears
  `deletedAt` — assert it, since the spec claims it).
- `changePassword` action coverage — on success, `signOut` is called with
  `redirectTo: "/sign-in?passwordChanged=1"`; on failure it is not.
- Guards — `redirectIfAuthenticated` does **not** redirect for a `null` session, and does
  redirect only when `user.id` is present.

Run `npm run test:run` and `npm run build`; both must pass before commit. Verify the
migration with `prisma migrate status`. Manual QA: sign in on two browsers, change the
password in one → the other is signed out on its next navigation **without a redirect
loop**, and the changing browser lands on `/sign-in` with the banner.

## Out of scope

- Spoofable client IP (separate spec: `trusted-client-ip-spec.md`).
- Verify-email namespace guard (separate spec: `verify-email-reject-reset-token-spec.md`).
- Security response headers (separate spec: `security-headers-spec.md`).
- Per-device "sign out everywhere" UI and active-session listing.
- Redis-cached epoch lookups (only if the per-read PK lookup ever shows up in practice).
