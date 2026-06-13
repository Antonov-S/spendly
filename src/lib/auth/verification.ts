import "server-only";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { VERIFICATION_TOKEN_TTL_HOURS } from "@/lib/system-constants";

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Issue a single-use verification token for an email. Clears any existing
 * tokens for that identifier first (idempotency: a fresh request invalidates
 * older links). The raw token is stored as-is and returned for the link.
 */
export async function createVerificationToken(email: string): Promise<string> {
  const identifier = email.trim().toLowerCase();
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + VERIFICATION_TOKEN_TTL_HOURS * MS_PER_HOUR);

  await prisma.verificationToken.deleteMany({ where: { identifier } });
  await prisma.verificationToken.create({ data: { identifier, token, expires } });

  return token;
}

/**
 * Validate and consume a verification token. Returns the associated email on
 * success, or null when the token is unknown, expired, or already used.
 * The row is deleted on consume, so a token can only be redeemed once.
 */
export async function consumeVerificationToken(
  token: string
): Promise<string | null> {
  const record = await prisma.verificationToken.findUnique({ where: { token } });
  if (!record) {
    return null;
  }

  // Always remove the row — single-use, even if expired.
  await prisma.verificationToken.delete({ where: { token } });

  if (record.expires < new Date()) {
    return null;
  }

  return record.identifier;
}
