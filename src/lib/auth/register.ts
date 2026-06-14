import "server-only";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  BCRYPT_SALT_ROUNDS,
  EMAIL_VERIFICATION_ENABLED,
} from "@/lib/system-constants";
import { registerSchema } from "@/lib/validations/auth";
import { createVerificationToken } from "@/lib/auth/verification";
import { sendVerificationEmail } from "@/lib/email/send-verification-email";

export type RegisterResult =
  | { success: true; data: { id: string; email: string } }
  | { success: false; error: string; code: "VALIDATION" | "DUPLICATE" };

/**
 * Validate a registration payload, ensure the email is unused, hash the
 * password, and create the user. Returns a discriminated result so callers
 * (the API route) can map failures to the correct HTTP status.
 */
export async function registerUser(input: unknown): Promise<RegisterResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0].message,
      code: "VALIDATION",
    };
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return {
      success: false,
      error: "An account with this email already exists",
      code: "DUPLICATE",
    };
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  const user = await prisma.user.create({
    data: { name, email, password: hashedPassword },
    select: { id: true, email: true },
  });

  // Issue a verification link. A send failure must not fail registration —
  // the user can request a fresh link from the verify-email screen. Skipped
  // entirely when verification enforcement is disabled.
  if (EMAIL_VERIFICATION_ENABLED) {
    try {
      const token = await createVerificationToken(email);
      await sendVerificationEmail(email, token);
    } catch (error) {
      console.error("Failed to send verification email", error);
    }
  }

  return { success: true, data: user };
}
