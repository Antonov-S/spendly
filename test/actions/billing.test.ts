import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createCheckoutSession,
  createPortalSession,
} from "@/actions/billing";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { redirect } from "next/navigation";
import { track } from "@/lib/analytics/track";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(),
  // Price resolvers must stay functions so the action can call them.
  STRIPE_PRICE_IDS: {
    monthly: () => "price_monthly",
    yearly: () => "price_yearly",
  },
}));

const mockAuth = vi.mocked(auth);
const findUnique = vi.mocked(prisma.user.findUnique);
const mockGetStripe = vi.mocked(getStripe);
const mockRedirect = vi.mocked(redirect);

function signIn(id = "u1") {
  mockAuth.mockResolvedValue({ user: { id } } as never);
}

function stripeWith(checkoutCreate: ReturnType<typeof vi.fn>) {
  mockGetStripe.mockReturnValue({
    checkout: { sessions: { create: checkoutCreate } },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createCheckoutSession", () => {
  it("rejects when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    const result = await createCheckoutSession("monthly");
    expect(result?.error).toBeTruthy();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("rejects an invalid period without hitting the DB", async () => {
    signIn();
    const result = await createCheckoutSession("weekly" as never);
    expect(result?.error).toBeTruthy();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("rejects when the user has no email", async () => {
    signIn();
    findUnique.mockResolvedValue({ email: null } as never);
    const result = await createCheckoutSession("monthly");
    expect(result?.error).toBeTruthy();
  });

  it("rejects when the user is already Pro", async () => {
    signIn();
    findUnique.mockResolvedValue({
      email: "a@b.c",
      isPro: true,
      stripeCustomerId: null,
    } as never);
    const result = await createCheckoutSession("monthly");
    expect(result?.error).toMatch(/already/i);
    expect(mockGetStripe).not.toHaveBeenCalled();
  });

  it("passes customer_email (not customer) when no stripe customer exists", async () => {
    signIn("u1");
    findUnique.mockResolvedValue({
      email: "a@b.c",
      isPro: false,
      stripeCustomerId: null,
    } as never);
    const create = vi.fn().mockResolvedValue({ url: "https://checkout" });
    stripeWith(create);

    await createCheckoutSession("monthly");

    const arg = create.mock.calls[0][0];
    expect(arg.customer).toBeUndefined();
    expect(arg.customer_email).toBe("a@b.c");
    expect(mockRedirect).toHaveBeenCalledWith("https://checkout");
    // Telemetry: the click is recorded before the redirect (§0).
    expect(track).toHaveBeenCalledWith("upgrade_to_pro_clicked", {
      period: "monthly",
    });
  });

  it("reuses an existing stripe customer (customer set, email omitted) + payload shape", async () => {
    signIn("u1");
    findUnique.mockResolvedValue({
      email: "a@b.c",
      isPro: false,
      stripeCustomerId: "cus_existing",
    } as never);
    const create = vi.fn().mockResolvedValue({ url: "https://checkout" });
    stripeWith(create);

    await createCheckoutSession("yearly");

    const arg = create.mock.calls[0][0];
    expect(arg.mode).toBe("subscription");
    expect(arg.customer).toBe("cus_existing");
    expect(arg.customer_email).toBeUndefined();
    expect(arg.client_reference_id).toBe("u1");
    expect(arg.line_items[0].price).toBe("price_yearly");
    expect(arg.success_url).toContain("/settings?checkout=success");
    expect(arg.success_url).toContain("session_id={CHECKOUT_SESSION_ID}");
    expect(arg.cancel_url).toContain("checkout=cancelled");
    expect(arg.automatic_tax.enabled).toBe(false);
    expect(arg.subscription_data.metadata.userId).toBe("u1");
    expect(mockRedirect).toHaveBeenCalledWith("https://checkout");
  });

  it("returns an error (no redirect) when Stripe throws", async () => {
    signIn();
    findUnique.mockResolvedValue({
      email: "a@b.c",
      isPro: false,
      stripeCustomerId: null,
    } as never);
    stripeWith(vi.fn().mockRejectedValue(new Error("boom")));

    const result = await createCheckoutSession("monthly");
    expect(result?.error).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

describe("createPortalSession", () => {
  it("rejects when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    const result = await createPortalSession();
    expect(result?.error).toBeTruthy();
  });

  it("rejects when there is no stripe customer", async () => {
    signIn();
    findUnique.mockResolvedValue({ stripeCustomerId: null } as never);
    const result = await createPortalSession();
    expect(result?.error).toBeTruthy();
    expect(mockGetStripe).not.toHaveBeenCalled();
  });

  it("creates a portal session with the return_url and redirects", async () => {
    signIn();
    findUnique.mockResolvedValue({ stripeCustomerId: "cus_1" } as never);
    const create = vi.fn().mockResolvedValue({ url: "https://portal" });
    mockGetStripe.mockReturnValue({
      billingPortal: { sessions: { create } },
    } as never);

    await createPortalSession();

    const arg = create.mock.calls[0][0];
    expect(arg.customer).toBe("cus_1");
    expect(arg.return_url).toContain("/settings");
    expect(mockRedirect).toHaveBeenCalledWith("https://portal");
  });
});
