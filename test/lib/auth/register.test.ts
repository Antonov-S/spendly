import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerUser } from "@/lib/auth/register";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn(),
  },
}));

const findUnique = vi.mocked(prisma.user.findUnique);
const create = vi.mocked(prisma.user.create);
const hash = vi.mocked(bcrypt.hash);

const validInput = {
  name: "Test User",
  email: "test@example.com",
  password: "password123",
  confirmPassword: "password123",
};

describe("registerUser", () => {
  beforeEach(() => {
    findUnique.mockReset();
    create.mockReset();
    hash.mockReset();
  });

  it("rejects when name is empty", async () => {
    const result = await registerUser({ ...validInput, name: "" });
    expect(result).toEqual({
      success: false,
      error: "Name is required",
      code: "VALIDATION",
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("rejects an invalid email", async () => {
    const result = await registerUser({ ...validInput, email: "not-an-email" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("VALIDATION");
      expect(result.error).toBe("Invalid email address");
    }
  });

  it("rejects a password shorter than the minimum", async () => {
    const result = await registerUser({
      ...validInput,
      password: "short",
      confirmPassword: "short",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("VALIDATION");
  });

  it("rejects mismatched passwords", async () => {
    const result = await registerUser({
      ...validInput,
      confirmPassword: "different123",
    });
    expect(result).toEqual({
      success: false,
      error: "Passwords do not match",
      code: "VALIDATION",
    });
  });

  it("rejects a duplicate email without creating a user", async () => {
    findUnique.mockResolvedValue({ id: "existing" } as never);

    const result = await registerUser(validInput);

    expect(result).toEqual({
      success: false,
      error: "An account with this email already exists",
      code: "DUPLICATE",
    });
    expect(create).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
  });

  it("hashes the password and creates the user on success", async () => {
    findUnique.mockResolvedValue(null);
    hash.mockResolvedValue("hashed-pw" as never);
    create.mockResolvedValue({ id: "new-id", email: "test@example.com" } as never);

    const result = await registerUser(validInput);

    expect(hash).toHaveBeenCalledWith("password123", 12);
    expect(create).toHaveBeenCalledWith({
      data: {
        name: "Test User",
        email: "test@example.com",
        password: "hashed-pw",
      },
      select: { id: true, email: true },
    });
    expect(result).toEqual({
      success: true,
      data: { id: "new-id", email: "test@example.com" },
    });
  });

  it("normalizes email to lowercase and trims before lookup", async () => {
    findUnique.mockResolvedValue(null);
    hash.mockResolvedValue("hashed-pw" as never);
    create.mockResolvedValue({ id: "new-id", email: "test@example.com" } as never);

    await registerUser({ ...validInput, email: "  TEST@Example.com  " });

    expect(findUnique).toHaveBeenCalledWith({
      where: { email: "test@example.com" },
    });
  });
});
