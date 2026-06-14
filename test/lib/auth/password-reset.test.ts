import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createPasswordResetToken,
  consumePasswordResetToken,
} from "@/lib/auth/password-reset";
import { prisma } from "@/lib/prisma";
import { PASSWORD_RESET_TOKEN_TTL_HOURS } from "@/lib/system-constants";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    verificationToken: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const deleteMany = vi.mocked(prisma.verificationToken.deleteMany);
const create = vi.mocked(prisma.verificationToken.create);
const findUnique = vi.mocked(prisma.verificationToken.findUnique);
const del = vi.mocked(prisma.verificationToken.delete);

describe("createPasswordResetToken", () => {
  beforeEach(() => {
    deleteMany.mockReset();
    create.mockReset();
    create.mockResolvedValue({} as never);
    deleteMany.mockResolvedValue({} as never);
  });

  it("namespaces the identifier with a reset: prefix", async () => {
    await createPasswordResetToken("test@example.com");
    expect(deleteMany).toHaveBeenCalledWith({
      where: { identifier: "reset:test@example.com" },
    });
    const data = create.mock.calls[0][0].data;
    expect(data.identifier).toBe("reset:test@example.com");
  });

  it("normalizes the email to lowercase and trims it", async () => {
    await createPasswordResetToken("  TEST@Example.com  ");
    expect(deleteMany).toHaveBeenCalledWith({
      where: { identifier: "reset:test@example.com" },
    });
  });

  it("only clears prior reset rows, never bare-email verification rows", async () => {
    await createPasswordResetToken("test@example.com");
    // The deleteMany identifier must carry the prefix so a pending
    // verification token (bare email) is left untouched.
    expect(deleteMany).toHaveBeenCalledWith({
      where: { identifier: "reset:test@example.com" },
    });
    expect(deleteMany).not.toHaveBeenCalledWith({
      where: { identifier: "test@example.com" },
    });
  });

  it("persists a random token with the correct expiry and returns it", async () => {
    const before = Date.now();
    const token = await createPasswordResetToken("test@example.com");
    const after = Date.now();

    // 32 random bytes -> 64 hex chars.
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const data = create.mock.calls[0][0].data;
    expect(data.token).toBe(token);

    const ttlMs = PASSWORD_RESET_TOKEN_TTL_HOURS * 60 * 60 * 1000;
    const expires = (data.expires as Date).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + ttlMs);
    expect(expires).toBeLessThanOrEqual(after + ttlMs);
  });
});

describe("consumePasswordResetToken", () => {
  beforeEach(() => {
    findUnique.mockReset();
    del.mockReset();
    del.mockResolvedValue({} as never);
  });

  it("returns null for an unknown token without deleting", async () => {
    findUnique.mockResolvedValue(null);
    const result = await consumePasswordResetToken("nope");
    expect(result).toBeNull();
    expect(del).not.toHaveBeenCalled();
  });

  it("returns the email (prefix stripped) and deletes the row for a valid token", async () => {
    findUnique.mockResolvedValue({
      identifier: "reset:test@example.com",
      token: "tok",
      expires: new Date(Date.now() + 60_000),
    } as never);

    const result = await consumePasswordResetToken("tok");

    expect(result).toBe("test@example.com");
    expect(del).toHaveBeenCalledWith({ where: { token: "tok" } });
  });

  it("rejects and deletes an expired token", async () => {
    findUnique.mockResolvedValue({
      identifier: "reset:test@example.com",
      token: "tok",
      expires: new Date(Date.now() - 60_000),
    } as never);

    const result = await consumePasswordResetToken("tok");

    expect(result).toBeNull();
    expect(del).toHaveBeenCalledWith({ where: { token: "tok" } });
  });

  it("rejects a bare-email verification token without deleting it", async () => {
    findUnique.mockResolvedValue({
      identifier: "test@example.com",
      token: "tok",
      expires: new Date(Date.now() + 60_000),
    } as never);

    const result = await consumePasswordResetToken("tok");

    expect(result).toBeNull();
    expect(del).not.toHaveBeenCalled();
  });
});
