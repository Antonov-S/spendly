import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthError } from "next-auth";
import { authenticate } from "@/actions/auth";
import { signIn } from "@/auth";

// next-auth's package index imports `next/server`, which isn't available in the
// node test env. Stub it with just the AuthError class the action relies on —
// both this test and the action resolve to this same class, so `instanceof`
// keeps working.
vi.mock("next-auth", () => ({
  AuthError: class AuthError extends Error {},
}));

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

    expect(result).toEqual({ error: "Invalid email or password." });
  });

  it("re-throws non-AuthError errors (e.g. the success redirect)", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    mockSignIn.mockRejectedValue(redirect);

    await expect(authenticate({}, validForm)).rejects.toBe(redirect);
  });
});
