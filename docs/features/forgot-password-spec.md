# Forgot Password / Password Reset

## Overview

Let a user who has forgotten their password request a reset link by email, then set a new password by clicking that link. The flow mirrors the existing email-verification flow and reuses the same `VerificationToken` model and Resend email infrastructure.

Only credentials accounts (users with a `password`) can reset. OAuth-only accounts (Google, no `password`) silently do nothing — they never had a password to reset. To avoid account enumeration, the request endpoint always returns a generic success regardless of whether the email exists.

Email delivery uses the existing [Resend](https://resend.com) client (`src/lib/email/resend.ts`). From address is `EMAIL_FROM` (`onboarding@resend.dev`), same as verification.

## Requirements

- Add a "Forgot password?" link on the sign-in form.
- A `/forgot-password` page where the user enters their email to request a reset link.
- A request endpoint that issues a single-use, short-lived reset token and emails a reset link — always returning generic success (no enumeration).
- A `/reset-password` page that reads the token from the URL and lets the user set a new password (with confirmation), validated to the same policy as registration.
- A reset endpoint that consumes the token, hashes and stores the new password, and invalidates the token.
- Reset tokens are single-use and expire (default **1 hour** — shorter than the 24h verification token because they grant account access).

## Reusing the `VerificationToken` Model — Namespacing

`VerificationToken` is keyed by `identifier` (email) + `token`. Email verification already stores rows with `identifier = <email>`, and `createVerificationToken` calls `deleteMany({ where: { identifier } })` to clear prior tokens. If password-reset rows used the bare email as identifier, issuing a reset token would wipe a pending verification token (and vice versa), and `consumeVerificationToken` could redeem a reset token.

**Decision:** namespace reset tokens with a `reset:` prefix on the identifier — `identifier = "reset:" + email`. This keeps reset and verification tokens in the same table without colliding, and lets each flow's `deleteMany` scope itself to its own namespace. The reset consume function strips the prefix to recover the email.

A dedicated module (`password-reset.ts`) keeps this separate from `verification.ts` so the two flows never share a code path by accident.

## Files to Create

1. `src/lib/auth/password-reset.ts` — `server-only`.
   - `createPasswordResetToken(email): Promise<string>` — `token = randomBytes(32).toString("hex")`; `identifier = "reset:" + email.trim().toLowerCase()`; `deleteMany` prior rows for that namespaced identifier; create row with `expires = now + PASSWORD_RESET_TOKEN_TTL_HOURS`; return raw token.
   - `consumePasswordResetToken(token): Promise<string | null>` — `findUnique` by token; if missing or identifier does not start with `reset:`, return null; delete the row (single-use, even if expired); if expired, return null; otherwise return the email (identifier with the `reset:` prefix stripped).
2. `src/lib/email/send-password-reset-email.ts` — `server-only`. Builds link `${baseUrl()}/reset-password?token=<raw>` and sends via Resend with subject "Reset your Spendly password". Mirror the inline-HTML style and `baseUrl()` fallback used in `send-verification-email.ts`.
3. `src/app/api/auth/forgot-password/route.ts` — `POST { email }`.
   - Validate with `forgotPasswordSchema`; on invalid input return `{ error }` 400.
   - Look up the user. **Only if** the user exists **and** has a non-null `password`, create a token and send the email.
   - **Always** return `{ success: true }` (generic) so the response is identical whether or not the email is registered.
4. `src/app/api/auth/reset-password/route.ts` — `POST { token, password, confirmPassword }`.
   - Validate with `resetPasswordSchema` (passwords match, min length). On invalid input return `{ error }` 400.
   - `consumePasswordResetToken(token)`; if null, return `{ error: "This reset link is invalid or has expired." }` 400.
   - Hash with `bcrypt` (`BCRYPT_SALT_ROUNDS`) and `prisma.user.update` the password by email.
   - Recommended: also set `emailVerified = new Date()` if currently null — clicking an emailed link proves ownership, so a reset doubles as verification.
   - Return `{ success: true }`.
5. `src/app/forgot-password/page.tsx` — server component using `redirectIfAuthenticated()` + `AuthCard`; renders a client `ForgotPasswordForm`.
6. `src/app/reset-password/page.tsx` — server component reading `searchParams.token`. If no token, render an "invalid link" state with a link back to `/forgot-password`. Otherwise render a client `ResetPasswordForm` with the token.
7. `src/components/auth/forgot-password-form.tsx` — `"use client"`. Email field; POSTs to `/api/auth/forgot-password`; on success shows the generic "If an account exists, a reset link is on its way." message. Model on `resend-verification.tsx`.
8. `src/components/auth/reset-password-form.tsx` — `"use client"`. Password + confirm-password fields; POSTs `{ token, password, confirmPassword }` to `/api/auth/reset-password`; on success shows a success message and a link to `/sign-in`. Reuse `InputFormField` / `SubmitButton`.

## Files to Modify

- `src/components/auth/sign-in-form.tsx` — add a "Forgot password?" link to `/forgot-password` (near the password field or below the form). Always visible (it is not gated by `EMAIL_VERIFICATION_ENABLED` — password reset works regardless of verification).
- `src/lib/validations/auth.ts` — add `forgotPasswordSchema` and `resetPasswordSchema` (see below).
- `src/lib/system-constants.ts` — add `PASSWORD_RESET_TOKEN_TTL_HOURS = 1`.
- `.env.example` — no new variable required (reuses `RESEND_API_KEY`, `EMAIL_FROM`, `AUTH_URL`). No change needed unless documenting the flow.

## Validation Schemas

Add to `src/lib/validations/auth.ts`, reusing `PASSWORD_MIN_LENGTH`:

```ts
export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: z
      .string()
      .min(
        PASSWORD_MIN_LENGTH,
        `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
      ),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
