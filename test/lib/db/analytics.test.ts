import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAnalyticsOptOut, persistEvent } from "@/lib/db/analytics";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    analyticsEvent: { create: vi.fn() },
  },
}));

const findUnique = vi.mocked(prisma.user.findUnique);
const create = vi.mocked(prisma.analyticsEvent.create);

beforeEach(() => vi.clearAllMocks());

describe("getAnalyticsOptOut", () => {
  it("returns the boolean flag for an existing user", async () => {
    findUnique.mockResolvedValue({ analyticsOptOut: true } as never);

    const res = await getAnalyticsOptOut("u1");

    expect(res).toBe(true);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
      select: { analyticsOptOut: true },
    });
  });

  it("returns null when the user row is missing", async () => {
    findUnique.mockResolvedValue(null as never);

    expect(await getAnalyticsOptOut("gone")).toBeNull();
  });
});

describe("persistEvent", () => {
  it("inserts the userId, name, and props", async () => {
    create.mockResolvedValue({} as never);

    await persistEvent("u1", "goal_created", { foo: 1 });

    expect(create).toHaveBeenCalledWith({
      data: { userId: "u1", name: "goal_created", props: { foo: 1 } },
    });
  });
});
