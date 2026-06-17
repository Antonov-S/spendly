# Email Verification Flag

## Overview

Add an environment-variable flag that enables or disables email verification enforcement. When disabled, registration skips sending the verification email and sign-in accepts unverified accounts immediately. This lets the app be used fully during development without a verified Resend sender domain.

The flag defaults to **enabled** (no env var set = verification on) so production is safe without any extra configuration. Setting `EMAIL_VERIFICATION_ENABLED=false` in `.env` turns it off.

## Why an Environment Variable

- No code change required to toggle — flip the value and restart.
- Clearly separates dev behaviour from prod: `.env` gets `false`, production env gets nothing (or `true`).
- Consistent with how `RESEND_API_KEY` and `AUTH_SECRET` are already managed.
- The `system-constants.ts` pattern already reads env vars into named constants, so the flag fits naturally there.

## Behaviour When Disabled (`EMAIL_VERIFICATION_ENABLED=false`)

| Surface | Change |
|---------|--------|
| Registration | Skip token creation and Resend call. Redirect to `/sign-in` as if already verified. |
| Credentials sign-in | Skip `emailVerified` check — unverified users sign in normally. |
| `/verify-email` page | Still renders (tokens issued while the flag was on may still need consuming). |
| Resend endpoint (`POST /api/auth/resend-verification`) | Still works; guard at the call site so no new tokens are issued when flag is off. |

## Behaviour When Enabled (default)

No change from the current implementation.

## Files to Modify

1. **`src/lib/system-constants.ts`** — Add:
   ```ts
   export const EMAIL_VERIFICATION_ENABLED =
     process.env.EMAIL_VERIFICATION_ENABLED !== "false";
   ```
   Intentionally reads `!== "false"` so that anything other than the string `"false"` (including undefined) keeps verification on.

2. **`src/lib/auth/register.ts`** — Wrap the `createVerificationToken` + `sendVerificationEmail` block in `if (EMAIL_VERIFICATION_ENABLED)`.

3. **`src/lib/auth/credentials.ts`** — Wrap the `emailVerified` null-check in `if (EMAIL_VERIFICATION_ENABLED)`.

4. **`src/components/auth/register-form.tsx`** (or wherever the post-register redirect lives) — When the flag is off, redirect to `/sign-in` instead of `/verify-email`. The server action / API response should include a flag in its return value so the client can branch, or the register page can read `EMAIL_VERIFICATION_ENABLED` server-side and pass it as a prop to the form.

5. **`src/app/api/auth/resend-verification/route.ts`** — Wrap the user lookup + `createVerificationToken` + `sendVerificationEmail` block in `if (EMAIL_VERIFICATION_ENABLED)` so no new tokens are issued when the flag is off. (Listed under "Behaviour When Disabled" above; called out here so it isn't missed during implementation.)

6. **`.env.example`** — Add:
   ```
   # Set to false to skip email verification (useful when no Resend domain is configured)
   EMAIL_VERIFICATION_ENABLED=true
   ```

7. **`.env`** (local dev, not committed) — Set `EMAIL_VERIFICATION_ENABLED=false`.

## Key Details

- **Single source of truth:** the flag lives only in `system-constants.ts`. No inline `process.env` reads in action files.
- **Server-only reads:** `system-constants.ts` is already `server-only`-safe (not imported by client bundles). No leakage to the browser.
- **Post-register redirect:** because `register-form.tsx` is a client component, the redirect decision must be passed in as a prop from the parent server component (`/register/page.tsx`), which can safely read `EMAIL_VERIFICATION_ENABLED` at render time.
- **Existing verified users:** the flag does not retroactively change `emailVerified` on any user — it only skips enforcement. If you turn it back on, previously-registered-but-unverified users will be blocked again until they verify.
- **OAuth users:** unaffected — Google sets `emailVerified` automatically regardless of the flag.

## Testing

### Unit (Vitest)

- `registerUser` with flag **off** — does not call `createVerificationToken` or `sendVerificationEmail`; returns success.
- `registerUser` with flag **on** — calls both (existing tests, should continue to pass).
- `verifyCredentials` with flag **off** — succeeds for a user whose `emailVerified` is null.
- `verifyCredentials` with flag **on** — rejects user with null `emailVerified` (existing test, should continue to pass).

Mock `EMAIL_VERIFICATION_ENABLED` at the module boundary using `vi.mock` / `vi.stubEnv` or by exporting a helper that can be overridden in tests.

### Manual

1. Set `EMAIL_VERIFICATION_ENABLED=false`, restart, register a new account — verify redirect goes to `/sign-in`, no email sent.
2. Sign in with that account immediately — verify it succeeds.
3. Set `EMAIL_VERIFICATION_ENABLED=true`, restart, register again — verify redirect goes to `/verify-email` and email is sent (Resend dashboard or logs).
4. Attempt sign-in before verifying — verify it is blocked.

## Out of Scope

- A UI toggle in settings (env var is sufficient for the dev use-case).
- Per-user verification bypass.
- Automatically marking existing unverified users as verified when the flag is turned off.
