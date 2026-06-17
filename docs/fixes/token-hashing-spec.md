# Spec: Hash verification & password-reset tokens at rest

## Status

Not Started

## Problem

`createVerificationToken` ([src/lib/auth/verification.ts:15](src/lib/auth/verification.ts#L15)) and
`createPasswordResetToken` ([src/lib/auth/password-reset.ts:25](src/lib/auth/password-reset.ts#L25))
generate a 256-bit token with `randomBytes(32).toString("hex")` and store that **raw**
value directly in `VerificationToken.token`. The consume functions look the row up by
the raw value.

Because the stored value equals the value in the emailed link, any read access to the
database (SQL injection, leaked backup, compromised DB credentials) turns every pending
link into a working credential. A live password-reset token grants full account takeover
within its 1-hour TTL — no brute force required, the token is sitting in the row.

**Severity:** High (from the 2026-06-14 auth audit).

## Goal

Store only a one-way hash of each token. Email the raw token in the link (unchanged
URLs). On consume, hash the incoming raw token and look the row up by the hash. A DB
reader never sees a usable token.

Non-goals: token entropy (already 256-bit, fine), TTL/single-use behavior (already
correct), rate limiting (tracked separately, deliberately out of scope).

## Approach

### 1. Shared hash helper

Add a small server-only helper used by both flows. SHA-256 is the right tool here — the
input already has 256 bits of entropy, so it is not brute-forceable and we do not need a
slow KDF (unlike passwords). Keep it in one place so both flows stay identical.

New file `src/lib/auth/token-hash.ts`:

```ts
import "server-only";
import { createHash } from "crypto";

/**
 * One-way hash for verification / password-reset tokens before they are stored.
 * The raw token (256-bit random) goes in the emailed link; only this hash is
 * persisted, so a database reader can never redeem a pending link.
 */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
```

### 2. Verification flow — `src/lib/auth/verification.ts`

- `createVerificationToken`: generate `rawToken` as today, store `hashToken(rawToken)`
  in `token`, **return `rawToken`** (the link value).
- `consumeVerificationToken`: hash the incoming token first, then `findUnique` /
  `delete` by the hash instead of the raw value.

```ts
const rawToken = randomBytes(32).toString("hex");
const token = hashToken(rawToken);
// ...store `token`, return `rawToken`

// consume:
const hashed = hashToken(token); // `token` arg is the raw value from the URL
const record = await prisma.verificationToken.findUnique({ where: { token: hashed } });
// ...delete by `{ token: hashed }`
```

### 3. Password-reset flow — `src/lib/auth/password-reset.ts`

Identical change. The `identifier` namespacing (`reset:` prefix) is unaffected — only
the `token` column value changes from raw to hashed. The `startsWith(RESET_PREFIX)`
guard still runs against `record.identifier` after lookup.

### 4. No schema change

`VerificationToken.token` is already a unique `String`. A 64-char SHA-256 hex digest
fits the existing column and keeps the `@unique` lookup. No Prisma migration required.

## Affected files

| File | Change |
| --- | --- |
| `src/lib/auth/token-hash.ts` | **new** — `hashToken` helper |
| `src/lib/auth/verification.ts` | store/lookup by hash, return raw |
| `src/lib/auth/password-reset.ts` | store/lookup by hash, return raw |

No call-site changes: `verify-email/route.ts`, `reset-password/route.ts`,
`forgot-password/route.ts`, `resend-verification/route.ts`, and `register.ts` all pass
the raw token through unchanged. The contract (create returns the link token, consume
takes the link token) is preserved.

## Backward compatibility

Any tokens already issued before deploy were stored raw and will no longer match (their
hash won't equal the stored raw value), so outstanding links silently become invalid.
Acceptable: TTLs are short (24h verification, 1h reset) and users re-request. No data
migration needed — pre-existing rows expire and get cleared by the next `deleteMany`.

## Testing

Extend existing suites — [test/lib/auth/verification.test.ts](test/lib/auth/verification.test.ts)
and [test/lib/auth/password-reset.test.ts](test/lib/auth/password-reset.test.ts):

- The value passed to `prisma.verificationToken.create` (`data.token`) is **not** equal
  to the returned raw token — i.e. the stored value is hashed.
- The stored value equals `sha256(returnedRawToken)` (assert against a known hash).
- `consume(rawToken)` round-trips: a token created in the mock and looked up by hash
  resolves to the right identifier/email.
- `consume` queries `findUnique`/`delete` with the **hashed** value, not the raw one.
- Expired and unknown tokens still return `null`.
- Reset namespace guard still rejects a verification-namespace token.

Run `npm run test:run` and `npm run build`; both must pass before commit.

## Out of scope

- Rate limiting on auth endpoints (planned separately, not yet implemented).
- TOCTOU atomic-consume refactor (audit Medium #6) — independent change.
- Migrating password hashing to Argon2id (audit Low #2).
