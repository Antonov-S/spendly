import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createVerificationToken,
  consumeVerificationToken,
} from "@/lib/auth/verification";
import { prisma } from "@/lib/prisma";
import { VERIFICATION_TOKEN_TTL_HOURS } from "@/lib/system-constants";

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

describe("createVerificationToken", () => {
  beforeEach(() => {
    deleteMany.mockReset();
    create.mockReset();
    create.mockResolvedValue({} as never);
    deleteMany.mockResolvedValue({} as never);
  });

  it("clears prior tokens for the email before creating a new one", async () => {
    await createVerificationToken("test@example.com");
    expect(deleteMany).toHaveBeenCalledWith({
      where: { identifier: "test@example.com" },
    });
  });

  it("normalizes the email to lowercase and trims it", async () => {
    await createVerificationToken("  TEST@Example.com  ");
    expect(deleteMany).toHaveBeenCalledWith({
      where: { identifier: "test@example.com" },
    });
    const data = create.mock.calls[0][0].data;
    expect(data.identifier).toBe("test@example.com");
  });

  it("persists a random token with the correct expiry and returns it", async () => {
    const before = Date.now();
    const token = await createVerificationToken("test@example.com");
    const after = Date.now();

    // 32 random bytes -> 64 hex chars.
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const data = create.mock.calls[0][0].data;
    expect(data.token).toBe(token);

    const ttlMs = VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000;
    const expires = (data.expires as Date).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + ttlMs);
    expect(expires).toBeLessThanOrEqual(after + ttlMs);
  });
});

describe("consumeVerificationToken", () => {
  beforeEach(() => {
    findUnique.mockReset();
    del.mockReset();
    del.mockResolvedValue({} as never);
  });

  it("returns null for an unknown token without deleting", async () => {
    findUnique.mockResolvedValue(null);
    const result = await consumeVerificationToken("nope");
    expect(result).toBeNull();
    expect(del).not.toHaveBeenCalled();
  });

  it("returns the email and deletes the row for a valid token", async () => {
    findUnique.mockResolvedValue({
      identifier: "test@example.com",
      token: "tok",
      expires: new Date(Date.now() + 60_000),
    } as never);

    const result = await consumeVerificationToken("tok");

    expect(result).toBe("test@example.com");
    expect(del).toHaveBeenCalledWith({ where: { token: "tok" } });
  });

  it("rejects and deletes an expired token", async () => {
    findUnique.mockResolvedValue({
      identifier: "test@example.com",
      token: "tok",
      expires: new Date(Date.now() - 60_000),
    } as never);

    const result = await consumeVerificationToken("tok");

    expect(result).toBeNull();
    expect(del).toHaveBeenCalledWith({ where: { token: "tok" } });
  });
});
