import "server-only";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

export type DeleteAccountResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Soft-delete a user account: stamp `deletedAt` so sign-in is blocked
 * immediately while the row (and all cascading data) is preserved for the
 * grace period before a future purge job removes it. Idempotent — re-running
 * on an already-deleted account is a no-op success.
 *
 * Deleting also cancels any live Stripe subscription so we never bill a departed
 * user (§9). The Stripe call is best-effort — a failure is logged and swallowed
 * so an outage can never block account deletion (worst case: one orphan
 * subscription to reconcile). The Customer is kept for audit/refund (R5).
 */
export async function softDeleteAccount(
  userId: string
): Promise<DeleteAccountResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { deletedAt: true, stripeSubscriptionId: true },
  });

  if (!user) {
    return { success: false, error: "Account not found" };
  }

  if (!user.deletedAt) {
    if (user.stripeSubscriptionId) {
      try {
        await getStripe().subscriptions.cancel(user.stripeSubscriptionId);
      } catch (error) {
        console.error("Failed to cancel Stripe subscription on delete", error);
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date() },
    });
  }

  return { success: true };
}
