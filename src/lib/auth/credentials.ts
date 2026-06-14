import "server-only";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { credentialsSchema } from "@/lib/validations/auth";
import { EMAIL_VERIFICATION_ENABLED } from "@/lib/system-constants";

export interface AuthenticatedUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

/**
 * Validate credentials and return the matching user, or null on any failure
 * (bad input, unknown email, OAuth-only account with no password, or wrong
 * password). Used by the Credentials provider's authorize callback in auth.ts.
 */
export async function verifyCredentials(
  input: unknown
): Promise<AuthenticatedUser | null> {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) {
    return null;
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.password) {
    return null;
  }

  // Soft-deleted accounts are deactivated immediately — block sign-in during
  // the grace period (checked before the password compare returns, so it never
  // becomes a way to enumerate which emails exist).
  if (user.deletedAt) {
    return null;
  }

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) {
    return null;
  }

  // Email-verification gate. Isolated on purpose so the EMAIL_VERIFICATION_ENABLED
  // flag can short-circuit this single block without touching the rest of the
  // flow. Placed after the password check so it can't be used to enumerate accounts.
  if (EMAIL_VERIFICATION_ENABLED && !user.emailVerified) {
    return null;
  }

  return { id: user.id, name: user.name, email: user.email, image: user.image };
}
