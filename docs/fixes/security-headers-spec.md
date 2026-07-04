# Spec: Add security response headers

## Status

✅ Shipped — Stage A (`feature/security-headers`). Baseline headers **enforced** +
CSP shipped as **`Content-Security-Policy-Report-Only`** + the log-only
`POST /api/csp-report` sink, all app-wide via `next.config.ts`. **Stage B (flip the
CSP header name to enforce) is intentionally deferred** — it is gated on a clean
Report-Only window verified in real Chrome (Google OAuth incl. the no-JS form-POST
path + the Stripe round-trip) and a preview-deploy soak, per §2/§3.

**Verified (Playwright / Chromium, `next start`):** all five baseline headers present
on page + API responses; CSP present as Report-Only with the exact candidate policy;
report sink returns 204 on well-formed / malformed / empty bodies and logs a compact
one-line summary; the injected-violation pipe reaches the sink. **Load-bearing check
passed:** clicking "Continue with Google" redirected to `accounts.google.com` with
**zero `form-action` violations** — the `form-action 'self' https://accounts.google.com`
allowance is correct. Authenticated sweep (dashboard, reports SVG charts, budgets,
transactions, goals, settings, transaction drawer) produced **zero** CSP reports.
No `eval`/`new Function` exists in `src/`; a stray `eval`/RSC-prefetch report seen only
during transitional `chrome-error` navigations (caused by a local `AUTH_URL=:3000`
mismatch, not present on a correct deploy) did not reproduce during clean browsing —
so **no policy change was made**, and `'unsafe-eval'` was deliberately **not** added.

**Still requires a real-Chrome manual pass before Stage B:** completing an actual
Google login, the JS-disabled form-POST path, the Stripe Checkout/Portal round-trip,
and watching `/api/csp-report` over a preview soak.

## Problem

[next.config.ts](next.config.ts) sets no HTTP security response headers. The app ships
none of the standard browser-side hardening a personal-finance app should have:

- **No `X-Frame-Options` / CSP `frame-ancestors`** — the app can be framed by any origin.
  With one-click Server Actions on every data surface, this is a clickjacking exposure
  (a hostile page frames `/transactions` or `/settings` and tricks a signed-in user into
  clicking through a destructive action).
- **No `Content-Security-Policy`** — no defense-in-depth ceiling on script/resource
  origins if an injection ever slips through.
- **No `X-Content-Type-Options: nosniff`** — browsers may MIME-sniff responses.
- **No `Referrer-Policy`** — full URLs can leak to third parties via the `Referer`
  header.

HSTS is supplied by Vercel at the edge on production deployments, but everything above is
the application's responsibility.

