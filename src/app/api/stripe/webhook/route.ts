import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { mapStripeEvent } from "@/lib/stripe/events";
import {
  linkCheckout,
  syncSubscription,
  clearSubscription,
} from "@/lib/db/billing";

// Stripe SDK needs Node; a webhook must never be cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/stripe/webhook
 *
 * Thin verify → map → write glue (stripe-billing-spec §5). The signature is the
 * only authentication (S5), so this route is NOT rate-limited and NOT
 * `auth()`-guarded. The decision logic lives in the unit-tested pure mapper
 * (`stripe/events.ts`); the writes live in `db/billing.ts` — this file imports
 * no Prisma (enforced by ESLint, §12.6).
 *
 * Status contract: 400 on missing/invalid signature (no DB change); 500 on a
 * handler throw so Stripe retries (R4) and the dashboard failure alert fires;
 * 200 on success AND on unhandled/no-match events so Stripe stops retrying.
 */
export async function POST(request: Request) {
  const body = await request.text(); // raw text — JSON.parse would break the sig (S1)
  const signature = (await headers()).get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const stripe = getStripe();
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (error) {
    console.error("Stripe signature verification failed", error);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const intent = mapStripeEvent(event);

  try {
    switch (intent.kind) {
      case "link":
        await linkCheckout({
          userId: intent.userId,
          stripeCustomerId: intent.stripeCustomerId,
          stripeSubscriptionId: intent.stripeSubscriptionId,
        });
        log(event.id, event.type, "handled");
        break;
      case "sync":
        await syncSubscription({
          stripeCustomerId: intent.stripeCustomerId,
          isActive: intent.isActive,
          stripeSubscriptionId: intent.stripeSubscriptionId,
        });
        log(event.id, event.type, "handled");
        break;
      case "clear":
        await clearSubscription({ stripeCustomerId: intent.stripeCustomerId });
        log(event.id, event.type, "handled");
        break;
      case "noop":
        log(event.id, event.type, "ignored", intent.reason);
        break;
    }
  } catch (error) {
    // Real write failure → 500 so Stripe retries and the failure alert fires (R4).
    console.error(`Stripe webhook handler failed for ${event.id}`, error);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

function log(
  eventId: string,
  type: string,
  outcome: "handled" | "ignored" | "error",
  reason?: string
): void {
  console.info(
    `[stripe-webhook] ${JSON.stringify({ eventId, type, outcome, reason })}`
  );
}
