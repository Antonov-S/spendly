# Fix: Contextual Email-Verification Resend Link on Sign-In

## Overview

The sign-in page shows a permanent **"Haven't verified your email? Resend the link"** prompt under the password field. It is rendered unconditionally for every visitor. This is wrong on two counts:

1. **Off the happy path.** Most people signing in are already verified. A permanently visible "haven't verified?" prompt is noise that implies a problem the majority of users don't have.
2. **Shown even when verification is disabled.** The whole verification system is gated behind `EMAIL_VERIFICATION_ENABLED` (`false` in local dev), yet the link renders regardless — pointing users at a flow that does nothing. This violates the project's "never UI without backing function" principle.

The fix makes the link **contextual**: render it only when email verification is actually enabled, and only after a failed sign-in attempt (the one moment a stuck, unverified user needs it).

## Not a Security Issue (for the record)

This is a UX fix, not a security fix. The resend endpoint is already enumeration-safe:

- `POST /api/auth/resend-verification` always returns `{ success: true }` regardless of whether the email exists or is already verified, and only sends mail when an unverified account actually exists.
- The sign-in error in `src/actions/auth.ts` is intentionally vague ("Invalid email or password, or your email isn't verified yet"), so it does not leak account state.

No backend change is required. The static link only ever exposed that the app uses email verification, which is not sensitive.

## Current Behaviour

- `src/components/auth/sign-in-form.tsx` renders the resend `<p>` / `<Link href="/verify-email">` block unconditionally (always visible, even with verification disabled).

### Audit — Sign-In Is the Only Change Point

All verification/resend surfaces were reviewed; the off-happy-path prompt exists in exactly one place:

| Surface | Shows | Verdict |
|---------|-------|---------|
| `sign-in-form.tsx` | Permanent "Haven't verified your email? Resend the link" | Fix here |
| `verify-email/page.tsx` | The verification page itself (hosts the resend form) | Leave — legitimate destination; intentionally **not** gated by the flag so already-issued tokens can still be consumed after a flag flip |
| `register-form.tsx` | No standalone prompt — redirects to `/verify-email` after register, already gated on `emailVerificationEnabled` | Leave — already contextual |

Note: with the flag off, `/verify-email` is still directly reachable and its resend form becomes a harmless no-op (endpoint returns generic success, sends nothing). Redirecting that page away when the flag is off is **out of scope** for this fix.

## Desired Behaviour

| Condition | Resend link |
|-----------|-------------|
| `EMAIL_VERIFICATION_ENABLED` is **false** | Never shown. |
| Verification enabled, clean first render (no error) | Hidden — keep the happy path clean. |
| Verification enabled, after a failed sign-in (`state.error` set) | Shown, so an unverified user has a path forward. |

## Files to Modify

1. **`src/app/sign-in/page.tsx`** — Read `EMAIL_VERIFICATION_ENABLED` server-side and pass it to `<SignInForm emailVerificationEnabled={...} />`. (Same prop-threading pattern already used for the register form per the email-verification-flag spec.)

2. **`src/components/auth/sign-in-form.tsx`**
   - Add `emailVerificationEnabled?: boolean` to `SignInFormProps`.
   - Wrap the resend-link block in a guard: render only when `emailVerificationEnabled && state.error`.

## Key Details

- **Flag stays the single source of truth.** The client form never reads `process.env`; the value is passed as a prop from the server component, consistent with `register-form.tsx`.
- **No backend changes.** The resend endpoint and the sign-in action are unchanged.
- **No new constants.** `EMAIL_VERIFICATION_ENABLED` already exists in `src/lib/system-constants.ts`.
- **Gating on `state.error`** reuses the existing `useActionState` error already wired into the form — no new state.

## Testing

### Unit (Vitest)

No new server-action or utility logic is introduced, so no new unit tests are required (the change is presentational/prop-gated in a client component, which is out of test scope per coding standards). Existing auth tests must continue to pass.

### Manual

1. `EMAIL_VERIFICATION_ENABLED=false`, restart — go to `/sign-in`: resend link is **not** present.
2. `EMAIL_VERIFICATION_ENABLED=true`, restart — go to `/sign-in`: resend link is **not** shown on first load.
3. Same, enabled — submit wrong credentials: error appears **and** the resend link now appears.
4. Click the link — lands on `/verify-email` as before.

## Out of Scope

- Any change to the resend endpoint or its enumeration protection.
- Inline resend (submitting the email without leaving the sign-in page).
- Changing the sign-in error copy.
