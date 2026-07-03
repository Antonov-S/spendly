# Spec: Reject reset-namespace tokens in the verification consume path

## Status

✅ Shipped (2026-07-03, branch `fix/verify-email-reject-reset-token`)

## Problem

Verification and password-reset tokens share the `VerificationToken` table, distinguished
only by the `identifier` column: reset rows are namespaced `reset:<email>`, verification
rows use the bare `<email>` ([src/lib/auth/password-reset.ts:16](src/lib/auth/password-reset.ts#L16)).

`consumePasswordResetToken` guards against cross-redemption — it returns `null` when the
matched row is **not** in the reset namespace ([src/lib/auth/password-reset.ts:53](src/lib/auth/password-reset.ts#L53)).
But the mirror guard is **missing** from `consumeVerificationToken`
([src/lib/auth/verification.ts:33-52](src/lib/auth/verification.ts#L33-L52)): it looks up
the row by token hash and consumes it **without checking the namespace**.

So if a user's password-reset link (raw token) is fed to
`GET /api/auth/verify-email?token=<reset-token>`
([src/app/api/auth/verify-email/route.ts:18](src/app/api/auth/verify-email/route.ts#L18)):

1. `consumeVerificationToken` finds the row (the hash matches),
2. **deletes it** — burning the user's legitimate, unexpired reset link, and
3. returns `identifier = "reset:user@example.com"`,
4. the route then calls `prisma.user.update({ where: { email: "reset:user@example.com" } })`,
   which matches no user → throws → **500**.

Net effect: a valid reset link can be destroyed (denial of the reset flow) by anyone who
can get the raw token routed to the verify endpoint, and the endpoint 500s instead of
failing cleanly. It is the exact inverse of the case the reset side already defends
against.

**Severity:** Low (from the 2026-07-03 security review, finding #4). Contained — no
account takeover — but a real correctness/robustness hole and an asymmetry with the reset
path.

## Goal

Make `consumeVerificationToken` refuse rows that belong to the reset namespace **before**
deleting anything, exactly mirroring the guard already present on the reset side. A
reset-namespace token presented to the verification path is treated as unknown: no
deletion, `null` returned, the route redirects to `/verify-email?error=invalid`.

Non-goals: changing the shared-table design, token hashing, or TTL behavior (all correct
and unchanged).

## Approach

### 1. Export the namespace prefix

`RESET_PREFIX` is currently a module-private const in `password-reset.ts`. Export it so
the verification module reuses the single source of truth instead of re-typing the
`"reset:"` literal:

```ts
// src/lib/auth/password-reset.ts
export const RESET_PREFIX = "reset:";
```

### 2. Guard in `consumeVerificationToken` — before the delete

```ts
// src/lib/auth/verification.ts
import { RESET_PREFIX } from "@/lib/auth/password-reset";

export async function consumeVerificationToken(
  token: string
): Promise<string | null> {
  const hashed = hashToken(token);
  const record = await prisma.verificationToken.findUnique({
    where: { token: hashed },
  });
  // A reset-namespace token must never be redeemable here — reject WITHOUT deleting,
  // so a misrouted reset link isn't burned and the route doesn't 500 on the bad email.
  if (!record || record.identifier.startsWith(RESET_PREFIX)) {
    return null;
  }

  await prisma.verificationToken.delete({ where: { token: hashed } });

  if (record.expires < new Date()) {
    return null;
  }

  return record.identifier;
}
```

The key ordering point: the namespace check is **before** `delete`, so a valid reset row
is left intact (unlike the reset side, which deletes-then-validates because a genuine
reset token *should* be single-use-consumed there).

### 3. No import cycle

`verification.ts` importing a plain `const` from `password-reset.ts` introduces no cycle
(`password-reset.ts` does not import `verification.ts`). If a cycle is later a concern,
lift `RESET_PREFIX` into a shared `src/lib/auth/token-namespace.ts`; not necessary now.

## Affected files

| File | Change |
| --- | --- |
| `src/lib/auth/password-reset.ts` | `export` the existing `RESET_PREFIX` const |
| `src/lib/auth/verification.ts` | reject `reset:`-namespaced rows before delete |

No route changes — `verify-email/route.ts` already handles `null` (redirects to
`/verify-email?error=invalid`), which is now the correct outcome instead of a 500.

## Backward compatibility

No behavior change for legitimate verification tokens (bare-email identifier — the guard
never trips). No schema change. No migration.

## Testing

Extend [test/lib/auth/verification.test.ts](test/lib/auth/verification.test.ts):

- A row whose `identifier` starts with `reset:` → `consumeVerificationToken` returns
  `null` **and** `prisma.verificationToken.delete` is **not** called.
- A bare-email verification row still round-trips (delete called, identifier returned).
- Unknown and expired tokens still return `null` (regression guard).

Optionally add a symmetry assertion in
[test/lib/auth/password-reset.test.ts](test/lib/auth/password-reset.test.ts) noting the
two guards are now mirror images.

Run `npm run test:run` and `npm run build`; both must pass before commit.

## Out of scope

- Spoofable client IP in the rate limiter (separate spec: `trusted-client-ip-spec.md`).
- JWT session revocation (separate spec: `jwt-session-revocation-spec.md`).
- Any change to the reset-side consume logic (it is already correct).
