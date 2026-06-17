# Rate Limiting for Auth

## Overview

Implement rate limiting on authentication endpoints to prevent brute force attacks, credential stuffing, and abuse of email-sending endpoints.

## Requirements

- Add rate limiting to auth-related API routes
- Use Upstash Redis with `@upstash/ratelimit` for serverless-compatible limiting
- Create reusable rate limiting utility
- Return appropriate error responses (429 Too Many Requests)
- Display user-friendly error messages on the frontend

## Endpoints to Protect

| Endpoint                                 | Limit      | Window | Key By     |
| ---------------------------------------- | ---------- | ------ | ---------- |
| `/api/auth/callback/credentials` (login) | 5 attempts | 15 min | IP + email |
| `/api/auth/register`                     | 3 attempts | 1 hour | IP         |
| `/api/auth/forgot-password`              | 3 attempts | 1 hour | IP         |
| `/api/auth/reset-password`               | 5 attempts | 15 min | IP         |
| `/api/auth/resend-verification`          | 3 attempts | 15 min | IP + email |

## Implementation

- Create `src/lib/rate-limit.ts` utility with Upstash client
- Use sliding window algorithm for smooth limiting
- Extract IP from `x-forwarded-for` header (Vercel) or request
- Combine IP + identifier (email) where applicable for tighter limits
- Return `{ success, remaining, reset }` from rate limit checks

### Per-endpoint application

Two distinct integration points, because NextAuth owns the credentials callback:

- **Login (`/api/auth/callback/credentials`)** — apply the check **inside the `authorize` function in `auth.ts`** (the real credentials provider lives there; `auth.config.ts` only holds the placeholder). This is the single choke point every `signIn("credentials")` call flows through, so it cannot be bypassed, and `authorize(credentials, request)` exposes both the email (`credentials.email`) and the request headers for IP — enabling the IP + email key the table requires. Do **not** use a proxy/middleware route for login: middleware can't read the POST body cleanly, which would force IP-only keying and add a Redis round-trip to the `proxy.ts` matcher.
- **Register / forgot-password / reset-password / resend-verification** — these are plain API route handlers. Apply the check at the **top of each handler** and return a real `429` with a `Retry-After` header (see Error Handling).

### Surfacing the login rate-limit error

NextAuth v5 normalizes anything thrown in `authorize` to a generic `CredentialsSignin`, so the login path **cannot** return a clean `429` + `Retry-After`. Instead, throw a `CredentialsSignin` subclass with a custom `code` (e.g. `code = "rate_limited"`), then read the `?error=` param on the sign-in page and render a "Too many attempts — try again in X minutes" banner. This reuses the existing contextual-banner pattern already used for `OAuthAccountNotLinked`. The other four endpoints keep the real `429` + `Retry-After` response.

## Environment Variables

```
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

## Error Handling

- API returns 429 status with JSON: `{ error: "Too many attempts. Please try again in X minutes." }`
- Frontend displays error via toast notification
- Include `Retry-After` header in 429 responses

## Notes

- Upstash free tier allows 10k requests/day (sufficient for auth limiting)
- Rate limiting should fail open (allow request) if Upstash is unavailable
- Login limiting is handled inside the `authorize` function in `auth.ts`, not a proxy route (see Implementation → Per-endpoint application)
- Use modern Accessible HTML practices, Modern NextJs practices, Modern React Components practices, Modern Browser APIs practices, Modern Tailwind practices