```

## Data Model

No schema change. Reuses existing NextAuth models:

- `VerificationToken` (`identifier`, `token`, `expires`) — reset rows use `identifier = "reset:" + email`, `token` = 32-byte hex, `expires` = now + 1h.
- `User.password` — overwritten with a fresh bcrypt hash on reset.
- `User.emailVerified` — optionally set to `now()` on reset if null (link click proves ownership).

## Key Details

- **No enumeration:** `/api/auth/forgot-password` returns identical `{ success: true }` whether or not the email maps to a credentials account. The UI message is intentionally conditional-free ("If an account exists for that email, a reset link is on its way.").
- **OAuth-only accounts:** users with `password = null` never receive a reset email (nothing to reset); the generic response hides this.
- **Single-use + expiry:** delete the token row on consume, even when expired; reject missing/expired/wrong-namespace tokens.
- **Namespace isolation:** reset functions only ever touch `reset:`-prefixed identifiers; verification functions only touch bare-email identifiers. They must not redeem each other's tokens.
- **Token in URL:** the reset token rides in the `/reset-password?token=` query for the GET page render only; the actual mutation is a POST body. This matches the spec rule against financial data in URLs — a single-use reset token is acceptable here, consistent with the existing verify-email link.
- **Send failure:** as in registration, a Resend failure must not surface a different response — log and still return generic success.
- **Short TTL:** `PASSWORD_RESET_TOKEN_TTL_HOURS = 1` because the link grants the ability to take over the account.

## Constants

Add to `src/lib/system-constants.ts`:

- `PASSWORD_RESET_TOKEN_TTL_HOURS = 1`

## Testing

### Unit (Vitest — `test/lib/**`)

- `createPasswordResetToken` — persists a `reset:`-namespaced row with correct expiry; clears prior reset rows for that email; does **not** clear bare-email verification rows.
- `consumePasswordResetToken` — returns the email for a valid reset token; rejects unknown, expired, and (critically) bare-email verification tokens; deletes the row on consume.
- Mock `@/lib/prisma` and the Resend client at the module boundary — never hit the real API or send real email.

> Endpoints (`route.ts`) are thin wrappers per the testing scope (test `src/actions/**` and `src/lib/**`); the token logic above is the contract worth covering. If reset/hash logic is extracted into a `lib` helper, test it there.

### Manual

1. From sign-in, click "Forgot password?" → reach `/forgot-password`.
2. Submit a registered credentials email → generic success message; reset email arrives.
3. Submit an unknown email and an OAuth-only email → same generic success; no email sent.
4. Click the reset link → `/reset-password` with the form; set a new password.
5. Sign in with the new password → succeeds. Sign in with the old password → fails.
6. Click the same reset link again → rejected (single-use).
7. Let a token expire (or shorten TTL) → rejected with the invalid/expired message.
8. Confirm a pending email-verification link still works after a reset token was issued for the same email (namespaces don't collide).

## Out of Scope (Later)

- Rate limiting on `/api/auth/forgot-password` (Upstash) to throttle reset-email abuse — note it as a follow-up.
- Invalidating active sessions on password change (no session table cleanup in MVP; JWT strategy is in use).
- Password strength meter / breached-password checks.
- A "your password was changed" notification email (notifications are post-MVP per project scope).

## References

- Existing verification flow: `context/features/email-verification-resend-spec.md`
- Token helpers to mirror: `src/lib/auth/verification.ts`
- Email sender to mirror: `src/lib/email/send-verification-email.ts`
