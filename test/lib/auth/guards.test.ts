import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getSessionOrRedirect,
  redirectIfAuthenticated,
} from "@/lib/auth/guards";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

// Mirror Next's real redirect, which throws to halt the calling component.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const mockAuth = vi.mocked(auth);
const mockRedirect = vi.mocked(redirect);

const session = {
  user: { id: "user-1", name: "Test", email: "test@example.com", image: null },
  expires: "2099-01-01T00:00:00.000Z",
};

beforeEach(() => {
  mockAuth.mockReset();
  mockRedirect.mockClear();
});

describe("getSessionOrRedirect", () => {
  it("returns the session when a user id is present", async () => {
    mockAuth.mockResolvedValue(session as never);

    const result = await getSessionOrRedirect();

    expect(result).toBe(session);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("redirects to /sign-in when there is no session", async () => {
    mockAuth.mockResolvedValue(null as never);

    await expect(getSessionOrRedirect()).rejects.toThrow("REDIRECT:/sign-in");
    expect(mockRedirect).toHaveBeenCalledWith("/sign-in");
  });

  it("redirects when the session has no user id", async () => {
    mockAuth.mockResolvedValue({ user: {}, expires: "" } as never);

    await expect(getSessionOrRedirect()).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("honors a custom redirect target", async () => {
    mockAuth.mockResolvedValue(null as never);

    await expect(getSessionOrRedirect("/login")).rejects.toThrow(
      "REDIRECT:/login"
    );
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });
});

describe("redirectIfAuthenticated", () => {
  it("redirects to /dashboard when a user is signed in", async () => {
    mockAuth.mockResolvedValue(session as never);

    await expect(redirectIfAuthenticated()).rejects.toThrow(
      "REDIRECT:/dashboard"
    );
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("does nothing when there is no session", async () => {
    mockAuth.mockResolvedValue(null as never);

    await expect(redirectIfAuthenticated()).resolves.toBeUndefined();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("honors a custom redirect target", async () => {
    mockAuth.mockResolvedValue(session as never);

    await expect(redirectIfAuthenticated("/home")).rejects.toThrow(
      "REDIRECT:/home"
    );
    expect(mockRedirect).toHaveBeenCalledWith("/home");
  });
});
