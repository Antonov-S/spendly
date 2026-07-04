import type { NextConfig } from "next";

/**
 * App-wide security response headers (security-headers-spec).
 *
 * `frame-ancestors` and `form-action` CANNOT be set via <meta> — they must be
 * response headers, which is why this lives here rather than in a layout.
 */
const baselineSecurityHeaders = [
  // No framing (legacy backstop for CSP `frame-ancestors`).
  { key: "X-Frame-Options", value: "DENY" },
  // No MIME sniffing.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak full paths cross-origin.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Deny device APIs the app never uses.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Minor privacy hardening.
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

/**
 * Candidate CSP, verified against the actual integrations (Stage A / §2):
 * - Stripe: no client-side Stripe.js and no iframes anywhere → `frame-src 'none'`
 *   is honest; Checkout/Portal are Server Action `redirect()`s (top-level nav CSP
 *   doesn't govern), so no Stripe directive is needed.
 * - Google OAuth: the one allowance. `google-button.tsx` submits a real
 *   `<form action={signInWithGoogle}>`; the no-JS path is a form POST whose 303
 *   lands on accounts.google.com, and Chrome applies `form-action` to a
 *   post-submission redirect → `form-action ... https://accounts.google.com`.
 * - Resend: server-side only, no browser origin.
 *
 * `img-src ... https:` covers Google avatar images. `'unsafe-inline'` in
 * `script-src` is defense-in-depth debt (no eval / dangerouslySetInnerHTML in the
 * app); a nonce-based policy is the stronger end state, tracked as a follow-up.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "report-uri /api/csp-report",
].join("; ");

/**
 * Stage A ships CSP in Report-Only: it never blocks, only surfaces violations
 * (console + POST /api/csp-report) so the policy can be tuned against real
 * traffic. Stage B flips this key to `Content-Security-Policy` to enforce, after
 * a clean Report-Only window. `frame-ancestors 'none'` then supersedes
 * `X-Frame-Options` (kept as the legacy backstop).
 */
const cspHeader = {
  key: "Content-Security-Policy-Report-Only",
  value: contentSecurityPolicy,
};

const securityHeaders = [...baselineSecurityHeaders, cspHeader];

const nextConfig: NextConfig = {
  reactCompiler: true,
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
