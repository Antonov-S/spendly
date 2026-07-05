import { describe, it, expect, vi, beforeEach } from "vitest";
import { changeUserPassword } from "@/lib/auth/change-password";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
}));

const findUnique = vi.mocked(prisma.user.findUnique);
const update = vi.mocked(prisma.user.update);
const compare = vi.mocked(bcrypt.compare);
const hash = vi.mocked(bcrypt.hash);

const validInput = {
  currentPassword: "old-password",
  newPassword: "new-password-123",
  confirmPassword: "new-password-123",
};

describe("changeUserPassword", () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
    compare.mockReset();
    hash.mockReset();
  });

  it("fails validation when the new password is too short", async () => {
    const result = await changeUserPassword("user-1", {
      currentPassword: "old-password",
      newPassword: "short",
      confirmPassword: "short",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("VALIDATION");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("fails validation when the new passwords do not match", async () => {
    const result = await changeUserPassword("user-1", {
      currentPassword: "old-password",
      newPassword: "new-password-123",
      confirmPassword: "different-456",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("VALIDATION");
  });

  it("rejects an account with no password (OAuth-only)", async () => {
    findUnique.mockResolvedValue({ password: null } as never);
    const result = await changeUserPassword("user-1", validInput);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("NO_PASSWORD");
    expect(compare).not.toHaveBeenCalled();
  });

  it("rejects an incorrect current password", async () => {
    findUnique.mockResolvedValue({ password: "hashed-old" } as never);
    compare.mockResolvedValue(false as never);
    const result = await changeUserPassword("user-1", validInput);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("WRONG_PASSWORD");
    expect(update).not.toHaveBeenCalled();
  });

  it("hashes and stores the new password on success", async () => {
    findUnique.mockResolvedValue({ password: "hashed-old" } as never);
    compare.mockResolvedValue(true as never);
    hash.mockResolvedValue("hashed-new" as never);
    update.mockResolvedValue({} as never);

    const result = await changeUserPassword("user-1", validInput);

    expect(result.success).toBe(true);
    expect(compare).toHaveBeenCalledWith("old-password", "hashed-old");
    expect(hash).toHaveBeenCalledWith("new-password-123", expect.any(Number));
    expect(update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        password: "hashed-new",
        sessionEpoch: { increment: 1 },
      },
    });
  });
});
