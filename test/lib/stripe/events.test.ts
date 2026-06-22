import { describe, it, expect } from "vitest";
import type Stripe from "stripe";
import { mapStripeEvent } from "@/lib/stripe/events";

/** Minimal Stripe.Event shim — only the fields the mapper reads. */
function event(type: string, object: unknown): Stripe.Event {
  return { type, data: { object } } as unknown as Stripe.Event;
}

describe("mapStripeEvent — checkout.session.completed", () => {
  it("links via client_reference_id with string customer + subscription", () => {
    const intent = mapStripeEvent(
      event("checkout.session.completed", {
        client_reference_id: "u1",
        customer: "cus_1",
        subscription: "sub_1",
      })
    );
    expect(intent).toEqual({
      kind: "link",
      userId: "u1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
    });
  });

  it("falls back to metadata.userId when client_reference_id is absent", () => {
    const intent = mapStripeEvent(
      event("checkout.session.completed", {
        client_reference_id: null,
        metadata: { userId: "u2" },
        customer: "cus_2",
        subscription: "sub_2",
      })
    );
    expect(intent).toMatchObject({ kind: "link", userId: "u2" });
  });

  it("narrows expanded customer/subscription objects to their ids", () => {
    const intent = mapStripeEvent(
      event("checkout.session.completed", {
        client_reference_id: "u3",
        customer: { id: "cus_3" },
        subscription: { id: "sub_3" },
      })
    );
    expect(intent).toEqual({
      kind: "link",
      userId: "u3",
      stripeCustomerId: "cus_3",
      stripeSubscriptionId: "sub_3",
    });
  });

  it("allows a null subscription (still links)", () => {
    const intent = mapStripeEvent(
      event("checkout.session.completed", {
        client_reference_id: "u4",
        customer: "cus_4",
        subscription: null,
      })
    );
    expect(intent).toMatchObject({
      kind: "link",
      stripeSubscriptionId: null,
    });
  });

  it("noops when userId is missing", () => {
    const intent = mapStripeEvent(
      event("checkout.session.completed", {
        client_reference_id: null,
        customer: "cus_5",
      })
    );
    expect(intent.kind).toBe("noop");
  });

  it("noops when customer is missing", () => {
    const intent = mapStripeEvent(
      event("checkout.session.completed", {
        client_reference_id: "u6",
        customer: null,
      })
    );
    expect(intent.kind).toBe("noop");
  });
});

describe("mapStripeEvent — subscription.created/updated → isActive matrix", () => {
  const cases: Array<[Stripe.Subscription.Status, boolean]> = [
    ["active", true],
    ["trialing", true],
    ["canceled", false],
    ["past_due", false],
    ["unpaid", false],
    ["incomplete", false],
    ["incomplete_expired", false],
    ["paused", false],
  ];

  for (const eventType of [
    "customer.subscription.created",
    "customer.subscription.updated",
  ] as const) {
    for (const [status, isActive] of cases) {
      it(`${eventType}: ${status} → isActive=${isActive}`, () => {
        const intent = mapStripeEvent(
          event(eventType, { id: "sub_x", customer: "cus_x", status })
        );
        expect(intent).toEqual({
          kind: "sync",
          stripeCustomerId: "cus_x",
          isActive,
          stripeSubscriptionId: "sub_x",
        });
      });
    }
  }

  it("narrows an expanded customer object", () => {
    const intent = mapStripeEvent(
      event("customer.subscription.updated", {
        id: "sub_y",
        customer: { id: "cus_y" },
        status: "active",
      })
    );
    expect(intent).toMatchObject({ kind: "sync", stripeCustomerId: "cus_y" });
  });

  it("noops when customer is missing", () => {
    const intent = mapStripeEvent(
      event("customer.subscription.created", {
        id: "sub_z",
        customer: null,
        status: "active",
      })
    );
    expect(intent.kind).toBe("noop");
  });
});

describe("mapStripeEvent — subscription.deleted", () => {
  it("maps to a clear intent keyed by customer", () => {
    const intent = mapStripeEvent(
      event("customer.subscription.deleted", {
        id: "sub_d",
        customer: "cus_d",
        status: "canceled",
      })
    );
    expect(intent).toEqual({ kind: "clear", stripeCustomerId: "cus_d" });
  });
});

describe("mapStripeEvent — unhandled", () => {
  it("noops for unknown event types", () => {
    const intent = mapStripeEvent(event("payment_intent.created", {}));
    expect(intent.kind).toBe("noop");
  });
});
