import "server-only";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { BCRYPT_SALT_ROUNDS } from "@/lib/system-constants";
import { changePasswordSchema } from "@/lib/validations/auth";

export type ChangePasswordResult =
  | { success: true }
  | {
      success: false;
      error: string;
      code: "VALIDATION" | "NO_PASSWORD" | "WRONG_PASSWORD";
    };

/**
 * Re-authenticate the user with their current password, then replace it with a
 * freshly hashed new password. Rejects accounts with no password (OAuth-only),
 * which have no current password to verify against.
 */
export async function changeUserPassword(
  userId: string,
  input: unknown
): Promise<ChangePasswordResult> {
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0].message,
      code: "VALIDATION",
    };
  }

  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { password: true },
  });

  if (!user?.password) {
    return {
      success: false,
      error: "Password change is only available for email accounts",
      code: "NO_PASSWORD",
    };
  }

  const isValid = await bcrypt.compare(currentPassword, user.password);
  if (!isValid) {
    return {
      success: false,
      error: "Your current password is incorrect",
      code: "WRONG_PASSWORD",
    };
  }

  const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword },
  });

  return { success: true };
}
