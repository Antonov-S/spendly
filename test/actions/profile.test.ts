import { describe, it, expect, vi, beforeEach } from "vitest";
import { updateProfile } from "@/actions/profile";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { PROFILE_NAME_MAX } from "@/lib/system-constants";

vi.mock("@/auth", () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/change-password", () => ({ changeUserPassword: vi.fn() }));
vi.mock("@/lib/auth/account", () => ({ softDeleteAccount: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const mockAuth = vi.mocked(auth);
const userUpdate = vi.mocked(prisma.user.update);

function signIn(id = "u1") {
  mockAuth.mockResolvedValue({ user: { id } } as never);
}

/** Build a FormData carrying the given name field. */
function form(name: unknown) {
  const fd = new FormData();
  if (name !== undefined) fd.set("name", name as string);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateProfile", () => {
  it("rejects an unauthenticated request without writing", async () => {
    mockAuth.mockResolvedValue(null as never);

    const result = await updateProfile({}, form("Ann"));

    expect(result.error).toBeTruthy();
    expect(result.success).toBeUndefined();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("writes only the name for the session user and revalidates", async () => {
    signIn("u1");
    userUpdate.mockResolvedValue({} as never);

    const result = await updateProfile({}, form("Ann"));

    expect(result.success).toBe(true);
    expect(typeof result.at).toBe("number");
    expect(userUpdate).toHaveBeenCalledTimes(1);

    const arg = userUpdate.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "u1" });
    // Field-scoping (S3): only `name` may be written.
    expect(Object.keys(arg.data)).toEqual(["name"]);
    expect(arg.data.name).toBe("Ann");

    expect(revalidatePath).toHaveBeenCalledWith("/settings");
    expect(revalidatePath).toHaveBeenCalledWith("/profile");
  });

  it("trims the name before writing", async () => {
    signIn();
    userUpdate.mockResolvedValue({} as never);

    await updateProfile({}, form("  Ann  "));

    expect(userUpdate.mock.calls[0][0].data.name).toBe("Ann");
  });

  it("rejects an empty / whitespace-only name without writing", async () => {
    signIn();

    const result = await updateProfile({}, form("   "));

    expect(result.error).toBeTruthy();
    expect(result.success).toBeUndefined();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("rejects a name longer than PROFILE_NAME_MAX without writing", async () => {
    signIn();

    const result = await updateProfile({}, form("a".repeat(PROFILE_NAME_MAX + 1)));

    expect(result.error).toBeTruthy();
    expect(result.success).toBeUndefined();
    expect(userUpdate).not.toHaveBeenCalled();
  });
});
