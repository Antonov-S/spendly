import "server-only";
import { prisma } from "@/lib/prisma";

export type DeleteAccountResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Soft-delete a user account: stamp `deletedAt` so sign-in is blocked
 * immediately while the row (and all cascading data) is preserved for the
 * grace period before a future purge job removes it. Idempotent — re-running
 * on an already-deleted account is a no-op success.
 */
export async function softDeleteAccount(
  userId: string
): Promise<DeleteAccountResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { deletedAt: true },
  });

  if (!user) {
    return { success: false, error: "Account not found" };
  }

  if (!user.deletedAt) {
    await prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date() },
    });
  }

  return { success: true };
}
