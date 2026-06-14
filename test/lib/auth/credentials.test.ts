import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyCredentials } from "@/lib/auth/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn(),
  },
}));

// Mutable flag so individual tests can flip EMAIL_VERIFICATION_ENABLED. The
// getter keeps the imported binding live so credentials.ts reads the current value.
const verificationFlag = vi.hoisted(() => ({ enabled: true }));

vi.mock("@/lib/system-constants", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/system-constants")>();
  return {
    ...actual,
    get EMAIL_VERIFICATION_ENABLED() {
      return verificationFlag.enabled;
    },
  };
});

const findUnique = vi.mocked(prisma.user.findUnique);
const compare = vi.mocked(bcrypt.compare);

const dbUser = {
  id: "user-1",
  name: "Test User",
  email: "test@example.com",
  image: null,
  password: "hashed-pw",
  emailVerified: new Date("2026-01-01"),
};

const validCredentials = { email: "test@example.com", password: "password123" };

describe("verifyCredentials", () => {
  beforeEach(() => {
    findUnique.mockReset();
    compare.mockReset();
    verificationFlag.enabled = true;
  });

  it("returns null for invalid input shape", async () => {
    const result = await verifyCredentials({ email: "not-an-email", password: "" });
    expect(result).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns null when the user does not exist", async () => {
    findUnique.mockResolvedValue(null);
    const result = await verifyCredentials(validCredentials);
    expect(result).toBeNull();
    expect(compare).not.toHaveBeenCalled();
  });

  it("returns null for an OAuth-only account with no password", async () => {
    findUnique.mockResolvedValue({ ...dbUser, password: null } as never);
    const result = await verifyCredentials(validCredentials);
    expect(result).toBeNull();
    expect(compare).not.toHaveBeenCalled();
  });

  it("returns null when the password does not match", async () => {
    findUnique.mockResolvedValue(dbUser as never);
    compare.mockResolvedValue(false as never);
    const result = await verifyCredentials(validCredentials);
    expect(result).toBeNull();
  });

  it("returns null when the email is not verified", async () => {
    findUnique.mockResolvedValue({ ...dbUser, emailVerified: null } as never);
    compare.mockResolvedValue(true as never);
    const result = await verifyCredentials(validCredentials);
    expect(result).toBeNull();
  });

  it("allows an unverified user when verification is disabled", async () => {
    verificationFlag.enabled = false;
    findUnique.mockResolvedValue({ ...dbUser, emailVerified: null } as never);
    compare.mockResolvedValue(true as never);

    const result = await verifyCredentials(validCredentials);

    expect(result).toEqual({
      id: "user-1",
      name: "Test User",
      email: "test@example.com",
      image: null,
    });
  });

  it("returns the safe user object on a valid match", async () => {
    findUnique.mockResolvedValue(dbUser as never);
    compare.mockResolvedValue(true as never);

    const result = await verifyCredentials(validCredentials);

    expect(compare).toHaveBeenCalledWith("password123", "hashed-pw");
    expect(result).toEqual({
      id: "user-1",
      name: "Test User",
      email: "test@example.com",
      image: null,
    });
  });

  it("normalizes the email before lookup", async () => {
    findUnique.mockResolvedValue(dbUser as never);
    compare.mockResolvedValue(true as never);

    await verifyCredentials({ email: "  TEST@Example.com ", password: "password123" });

    expect(findUnique).toHaveBeenCalledWith({
      where: { email: "test@example.com" },
    });
  });
});
