import { describe, it, expect, vi, beforeEach } from "vitest";
import { softDeleteAccount } from "@/lib/auth/account";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));

const findUnique = vi.mocked(prisma.user.findUnique);
const update = vi.mocked(prisma.user.update);
const mockGetStripe = vi.mocked(getStripe);

function stripeWith(cancel: ReturnType<typeof vi.fn>) {
  mockGetStripe.mockReturnValue({ subscriptions: { cancel } } as never);
}

describe("softDeleteAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails when the account does not exist", async () => {
    findUnique.mockResolvedValue(null);
    const result = await softDeleteAccount("user-1");
    expect(result.success).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(mockGetStripe).not.toHaveBeenCalled();
  });

  it("stamps deletedAt for an active account without a subscription", async () => {
    findUnique.mockResolvedValue({
      deletedAt: null,
      stripeSubscriptionId: null,
    } as never);
    update.mockResolvedValue({} as never);

    const result = await softDeleteAccount("user-1");

    expect(result.success).toBe(true);
    expect(mockGetStripe).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        deletedAt: expect.any(Date),
        sessionEpoch: { increment: 1 },
      },
    });
  });

  it("cancels the Stripe subscription before stamping deletedAt", async () => {
    findUnique.mockResolvedValue({
      deletedAt: null,
      stripeSubscriptionId: "sub_1",
    } as never);
    const cancel = vi.fn().mockResolvedValue({});
    stripeWith(cancel);
    update.mockResolvedValue({} as never);

    const result = await softDeleteAccount("user-1");

    expect(result.success).toBe(true);
    expect(cancel).toHaveBeenCalledWith("sub_1");
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("still completes the soft-delete when the Stripe cancel throws", async () => {
    findUnique.mockResolvedValue({
      deletedAt: null,
      stripeSubscriptionId: "sub_2",
    } as never);
    stripeWith(vi.fn().mockRejectedValue(new Error("stripe down")));
    update.mockResolvedValue({} as never);

    const result = await softDeleteAccount("user-1");

    expect(result.success).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for an already soft-deleted account (no Stripe call, no write)", async () => {
    findUnique.mockResolvedValue({
      deletedAt: new Date("2026-06-01"),
      stripeSubscriptionId: "sub_3",
    } as never);

    const result = await softDeleteAccount("user-1");

    expect(result.success).toBe(true);
    expect(update).not.toHaveBeenCalled();
    expect(mockGetStripe).not.toHaveBeenCalled();
  });
});