**Severity:** Medium (from the 2026-07-03 security review, finding #3). Low effort, broad
coverage.

## Goal

Emit a conservative, app-wide set of security headers on every response via Next.js's
`headers()` config. Start strict where it's safe (framing, sniffing, referrer) and adopt
CSP in **Report-Only** first so a policy can be tuned against the real app (Stripe,
Google OAuth, Resend, the inline styles Next injects) before it enforces.

Non-goals: HSTS (edge-provided), Permissions-Policy fine-tuning beyond a sensible default,
per-route header variation.

## Approach

### 1. Baseline headers — enforce immediately

These are safe to turn on without breaking the app. Add a `headers()` async function to
`next.config.ts` applying to all routes (`source: "/:path*"`):

| Header | Value | Rationale |
| --- | --- | --- |
| `X-Frame-Options` | `DENY` | No framing (legacy backstop for CSP `frame-ancestors`). |
| `X-Content-Type-Options` | `nosniff` | No MIME sniffing. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Don't leak full paths cross-origin. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Deny device APIs the app never uses. |
| `X-DNS-Prefetch-Control` | `off` | Minor privacy hardening. |

```ts
// next.config.ts
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
```

### 2. CSP — ship Report-Only first

A full CSP on a Next.js App Router app needs care: Next injects inline `<style>` and, in
some cases, inline bootstrap scripts. The third-party integrations, checked against the
actual code, need **less** than a generic Stripe/OAuth app would:

- **Stripe** — there is no client-side Stripe.js anywhere (`loadStripe` / `js.stripe.com`
  have zero references). Checkout and the Customer Portal are Server Actions that
  `redirect()` to Stripe — top-level navigations, which CSP does not govern. No
  `frame-src`, `connect-src`, or `form-action` allowance for Stripe is needed; the app
  uses no iframes at all, so `frame-src 'none'` is the honest value. (If Stripe Elements
  are ever embedded, Report-Only will surface the needed origins.)
- **Google OAuth** — the one integration that DOES need an allowance.
  `src/components/auth/google-button.tsx` submits sign-in as a real
  `<form action={signInWithGoogle}>`; in the no-JS/progressive-enhancement path that is a
  genuine form POST whose 303 redirect lands on `accounts.google.com`, and **Chrome
  applies `form-action` to post-submission redirects**. A bare `form-action 'self'` could
  silently break Google sign-in at enforce time — this is the specific thing Stage A must
  confirm.
- **Resend** — server-side only, no browser origin, no directive needed.

Because a wrong `script-src` silently breaks the app, adopt CSP in two stages:

**Stage A — `Content-Security-Policy-Report-Only`** with a candidate policy. It never
blocks; it only surfaces violations, so the real policy can be tuned against production
traffic. Candidate starting point:

```
default-src 'self';
script-src 'self' 'unsafe-inline';        /* tighten to nonces/hashes if feasible */
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;              /* Google avatar images, data: favicons */
font-src 'self';
connect-src 'self';
frame-src 'none';
frame-ancestors 'none';
object-src 'none';
base-uri 'self';
form-action 'self' https://accounts.google.com;   /* Chrome: form-action governs the OAuth POST's redirect */
report-uri /api/csp-report;
```

**Reporting endpoint (required for Stage A to mean anything):** without a
`report-uri`/`report-to` destination, violations only ever appear in the console of
whoever is browsing — real users' violations vanish, and the Stage B gate ("zero
legitimate violations") would be checking a signal that mostly doesn't exist. Add a tiny
log-only `POST /api/csp-report` route (fits the existing "API routes for render-cycle
exceptions" rule — a browser-initiated report can't be a Server Action): accept the
`application/csp-report` body, log a compact one-line summary (blocked-uri, violated
directive, document-uri — no PII beyond what the browser sends), always return 204. No
auth (browsers post reports without credentials), but cap body size and tolerate
malformed JSON silently.

**Stage B** — after a clean Report-Only window (no legitimate violations logged at
`/api/csp-report` and none in manual browser passes), flip the header name to
`Content-Security-Policy` to enforce. `frame-ancestors 'none'` then supersedes
`X-Frame-Options` (kept as the legacy backstop). Keep `report-uri` in the enforced
policy so any future regression stays visible.

Document that `frame-ancestors` and `form-action` **cannot** be set via `<meta>` — they
must be response headers, which is why this lives in `next.config.ts`, not a layout.

> **Note on `'unsafe-inline'` in `script-src`:** it weakens XSS defense-in-depth. The app
> currently has no `dangerouslySetInnerHTML`/`eval` (verified in the review), so the
> immediate risk is low, but a nonce-based policy is the stronger end state. Nonces
> require wiring a per-request nonce through the Next.js response (middleware +
> `headers()`); tracked as a follow-up, not blocking Stage A.

### 3. Verify the CSP against the three integrations

Before Stage B, exercise in the browser with the console open (Report-Only logs
violations to the console AND posts them to `/api/csp-report`):

- **Stripe** — open `/settings`, start Checkout, return; start the Customer Portal.
  Expect **zero** violations (top-level redirects, no embedded assets) — a violation here
  means an embedded Stripe asset exists that the code audit missed.
- **Google OAuth** — run the Google sign-in flow in **Chrome specifically**, and once
  with JavaScript disabled (the raw form-POST path): confirm the `form-action
  https://accounts.google.com` allowance covers the redirect and no violation is
  reported.
- **Avatars** — a Google-OAuth user's profile image renders (`img-src https:`).
- **General** — dashboard, reports (inline SVG charts), and drawers render with no CSP
  console errors and nothing logged at `/api/csp-report`.

Per project convention, the user reviews UI in their own browser — do not screenshot.

## Affected files

| File | Change |
| --- | --- |
| `next.config.ts` | add `headers()` with baseline headers + CSP (Report-Only first) |
| `src/app/api/csp-report/route.ts` | new log-only report sink: parse, log one line, return 204 |

No schema change, no migration, no new dependency. The only runtime addition is the
report sink route (no reads, no writes, no auth).

## Backward compatibility

Baseline headers are additive and safe. CSP in Report-Only mode changes nothing
user-visible; only Stage B (enforce) can affect rendering, which is why it's gated on a
clean Report-Only run.

## Testing

Headers aren't unit-testable under the project's Vitest scope (config, not
`src/lib`/`src/actions`). Verify manually:

- `curl -sI https://<deploy>/dashboard` shows the baseline headers and the CSP
  (Report-Only in Stage A).
- Browser console shows no CSP violations across the flows in step 3 before flipping to
  enforce.
- `curl -s -X POST https://<deploy>/api/csp-report -H "Content-Type: application/csp-report" -d '{}'`
  returns 204 (and a malformed body doesn't 500).

`npm run build` must pass (a malformed `headers()` fails the build).

## Out of scope

- HSTS (Vercel edge-provided).
- Nonce-based CSP replacing `'unsafe-inline'` (follow-up hardening).
- Subresource Integrity.
- The other three review findings (separate specs: `trusted-client-ip-spec.md`,
  `verify-email-reject-reset-token-spec.md`, `jwt-session-revocation-spec.md`).
