import "server-only";
import Stripe from "stripe";

/**
 * Lazy Stripe singleton. Mirrors the rate-limit pattern (build on first use,
 * throw only when actually called) rather than the Prisma pattern (throw at
 * import) so the build and unrelated routes never fail just because Stripe env
 * is absent in an environment that doesn't bill.
 */
let stripe: Stripe | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — required for Stripe billing.`);
  }
  return value;
}

export function getStripe(): Stripe {
  if (stripe) return stripe;
  // apiVersion MUST equal the version the installed `stripe` major pins. The
  // field is a literal union, so a mismatch is a compile error — the desired
  // tripwire on a future SDK bump (see stripe-billing-spec §3 / the Basil note:
  // current_period_end moved to subscription.items.data[i], which we never read).
  stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
    apiVersion: "2026-05-27.dahlia",
  });
  return stripe;
}

/**
 * Period → Stripe price-ID resolver. Functions (not eager reads) so a missing
 * price ID throws only when a checkout is actually attempted, never at import.
 */
export const STRIPE_PRICE_IDS = {
  monthly: () => requireEnv("STRIPE_PRICE_ID_MONTHLY"),
  yearly: () => requireEnv("STRIPE_PRICE_ID_YEARLY"),
} as const;

export type BillingPeriod = keyof typeof STRIPE_PRICE_IDS; // "monthly" | "yearly"
