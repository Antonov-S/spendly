import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getSessionOrRedirect,
  redirectIfAuthenticated,
  requireOnboarded,
  redirectIfOnboarded,
} from "@/lib/auth/guards";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getActiveAccountCount } from "@/lib/db/accounts";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/accounts", () => ({ getActiveAccountCount: vi.fn() }));

// Mirror Next's real redirect, which throws to halt the calling component.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const mockAuth = vi.mocked(auth);
const mockRedirect = vi.mocked(redirect);
const mockCount = vi.mocked(getActiveAccountCount);

const session = {
  user: { id: "user-1", name: "Test", email: "test@example.com", image: null },
  expires: "2099-01-01T00:00:00.000Z",
};

beforeEach(() => {
  mockAuth.mockReset();
  mockRedirect.mockClear();
  mockCount.mockReset();
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

describe("requireOnboarded", () => {
  it("redirects to /sign-in when there is no session (via getSessionOrRedirect)", async () => {
    mockAuth.mockResolvedValue(null as never);

    await expect(requireOnboarded()).rejects.toThrow("REDIRECT:/sign-in");
    expect(mockRedirect).toHaveBeenCalledWith("/sign-in");
    // No account lookup once the session check has already bounced the user.
    expect(mockCount).not.toHaveBeenCalled();
  });

  it("redirects to /onboarding when the user has no active accounts", async () => {
    mockAuth.mockResolvedValue(session as never);
    mockCount.mockResolvedValue(0);

    await expect(requireOnboarded()).rejects.toThrow("REDIRECT:/onboarding");
    expect(mockCount).toHaveBeenCalledWith("user-1");
    expect(mockRedirect).toHaveBeenCalledWith("/onboarding");
  });

  it("returns the session when at least one active account exists", async () => {
    mockAuth.mockResolvedValue(session as never);
    mockCount.mockResolvedValue(1);

    const result = await requireOnboarded();

    expect(result).toBe(session);
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

describe("redirectIfOnboarded", () => {
  it("redirects to /dashboard when the user already has an active account", async () => {
    mockAuth.mockResolvedValue(session as never);
    mockCount.mockResolvedValue(2);

    await expect(redirectIfOnboarded()).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockCount).toHaveBeenCalledWith("user-1");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("returns the session when the user has zero active accounts", async () => {
    mockAuth.mockResolvedValue(session as never);
    mockCount.mockResolvedValue(0);

    const result = await redirectIfOnboarded();

    expect(result).toBe(session);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("redirects to /sign-in when there is no session", async () => {
    mockAuth.mockResolvedValue(null as never);

    await expect(redirectIfOnboarded()).rejects.toThrow("REDIRECT:/sign-in");
    expect(mockCount).not.toHaveBeenCalled();
  });
});
