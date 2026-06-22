import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  linkCheckout,
  syncSubscription,
  clearSubscription,
  reconcileCheckoutReturn,
} from "@/lib/db/billing";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));

const userUpdate = vi.mocked(prisma.user.update);
const userUpdateMany = vi.mocked(prisma.user.updateMany);
const userFindUnique = vi.mocked(prisma.user.findUnique);
const mockGetStripe = vi.mocked(getStripe);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("linkCheckout", () => {
  it("updates the one user by id with both stripe ids + isPro:true", async () => {
    userUpdate.mockResolvedValue({} as never);

    await linkCheckout({
      userId: "u1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
    });

    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: {
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        isPro: true,
      },
    });
    expect(userUpdateMany).not.toHaveBeenCalled();
  });
});

describe("syncSubscription", () => {
  it("uses updateMany keyed by stripeCustomerId with the computed isPro", async () => {
    userUpdateMany.mockResolvedValue({ count: 1 } as never);

    await syncSubscription({
      stripeCustomerId: "cus_2",
      isActive: true,
      stripeSubscriptionId: "sub_2",
    });

    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { stripeCustomerId: "cus_2" },
      data: { isPro: true, stripeSubscriptionId: "sub_2" },
    });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("writes isPro:false for an inactive status", async () => {
    userUpdateMany.mockResolvedValue({ count: 1 } as never);

    await syncSubscription({
      stripeCustomerId: "cus_3",
      isActive: false,
      stripeSubscriptionId: "sub_3",
    });

    expect(userUpdateMany.mock.calls[0][0].data).toMatchObject({ isPro: false });
  });

  it("resolves without throwing when zero rows match (out-of-order delivery, R1/R6)", async () => {
    // An unlinked customer: the subscription event arrived before the checkout
    // link. updateMany matches nothing — a no-op, never a P2025.
    userUpdateMany.mockResolvedValue({ count: 0 } as never);

    await expect(
      syncSubscription({
        stripeCustomerId: "cus_unlinked",
        isActive: true,
        stripeSubscriptionId: "sub_x",
      })
    ).resolves.toBeUndefined();

    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe("clearSubscription", () => {
  it("updateMany sets isPro:false + stripeSubscriptionId:null, keeps customer", async () => {
    userUpdateMany.mockResolvedValue({ count: 1 } as never);

    await clearSubscription({ stripeCustomerId: "cus_4" });

    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { stripeCustomerId: "cus_4" },
      data: { isPro: false, stripeSubscriptionId: null },
    });
  });

  it("is a safe no-op when no row matches", async () => {
    userUpdateMany.mockResolvedValue({ count: 0 } as never);
    await expect(
      clearSubscription({ stripeCustomerId: "cus_gone" })
    ).resolves.toBeUndefined();
  });
});

describe("reconcileCheckoutReturn", () => {
  it("no-ops without a sessionId", async () => {
    await reconcileCheckoutReturn("u1", undefined);
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(mockGetStripe).not.toHaveBeenCalled();
  });

  it("no-ops when the user is already Pro (webhook won)", async () => {
    userFindUnique.mockResolvedValue({ isPro: true } as never);

    await reconcileCheckoutReturn("u1", "cs_1");

    expect(mockGetStripe).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("retrieves the session and links when not yet Pro", async () => {
    userFindUnique.mockResolvedValue({ isPro: false } as never);
    const retrieve = vi.fn().mockResolvedValue({
      payment_status: "paid",
      customer: "cus_5",
      subscription: "sub_5",
    });
    mockGetStripe.mockReturnValue({
      checkout: { sessions: { retrieve } },
    } as never);
    userUpdate.mockResolvedValue({} as never);

    await reconcileCheckoutReturn("u5", "cs_5");

    expect(retrieve).toHaveBeenCalledWith("cs_5", { expand: ["subscription"] });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u5" },
      data: {
        stripeCustomerId: "cus_5",
        stripeSubscriptionId: "sub_5",
        isPro: true,
      },
    });
  });

  it("does not link when the session is unpaid", async () => {
    userFindUnique.mockResolvedValue({ isPro: false } as never);
    const retrieve = vi.fn().mockResolvedValue({
      payment_status: "unpaid",
      customer: "cus_6",
      subscription: "sub_6",
    });
    mockGetStripe.mockReturnValue({
      checkout: { sessions: { retrieve } },
    } as never);

    await reconcileCheckoutReturn("u6", "cs_6");

    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("swallows a Stripe error so a paid checkout never errors the page", async () => {
    userFindUnique.mockResolvedValue({ isPro: false } as never);
    const retrieve = vi.fn().mockRejectedValue(new Error("stripe down"));
    mockGetStripe.mockReturnValue({
      checkout: { sessions: { retrieve } },
    } as never);

    await expect(reconcileCheckoutReturn("u7", "cs_7")).resolves.toBeUndefined();
    expect(userUpdate).not.toHaveBeenCalled();
  });
});
