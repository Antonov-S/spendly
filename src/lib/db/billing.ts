import "server-only";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

/**
 * The only module that mutates the `User` billing columns, so the webhook route
 * stays Prisma-free (mirrors the data-export ESLint boundary). All three writers
 * are idempotent — last-write-wins on `isPro` / `stripeSubscriptionId` — so
 * re-delivery of the same Stripe event is inherently safe (R3).
 */

/**
 * `checkout.session.completed`: grant Pro to the one user identified from
 * `client_reference_id`. The `userId` is known and unique, so a single `update`
 * is correct here (contrast the subscription writers, which key by customer and
 * must tolerate zero matches).
 */
export async function linkCheckout(params: {
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
}): Promise<void> {
  await prisma.user.update({
    where: { id: params.userId },
    data: {
      stripeCustomerId: params.stripeCustomerId,
      stripeSubscriptionId: params.stripeSubscriptionId,
      isPro: true,
    },
  });
}

/**
 * `customer.subscription.created` / `.updated`: reconcile Pro from the
 * subscription status. MUST use `updateMany` (R1/R6): an event that arrives
 * before the customer is linked matches zero rows — a safe no-op, not a P2025.
 */
export async function syncSubscription(params: {
  stripeCustomerId: string;
  isActive: boolean;
  stripeSubscriptionId: string;
}): Promise<void> {
  await prisma.user.updateMany({
    where: { stripeCustomerId: params.stripeCustomerId },
    data: {
      isPro: params.isActive,
      stripeSubscriptionId: params.stripeSubscriptionId,
    },
  });
}

/**
 * `customer.subscription.deleted`: clear Pro. Keeps `stripeCustomerId` for
 * audit/refund history and reuse on resubscribe (R5). `updateMany` for the same
 * zero-match safety as `syncSubscription`.
 */
export async function clearSubscription(params: {
  stripeCustomerId: string;
}): Promise<void> {
  await prisma.user.updateMany({
    where: { stripeCustomerId: params.stripeCustomerId },
    data: { isPro: false, stripeSubscriptionId: null },
  });
}

/**
 * Return-side reconciliation for `/settings?checkout=success` (§5/§12.7). Closes
 * the rare gap where the browser redirect beats the webhook: if the row is
 * already Pro the webhook won and this is a no-op; otherwise do one authoritative
 * pull of the Checkout Session and run the same `linkCheckout` intent. Idempotent
 * with the webhook — whichever lands first wins. Failures are swallowed so a
 * successful payment never renders as an error.
 */
export async function reconcileCheckoutReturn(
  userId: string,
  sessionId: string | undefined
): Promise<void> {
  if (!sessionId) return;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isPro: true },
    });
    if (user?.isPro) return; // webhook already won

    const session = await getStripe().checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });

    const stripeCustomerId =
      typeof session.customer === "string"
        ? session.customer
        : (session.customer?.id ?? null);
    const stripeSubscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : (session.subscription?.id ?? null);

    if (session.payment_status !== "paid" || !stripeCustomerId) return;

    await linkCheckout({ userId, stripeCustomerId, stripeSubscriptionId });
  } catch (error) {
    console.error("reconcileCheckoutReturn failed", error);
  }
}
