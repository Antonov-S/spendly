# Fix: OAuthAccountNotLinked Error — Friendly Messaging on Sign-In

## Overview

When a user who registered via email/password tries to sign in with Google OAuth using the same email address, NextAuth v5 redirects them to `/sign-in?error=OAuthAccountNotLinked`. This is intentional NextAuth security behaviour — it refuses to automatically link a Google identity to an existing credentials account to prevent account takeover.

The problem is the sign-in page has no handling for this `?error` query parameter, so the user lands on a clean sign-in form with no explanation of what went wrong. They see no error, no guidance, and have no way to know they need to use email/password instead.

## Current Behaviour

1. User registers with email + password.
2. User clicks "Continue with Google" on the sign-in page.
3. NextAuth blocks the OAuth attempt and redirects to `/sign-in?error=OAuthAccountNotLinked`.
4. Sign-in page renders with no visible error — the `?error` param is silently ignored.
5. User is confused.

## Desired Behaviour

When `?error=OAuthAccountNotLinked` is present in the URL:

- Show a clear, actionable inline message above the form:
  > "This email is already registered with a password. Please sign in with your email and password instead."
- No other changes. No auto-linking, no new API routes, no new pages.

The message style should match the existing `justDeleted` info banner pattern (neutral background, `border-line`, `text-ink-2`) — it is informational, not an error the user caused.

## What We Are Not Doing

- **No `allowDangerousEmailAccountLinking`** — auto-linking is a security tradeoff and not needed here; the nudge to use email/password is sufficient.
- **No handling of other `?error` values** — NextAuth can emit `OAuthSignin`, `OAuthCallback`, `Callback`, `AccessDenied`, etc. Those are not in scope. Only `OAuthAccountNotLinked` gets a named message; other error values remain silently ignored (no generic fallback).
- **No changes to the Google OAuth flow or NextAuth config.**
- **No new server actions or API routes.**

## Files to Modify

### 1. `src/app/sign-in/page.tsx`

`searchParams` already exists and is destructured. Add `error` to the destructured set and pass it as a new prop to `<SignInForm>`.

```tsx
const { registered, verified, deleted, error } = await searchParams;

<SignInForm
  ...
  oauthError={error === "OAuthAccountNotLinked" ? "OAuthAccountNotLinked" : undefined}
/>
```

The page narrows the value to the one error type this component handles, so the form never needs to parse raw NextAuth error strings.

### 2. `src/app/sign-in/page.tsx` — `SearchParams` interface

Add `error?: string` to `SignInPageProps.searchParams`.

### 3. `src/components/auth/sign-in-form.tsx`

- Add `oauthError?: "OAuthAccountNotLinked"` to `SignInFormProps`.
- Render the info banner when `oauthError === "OAuthAccountNotLinked"`, using the same visual pattern as the `justDeleted` banner (neutral, not red):

```tsx
{oauthError === "OAuthAccountNotLinked" && (
  <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-2">
    This email is already registered with a password. Please sign in with
    your email and password instead.
  </p>
)}
```

Place it at the top of the form output, alongside the other status banners (`justDeleted`, `justVerified`, `justRegistered`).

## Key Details

- **No new constants.** The string `"OAuthAccountNotLinked"` is a NextAuth-defined value, not a magic string we own — it lives only in the narrowing check in the page component.
- **No new state.** The banner is derived entirely from the `oauthError` prop (a server-side URL param), consistent with all existing status banners.
- **Prop is narrowed at the page boundary.** The form receives a typed literal union, not a raw string — same principle as `emailVerificationEnabled` passed from the server component.

## Testing

### Unit (Vitest)

No new server-action or utility logic is introduced. No new unit tests required. Existing auth tests must continue to pass.

### Manual

1. Register an account with email + password (e.g. `test@example.com`).
2. Sign out.
3. On the sign-in page, click "Continue with Google" and complete the Google OAuth flow with the same email address.
4. You should land back on `/sign-in?error=OAuthAccountNotLinked` with the info banner visible:
   > "This email is already registered with a password. Please sign in with your email and password instead."
5. Enter email + password — sign-in succeeds as normal.
6. Verify that `/sign-in` with no `?error` param (fresh load) shows no banner.
7. Verify that `/sign-in?error=SomeOtherError` shows no banner (out of scope values are ignored).
