import { describe, it, expect, vi, beforeEach } from "vitest";
import { softDeleteAccount } from "@/lib/auth/account";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const findUnique = vi.mocked(prisma.user.findUnique);
const update = vi.mocked(prisma.user.update);

describe("softDeleteAccount", () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
  });

  it("fails when the account does not exist", async () => {
    findUnique.mockResolvedValue(null);
    const result = await softDeleteAccount("user-1");
    expect(result.success).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("stamps deletedAt for an active account", async () => {
    findUnique.mockResolvedValue({ deletedAt: null } as never);
    update.mockResolvedValue({} as never);

    const result = await softDeleteAccount("user-1");

    expect(result.success).toBe(true);
    expect(update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("is a no-op for an already soft-deleted account", async () => {
    findUnique.mockResolvedValue({
      deletedAt: new Date("2026-06-01"),
    } as never);

    const result = await softDeleteAccount("user-1");

    expect(result.success).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });
});
