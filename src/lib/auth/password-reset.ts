import "server-only";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth/token-hash";
import { PASSWORD_RESET_TOKEN_TTL_HOURS } from "@/lib/system-constants";

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Reset tokens share the `VerificationToken` table with email-verification
 * tokens. To keep the two flows from clobbering each other's rows, reset rows
 * are namespaced: `identifier = "reset:" + email`. Verification rows use the
 * bare email. Each flow's `deleteMany`/consume only ever touches its own
 * namespace.
 */
const RESET_PREFIX = "reset:";

/**
 * Issue a single-use password-reset token for an email. Clears any existing
 * reset tokens for that email first (a fresh request invalidates older links)
 * without touching the bare-email verification rows. Only the hash is stored;
 * the raw token is returned for the reset link so a database reader can never
 * redeem a pending link.
 */
export async function createPasswordResetToken(email: string): Promise<string> {
  const identifier = RESET_PREFIX + email.trim().toLowerCase();
  const rawToken = randomBytes(32).toString("hex");
  const token = hashToken(rawToken);
  const expires = new Date(
    Date.now() + PASSWORD_RESET_TOKEN_TTL_HOURS * MS_PER_HOUR
  );

  await prisma.verificationToken.deleteMany({ where: { identifier } });
  await prisma.verificationToken.create({ data: { identifier, token, expires } });

  return rawToken;
}

/**
 * Validate and consume a password-reset token. Returns the associated email on
 * success, or null when the token is unknown, expired, used, or belongs to the
 * verification namespace (a verification token must never be redeemable here).
 * The raw token from the link is hashed before lookup to match the stored hash.
 * The row is deleted on consume, so a token can only be redeemed once.
 */
export async function consumePasswordResetToken(
  token: string
): Promise<string | null> {
  const hashed = hashToken(token);
  const record = await prisma.verificationToken.findUnique({
    where: { token: hashed },
  });
  if (!record || !record.identifier.startsWith(RESET_PREFIX)) {
    return null;
  }

  // Always remove the row — single-use, even if expired.
  await prisma.verificationToken.delete({ where: { token: hashed } });

  if (record.expires < new Date()) {
    return null;
  }

  return record.identifier.slice(RESET_PREFIX.length);
}
