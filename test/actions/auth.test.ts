import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthError, CredentialsSignin } from "next-auth";
import { authenticate } from "@/actions/auth";
import { signIn } from "@/auth";

// next-auth's package index imports `next/server`, which isn't available in the
// node test env. Stub it with just the error classes the action relies on —
// both this test and the action resolve to these same classes, so `instanceof`
// keeps working. CredentialsSignin extends AuthError, mirroring real next-auth.
vi.mock("next-auth", () => {
  class AuthError extends Error {}
  class CredentialsSignin extends AuthError {
    code = "credentials";
  }
  return { AuthError, CredentialsSignin };
});

vi.mock("@/auth", () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const mockSignIn = vi.mocked(signIn);

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

const validForm = formData({
  email: "test@example.com",
  password: "password123",
});

describe("authenticate", () => {
  beforeEach(() => {
    mockSignIn.mockReset();
  });

  it("returns a validation error and skips signIn for invalid input", async () => {
    const result = await authenticate(
      {},
      formData({ email: "not-an-email", password: "" })
    );

    expect(result).toEqual({
      error: "Please enter a valid email and password.",
    });
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("passes normalized credentials to signIn with a dashboard redirect", async () => {
    mockSignIn.mockResolvedValue(undefined as never);

    await authenticate(
      {},
      formData({ email: "  TEST@Example.com ", password: "password123" })
    );

    expect(mockSignIn).toHaveBeenCalledWith("credentials", {
      email: "test@example.com",
      password: "password123",
      redirectTo: "/dashboard",
    });
  });

  it("maps an AuthError to a generic invalid-credentials message", async () => {
    mockSignIn.mockRejectedValue(new AuthError("CredentialsSignin"));

    const result = await authenticate({}, validForm);

    expect(result).toEqual({
      error: "Invalid email or password, or your email isn't verified yet.",
    });
  });

  it("maps a rate_limited CredentialsSignin to the amber rate-limit notice", async () => {
    const error = new CredentialsSignin();
    error.code = "rate_limited";
    mockSignIn.mockRejectedValue(error);

    const result = await authenticate({}, validForm);

    expect(result.rateLimited).toBe(true);
    expect(result.error).toMatch(/too many/i);
  });

  it("treats a non-rate-limit CredentialsSignin as generic invalid credentials", async () => {
    const error = new CredentialsSignin();
    error.code = "credentials";
    mockSignIn.mockRejectedValue(error);

    const result = await authenticate({}, validForm);

    expect(result.rateLimited).toBeUndefined();
    expect(result.error).toBe(
      "Invalid email or password, or your email isn't verified yet."
    );
  });

  it("re-throws non-AuthError errors (e.g. the success redirect)", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    mockSignIn.mockRejectedValue(redirect);

    await expect(authenticate({}, validForm)).rejects.toBe(redirect);
  });
});
