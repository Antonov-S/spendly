import { describe, it, expect, vi, beforeEach } from "vitest";
import { getUserOverview } from "@/lib/db/profile";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

const userFindUnique = vi.mocked(prisma.user.findUnique);

describe("getUserOverview", () => {
  beforeEach(() => {
    userFindUnique.mockReset();
  });

  // The projection is a drift-prevention contract for the /settings cards — pin
  // its exact shape so an accidental column drop/add is caught.
  it("scopes by id and selects exactly the agreed columns", async () => {
    userFindUnique.mockResolvedValue(null as never);

    await getUserOverview("u1");

    expect(userFindUnique).toHaveBeenCalledTimes(1);
    const arg = userFindUnique.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "u1" });
    expect(arg.select).toEqual({
      name: true,
      email: true,
      image: true,
      password: true,
      isPro: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      analyticsOptOut: true,
      createdAt: true,
    });
  });
});
