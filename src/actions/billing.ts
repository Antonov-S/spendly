"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getStripe, STRIPE_PRICE_IDS, type BillingPeriod } from "@/lib/stripe";
import { getBaseUrl } from "@/lib/url";

/** Failure shape returned to the form's `useTransition`; success path redirects. */
export interface BillingActionResult {
  error: string;
}

/**
 * Start a Stripe Checkout for the given billing period and redirect to it.
 * Resolves the user from the session only (S3); rejects if already Pro. Does NOT
 * pre-create a Customer — Checkout creates one and the webhook picks up the id.
 * On success the function `redirect()`s (which throws), so it only returns on a
 * validation/Stripe failure.
 */
export async function createCheckoutSession(
  period: BillingPeriod
): Promise<BillingActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You must be signed in to subscribe." };
  }

  if (period !== "monthly" && period !== "yearly") {
    return { error: "Invalid billing period." };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { stripeCustomerId: true, email: true, isPro: true },
  });
  if (!user?.email) {
    return { error: "Account not found." };
  }
  if (user.isPro) {
    return { error: "You already have an active Pro subscription." };
  }

  const base = getBaseUrl();
  let url: string | null;
  try {
    const checkout = await getStripe().checkout.sessions.create({
      mode: "subscription",
      customer: user.stripeCustomerId ?? undefined,
      customer_email: user.stripeCustomerId ? undefined : user.email,
      client_reference_id: session.user.id,
      line_items: [{ price: STRIPE_PRICE_IDS[period](), quantity: 1 }],
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      automatic_tax: { enabled: false },
      success_url: `${base}/settings?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/settings?checkout=cancelled`,
      subscription_data: { metadata: { userId: session.user.id } },
    });
    url = checkout.url;
  } catch (error) {
    console.error("createCheckoutSession failed", error);
    return { error: "Could not start checkout. Please try again." };
  }

  if (!url) {
    return { error: "Could not start checkout. Please try again." };
  }
  redirect(url);
}

/**
 * Open the Stripe Customer Portal for managing/cancelling the subscription.
 * Session-resolved (S3); rejects if the user has no Stripe customer yet.
 */
export async function createPortalSession(): Promise<BillingActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You must be signed in to manage billing." };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { stripeCustomerId: true },
  });
  if (!user?.stripeCustomerId) {
    return { error: "No billing account found." };
  }

  const base = getBaseUrl();
  let url: string;
  try {
    const portal = await getStripe().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${base}/settings`,
    });
    url = portal.url;
  } catch (error) {
    console.error("createPortalSession failed", error);
    return { error: "Could not open the billing portal. Please try again." };
  }

  redirect(url);
}
