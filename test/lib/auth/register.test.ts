import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerUser } from "@/lib/auth/register";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { createVerificationToken } from "@/lib/auth/verification";
import { sendVerificationEmail } from "@/lib/email/send-verification-email";

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

vi.mock("@/lib/auth/verification", () => ({
  createVerificationToken: vi.fn(),
}));

vi.mock("@/lib/email/send-verification-email", () => ({
  sendVerificationEmail: vi.fn(),
}));

// Mutable flag so individual tests can flip EMAIL_VERIFICATION_ENABLED. The
// getter keeps the imported binding live so register.ts reads the current value.
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
const create = vi.mocked(prisma.user.create);
const hash = vi.mocked(bcrypt.hash);
const createToken = vi.mocked(createVerificationToken);
const sendEmail = vi.mocked(sendVerificationEmail);

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
    createToken.mockReset();
    sendEmail.mockReset();
    createToken.mockResolvedValue("verify-token");
    sendEmail.mockResolvedValue(undefined);
    verificationFlag.enabled = true;
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

  it("issues a verification token and sends the email on success", async () => {
    findUnique.mockResolvedValue(null);
    hash.mockResolvedValue("hashed-pw" as never);
    create.mockResolvedValue({ id: "new-id", email: "test@example.com" } as never);

    const result = await registerUser(validInput);

    expect(result.success).toBe(true);
    expect(createToken).toHaveBeenCalledWith("test@example.com");
    expect(sendEmail).toHaveBeenCalledWith("test@example.com", "verify-token");
  });

  it("skips token creation and email when verification is disabled", async () => {
    verificationFlag.enabled = false;
    findUnique.mockResolvedValue(null);
    hash.mockResolvedValue("hashed-pw" as never);
    create.mockResolvedValue({ id: "new-id", email: "test@example.com" } as never);

    const result = await registerUser(validInput);

    expect(result.success).toBe(true);
    expect(createToken).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("still succeeds when sending the verification email fails", async () => {
    findUnique.mockResolvedValue(null);
    hash.mockResolvedValue("hashed-pw" as never);
    create.mockResolvedValue({ id: "new-id", email: "test@example.com" } as never);
    sendEmail.mockRejectedValue(new Error("resend down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await registerUser(validInput);

    expect(result.success).toBe(true);
    errorSpy.mockRestore();
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
