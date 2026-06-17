# Email Verification - Resend

## Overview

After a user registers with email/password, send them a verification email containing a unique link. The user must click the link to verify ownership of their email address. Verification is recorded by setting `User.emailVerified`. Google OAuth users are already verified by the provider and skip this flow.

Email delivery uses [Resend](https://resend.com). The `RESEND_API_KEY` already lives in `.env`. Use `onboarding@resend.dev` as the from address for now (swap to a verified domain before launch).

## Requirements

- Install the `resend` package.
- On successful email/password registration, generate a single-use verification token and email the user a verification link.
- Add a verification endpoint that consumes the token, sets `emailVerified`, and redirects to sign-in with a success indicator.
- Block credentials sign-in for users whose `emailVerified` is null, with a clear "verify your email" message.
- Provide a "resend verification email" action for users who did not receive or let their link expire.
- Tokens are single-use and expire (default 24h). Verifying or resending invalidates prior tokens for that email.

## Files to Create

1. `src/lib/email/resend.ts` — Resend client singleton (`server-only`).
2. `src/lib/email/send-verification-email.ts` — builds the link + HTML and sends via Resend.
3. `src/lib/auth/verification.ts` — `createVerificationToken(email)` and `consumeVerificationToken(token)` using the existing `VerificationToken` model.
4. `src/app/api/auth/verify-email/route.ts` — `GET` handler: validate token, set `emailVerified`, redirect to `/sign-in?verified=1`.
5. `src/app/api/auth/resend-verification/route.ts` — `POST` handler: re-issue and re-send a token for a given email.
6. `src/app/verify-email/page.tsx` — post-register screen ("Check your inbox") with a resend button.

## Files to Modify

- `src/lib/auth/register.ts` — after creating the user, create a verification token and send the email. Registration still succeeds even if the user is unverified.
- `src/lib/auth/credentials.ts` — reject sign-in when `emailVerified` is null (return null / surface a distinct reason).
- `src/app/register/page.tsx` — on success, redirect to `/verify-email` instead of `/sign-in`.
- `src/app/sign-in/page.tsx` — show a success banner when `?verified=1` is present.
- `.env.example` — already has `RESEND_API_KEY`; add `EMAIL_FROM` if we externalize the from address.

## Data Model

No schema change required. Reuse the existing NextAuth models:

- `User.emailVerified` (`DateTime?`) — set to `now()` on successful verification.
- `VerificationToken` (`identifier`, `token`, `expires`) — `identifier` = email, `token` = random token, `expires` = now + TTL. Stored as-is, matching the NextAuth adapter convention.

## Key Details

- **Token generation:** use `crypto.randomBytes(32).toString("hex")` for the token; store it directly and look it up by value on verification.
- **Single-use + expiry:** delete the `VerificationToken` row on consume; reject if missing or `expires < now`.
- **From address:** `onboarding@resend.dev` (placeholder — Resend's shared sender, fine for dev/testing).
- **Link shape:** `${AUTH_URL}/api/auth/verify-email?token=<raw>`.
- **Idempotency:** creating a new token for an email first clears existing tokens for that `identifier`.
- **OAuth users:** never enter this flow — the adapter sets `emailVerified` on Google sign-in.

## Constants

Add to `src/lib/system-constants.ts`:

- `VERIFICATION_TOKEN_TTL_HOURS = 24`
- `EMAIL_FROM = "onboarding@resend.dev"`

## Testing

### Unit (Vitest — `test/lib/**`, `test/actions/**`)

- `createVerificationToken` — persists a hashed token with correct expiry; clears prior tokens for the email.
- `consumeVerificationToken` — returns the email for a valid token; rejects unknown, expired, and already-used tokens.
- `registerUser` — still succeeds and triggers the send (mock the email sender) for unverified new users.
- `verifyCredentials` — returns null when `emailVerified` is null.
- Mock `@/lib/prisma` and the Resend client at the module boundary — never hit the real API.

### Manual

1. Register a new account — verify redirect to `/verify-email` and that an email arrives.
2. Attempt sign-in before verifying — verify it is blocked with a clear message.
3. Click the email link — verify redirect to `/sign-in?verified=1` and success banner.
4. Sign in after verifying — verify it succeeds.
5. Click the same link again — verify it is rejected (single-use).
6. Use "resend verification" — verify a fresh email arrives and the new link works.
7. Google OAuth sign-in — verify it bypasses verification entirely.

## Out of Scope (Later)

- A dev toggle to enable/disable verification enforcement (similar to the `isPro` gate). For now the flow is always on. The toggle will be added later, so keep the enforcement check in `verifyCredentials` isolated enough that a single flag can short-circuit it without restructuring.

## References

- Resend Node SDK: https://resend.com/docs/send-with-nextjs
- NextAuth `VerificationToken` model: https://authjs.dev/getting-started/adapters/prisma
