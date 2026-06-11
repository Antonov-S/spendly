import "server-only";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { credentialsSchema } from "@/lib/validations/auth";

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

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) {
    return null;
  }

  return { id: user.id, name: user.name, email: user.email, image: user.image };
}
