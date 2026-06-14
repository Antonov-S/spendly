import "server-only";
import { createHash } from "crypto";

/**
 * One-way hash for verification / password-reset tokens before they are stored.
 * The raw token (256-bit random) goes in the emailed link; only this hash is
 * persisted, so a database reader can never redeem a pending link.
 *
 * SHA-256 is sufficient here — the input already has 256 bits of entropy, so it
 * is not brute-forceable and a slow KDF (as used for passwords) is unnecessary.
 */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
