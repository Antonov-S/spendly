# Spec: Trust only the platform hop when deriving client IP

## Status

✅ Shipped (`fix/trusted-client-ip`)

## Problem

`getClientIp` ([src/lib/rate-limit.ts:83](src/lib/rate-limit.ts#L83)) takes the **first**
comma-separated entry of the `x-forwarded-for` header as the client IP:

```ts
const forwarded = headers.get("x-forwarded-for");
if (forwarded) {
  return forwarded.split(",")[0].trim();
}
return headers.get("x-real-ip")?.trim() || "unknown";
```

`x-forwarded-for` is a request header the client fully controls. A proxy **appends** the
real client IP to the right of any value the client already sent, so the *first* entry is
attacker-chosen, not trustworthy. An attacker can therefore send a fresh random
`X-Forwarded-For: <n>` on each request and land in a brand-new rate-limit bucket every
time — defeating every IP-keyed limiter:

- **Login** ([src/auth.ts:37-43](src/auth.ts#L37-L43)) — keyed `${ip}:${email}`. With a
  spoofable IP the attacker gets unlimited password attempts against a single account;
  bcrypt's cost is then the only brake on an online brute force.
- **Forgot-password / reset-password** (IP-keyed) — unlimited reset-email floods and
  reset-token guesses.
- **Register** (IP-keyed) — unlimited account-creation spam.

**Severity:** Medium (from the 2026-07-03 security review, finding #1).

## Goal

Derive the client IP from a value the client **cannot** forge, so the IP-keyed limiters
regain their per-origin meaning. On the deployment platform (Vercel), that means trusting
only the hop the platform itself appends — the **last** `x-forwarded-for` entry — or the
platform-set `x-real-ip`, never a client-supplied prefix.

Non-goals: changing which endpoints are rate-limited, the limit values, or the fail-open
behavior (all tracked/decided elsewhere). This is purely how the bucket key is computed.

## Approach

### 1. Read the trusted hop, not the client-supplied prefix

The number of proxy hops in front of the app is fixed and known per platform. Vercel's
edge appends exactly one hop (the true client) to the end of `x-forwarded-for` and also
sets `x-real-ip` to that same value. So:

- **Prefer `x-real-ip`** — on Vercel this is set by the platform and not
  client-forgeable. Use it directly when present.
- **Otherwise, take the LAST entry of `x-forwarded-for`** (the platform-appended hop),
  not the first.
- Fall back to `"unknown"` when neither is present (unchanged — a stable shared bucket in
  local dev, where limiting is fail-open anyway).

```ts
export function getClientIp(headers: Headers): string {
  // x-real-ip is set by the platform edge (Vercel) and is not client-forgeable.
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  // Fall back to x-forwarded-for. The platform APPENDS the true client hop to the
  // right, so the LAST entry is the trusted one; the client can prepend anything to
  // the left, so never read [0]. (Assumes exactly one trusted proxy hop — Vercel.)
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",");
    return parts[parts.length - 1].trim();
  }

  return "unknown";
}
```

### 2. Document the single-hop assumption

Add a comment stating the invariant: this trusts exactly one proxy hop (Vercel's edge).
If the app is ever fronted by an additional proxy (a WAF, a second CDN), the trusted
index changes and this must be revisited — otherwise the *new* proxy's IP becomes the
bucket and all users share it. This is the standard, unavoidable trade-off with
`x-forwarded-for`: the correct hop count is deployment-specific and cannot be
auto-detected safely.

### 3. No new constant, no schema change

The hop policy lives entirely in `getClientIp`. No `system-constants.ts` entry is needed
(there is no tunable value — it's structural).

## Affected files

| File | Change |
| --- | --- |
| `src/lib/rate-limit.ts` | `getClientIp` reads `x-real-ip` first, then the **last** `x-forwarded-for` entry |

No call-site changes: `auth.ts`, `forgot-password/route.ts`, `reset-password/route.ts`,
`register/route.ts`, and `resend-verification/route.ts` all call `getClientIp(headers)`
unchanged.

## Backward compatibility

Behavior only changes for requests carrying a multi-value `x-forwarded-for`. In
production behind Vercel the trusted value is unchanged for legitimate clients (the
platform hop was always the real IP); only spoofed prefixes stop working. In local dev
(no proxy headers) the `"unknown"` fallback is unchanged.

## Testing

Extend/add `test/lib/rate-limit.test.ts`:

- `x-real-ip` present → returned verbatim, even when `x-forwarded-for` is also present
  and holds a different (spoofed) value.
- Only `x-forwarded-for: "1.1.1.1"` → `"1.1.1.1"`.
- `x-forwarded-for: "9.9.9.9, 8.8.8.8, 203.0.113.7"` → `"203.0.113.7"` (last entry, the
  trusted hop) — the pre-fix code would have returned the spoofable `"9.9.9.9"`.
- Whitespace around entries is trimmed.
- Neither header present → `"unknown"`.

Run `npm run test:run` and `npm run build`; both must pass before commit.

## Out of scope

- JWT session revocation on password reset / deletion (separate spec:
  `jwt-session-revocation-spec.md`).
- Security response headers (separate spec: `security-headers-spec.md`).
- Making Upstash Redis a hard production requirement (the limiter still fails open when
  unconfigured — a deployment-checklist item, not a code change here).
