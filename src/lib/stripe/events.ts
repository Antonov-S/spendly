import type Stripe from "stripe";

/**
 * Pure Stripe-event → billing-intent mapper. Type-only Stripe import, no
 * `next-auth`/Prisma — so it is safe to unit-test in the Vitest worker (the
 * webhook route itself isn't, because importing it pulls `next/server` in).
 *
 * The intent is then executed by a `src/lib/db/billing.ts` writer. Splitting
 * "decide what to do" (here, tested) from "do it" (Prisma, mocked-tested) keeps
 * the route a thin verify → map → write shell.
 */
export type BillingIntent =
  | {
      kind: "link";
      userId: string;
      stripeCustomerId: string;
      stripeSubscriptionId: string | null;
    }
  | {
      kind: "sync";
      stripeCustomerId: string;
      isActive: boolean;
      stripeSubscriptionId: string;
    }
  | { kind: "clear"; stripeCustomerId: string }
  | { kind: "noop"; reason: string };

/** Subscription statuses Spendly treats as Pro (R2). Everything else → Free. */
const ACTIVE_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  "active",
  "trialing",
]);

/** A Stripe field that arrives as either a bare id string or an expanded object. */
type Expandable = string | { id: string } | null | undefined;

function idOf(value: Expandable): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

export function mapStripeEvent(event: Stripe.Event): BillingIntent {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId =
        session.client_reference_id ?? session.metadata?.userId ?? null;
      const stripeCustomerId = idOf(session.customer);
      const stripeSubscriptionId = idOf(session.subscription);

      if (!userId || !stripeCustomerId) {
        return {
          kind: "noop",
          reason: "checkout.session.completed missing userId or customer",
        };
      }
      return { kind: "link", userId, stripeCustomerId, stripeSubscriptionId };
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const stripeCustomerId = idOf(sub.customer);
      if (!stripeCustomerId) {
        return { kind: "noop", reason: `${event.type} missing customer` };
      }
      return {
        kind: "sync",
        stripeCustomerId,
        isActive: ACTIVE_STATUSES.has(sub.status),
        stripeSubscriptionId: sub.id,
      };
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const stripeCustomerId = idOf(sub.customer);
      if (!stripeCustomerId) {
        return { kind: "noop", reason: `${event.type} missing customer` };
      }
      return { kind: "clear", stripeCustomerId };
    }

    default:
      return { kind: "noop", reason: `unhandled event type ${event.type}` };
  }
}
