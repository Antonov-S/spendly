import "server-only";

/**
 * Absolute base URL for building outbound links (email verification, password
 * reset, Stripe checkout/portal return URLs). Reads `AUTH_URL` and falls back
 * to local dev. Single source so the value can't drift between consumers.
 */
export function getBaseUrl(): string {
  return process.env.AUTH_URL ?? "http://localhost:3000";
}
