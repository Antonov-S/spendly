import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFavorite,
  deleteFavorite,
  reorderFavorites,
  trackFavoriteUsed,
  updateFavorite,
} from "@/actions/favorites";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { FAVORITE_MAX_COUNT } from "@/lib/system-constants";
import { revalidatePath } from "next/cache";
import { track } from "@/lib/analytics/track";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
    favorite: {
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    category: { findFirst: vi.fn() },
    financialAccount: { findFirst: vi.fn() },
  },
}));

const mockAuth = vi.mocked(auth);
const transaction = vi.mocked(prisma.$transaction);
const favorite = vi.mocked(prisma.favorite);
const category = vi.mocked(prisma.category);
const account = vi.mocked(prisma.financialAccount);
const mockRevalidatePath = vi.mocked(revalidatePath);
const mockTrack = vi.mocked(track);

const VALID = {
  name: "Coffee",
  type: "EXPENSE" as const,
  amount: 3.5,
  categoryId: "cat1",
  financialAccountId: "acc1",
  merchant: "Cafe",
  note: "morning",
};

function signIn(id = "u1") {
  mockAuth.mockResolvedValue({ user: { id } } as never);
}

function p2002(): Error & { code: string } {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

function mockNoClashes() {
  favorite.findFirst.mockResolvedValue(null as never);
  category.findFirst.mockResolvedValue({ id: "cat1" } as never);
  account.findFirst.mockResolvedValue({ id: "acc1" } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authentication", () => {
  it("rejects every action when not signed in", async () => {
    mockAuth.mockResolvedValue(null as never);

    expect((await createFavorite(VALID)).success).toBe(false);
    expect((await updateFavorite("f1", VALID)).success).toBe(false);
    expect((await reorderFavorites({ ids: ["f1"] })).success).toBe(false);
    expect((await deleteFavorite("f1")).success).toBe(false);
    expect((await trackFavoriteUsed({ hasAmount: true })).success).toBe(false);

    expect(favorite.create).not.toHaveBeenCalled();
    expect(favorite.update).not.toHaveBeenCalled();
    expect(favorite.delete).not.toHaveBeenCalled();
  });
});

describe("createFavorite", () => {
  it("creates a user-scoped favorite and returns a serializable option", async () => {
    signIn();
    favorite.count.mockResolvedValue(2 as never);
    mockNoClashes();
    favorite.create.mockResolvedValue({
      id: "f1",
      ...VALID,
      amount: { toString: () => "3.50" },
    } as never);

    const res = await createFavorite(VALID);

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual({
        id: "f1",
        name: "Coffee",
        type: "EXPENSE",
        amount: 3.5,
        categoryId: "cat1",
        financialAccountId: "acc1",
        merchant: "Cafe",
        note: "morning",
      });
    }
    expect(favorite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "u1",
          amount: 3.5,
        }),
      })
    );
    expect(mockRevalidatePath).toHaveBeenCalledTimes(1);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/settings");
    expect(mockTrack).toHaveBeenCalledWith("favorite_created", {
      favoriteCount: 3,
    });
  });

  it("enforces the per-user cap before checking references", async () => {
    signIn();
    favorite.count.mockResolvedValue(FAVORITE_MAX_COUNT as never);

    const res = await createFavorite(VALID);

    expect(res.success).toBe(false);
    expect(favorite.findFirst).not.toHaveBeenCalled();
    expect(category.findFirst).not.toHaveBeenCalled();
    expect(favorite.create).not.toHaveBeenCalled();
  });

  it("rejects a case-insensitive duplicate name", async () => {
    signIn();
    favorite.count.mockResolvedValue(0 as never);
    favorite.findFirst.mockResolvedValue({ id: "existing" } as never);

    const res = await createFavorite({ ...VALID, name: "coffee" });

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toBe("You already have a favorite with this name.");
    }
    expect(favorite.findFirst).toHaveBeenCalledWith({
      where: {
        userId: "u1",
        name: { equals: "coffee", mode: "insensitive" },
      },
      select: { id: true },
    });
    expect(favorite.create).not.toHaveBeenCalled();
  });

  it("maps a P2002 race to the same duplicate message", async () => {
    signIn();
    favorite.count.mockResolvedValue(0 as never);
    mockNoClashes();
    favorite.create.mockRejectedValue(p2002());

    const res = await createFavorite(VALID);

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toBe("You already have a favorite with this name.");
    }
  });

  it("accepts a visible system category", async () => {
    signIn();
    favorite.count.mockResolvedValue(0 as never);
    favorite.findFirst.mockResolvedValue(null as never);
    category.findFirst.mockResolvedValue({ id: "system-cat" } as never);
    account.findFirst.mockResolvedValue({ id: "acc1" } as never);
    favorite.create.mockResolvedValue({
      id: "f1",
      ...VALID,
      categoryId: "system-cat",
      amount: null,
    } as never);

    const res = await createFavorite({
      ...VALID,
      amount: null,
      categoryId: "system-cat",
    });

    expect(res.success).toBe(true);
    expect(category.findFirst).toHaveBeenCalledWith({
      where: { id: "system-cat", OR: [{ userId: "u1" }, { userId: null }] },
      select: { id: true },
    });
  });

  it("rejects a foreign category", async () => {
    signIn();
    favorite.count.mockResolvedValue(0 as never);
    favorite.findFirst.mockResolvedValue(null as never);
    category.findFirst.mockResolvedValue(null);

    const res = await createFavorite(VALID);

    expect(res).toEqual({ success: false, error: "Category not found." });
    expect(favorite.create).not.toHaveBeenCalled();
  });

  it("rejects archived or foreign accounts", async () => {
    signIn();
    favorite.count.mockResolvedValue(0 as never);
    favorite.findFirst.mockResolvedValue(null as never);
    category.findFirst.mockResolvedValue({ id: "cat1" } as never);
    account.findFirst.mockResolvedValue(null);

    const res = await createFavorite(VALID);

    expect(res).toEqual({ success: false, error: "Account not found." });
    expect(account.findFirst).toHaveBeenCalledWith({
      where: { id: "acc1", userId: "u1", isArchived: false },
      select: { id: true },
    });
    expect(favorite.create).not.toHaveBeenCalled();
  });
});

describe("updateFavorite", () => {
  it("updates every editable field on an owned favorite and revalidates settings only", async () => {
    signIn();
    favorite.findFirst
      .mockResolvedValueOnce({ id: "f1", financialAccountId: "acc1" } as never)
      .mockResolvedValueOnce(null as never);
    category.findFirst.mockResolvedValue({ id: "cat1" } as never);
    favorite.update.mockResolvedValue({ id: "f1" } as never);

    const res = await updateFavorite("f1", {
      ...VALID,
      name: "Morning coffee",
      amount: 3.456,
    });

    expect(res.success).toBe(true);
    expect(favorite.findFirst.mock.calls[0][0]).toEqual({
      where: { id: "f1", userId: "u1" },
      select: { id: true, financialAccountId: true },
    });
    expect(favorite.findFirst.mock.calls[1][0].where.NOT).toEqual({ id: "f1" });
    expect(account.findFirst).not.toHaveBeenCalled();
    expect(favorite.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: {
        name: "Morning coffee",
        type: "EXPENSE",
        amount: 3.46,
        categoryId: "cat1",
        financialAccountId: "acc1",
        merchant: "Cafe",
        note: "morning",
      },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("allows an unchanged archived account but validates a changed account", async () => {
    signIn();
    favorite.findFirst
      .mockResolvedValueOnce({ id: "f1", financialAccountId: "archived" } as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: "f2", financialAccountId: "archived" } as never)
      .mockResolvedValueOnce(null as never);
    category.findFirst.mockResolvedValue({ id: "cat1" } as never);
    account.findFirst.mockResolvedValue(null);
    favorite.update.mockResolvedValue({ id: "f1" } as never);

    const unchanged = await updateFavorite("f1", {
      ...VALID,
      financialAccountId: "archived",
    });
    const changed = await updateFavorite("f2", {
      ...VALID,
      financialAccountId: "other-archived",
    });

    expect(unchanged.success).toBe(true);
    expect(changed).toEqual({ success: false, error: "Account not found." });
    expect(account.findFirst).toHaveBeenCalledTimes(1);
    expect(account.findFirst).toHaveBeenCalledWith({
      where: { id: "other-archived", userId: "u1", isArchived: false },
      select: { id: true },
    });
  });

  it("normalizes a blank amount to prompt-on-use", async () => {
    signIn();
    favorite.findFirst
      .mockResolvedValueOnce({ id: "f1", financialAccountId: null } as never)
      .mockResolvedValueOnce(null as never);
    favorite.update.mockResolvedValue({ id: "f1" } as never);

    const res = await updateFavorite("f1", {
      ...VALID,
      amount: null,
      categoryId: null,
      financialAccountId: null,
      merchant: null,
      note: null,
    });

    expect(res.success).toBe(true);
    expect(favorite.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: null,
          categoryId: null,
          financialAccountId: null,
          merchant: null,
          note: null,
        }),
      })
    );
  });

  it("returns not found for a foreign row", async () => {
    signIn();
    favorite.findFirst.mockResolvedValue(null as never);

    const res = await updateFavorite("foreign", { ...VALID, name: "X" });

    expect(res).toEqual({ success: false, error: "Favorite not found." });
    expect(favorite.update).not.toHaveBeenCalled();
  });
});

describe("reorderFavorites", () => {
  it("rejects duplicate ids before checking ownership", async () => {
    signIn();

    const res = await reorderFavorites({ ids: ["f1", "f1"] });

    expect(res).toEqual({
      success: false,
      error: "Favorite ids must be unique.",
    });
    expect(favorite.count).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects stale or foreign ids as one failed call", async () => {
    signIn();
    favorite.count.mockResolvedValue(1 as never);

    const res = await reorderFavorites({ ids: ["f1", "missing"] });

    expect(res).toEqual({
      success: false,
      error: "Favorites changed — reload and try again.",
    });
    expect(favorite.count).toHaveBeenCalledWith({
      where: { userId: "u1", id: { in: ["f1", "missing"] } },
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("persists sortOrder for payload rows and clears omitted rows", async () => {
    signIn();
    favorite.count.mockResolvedValue(2 as never);
    favorite.update.mockResolvedValue({ id: "updated" } as never);
    favorite.updateMany.mockResolvedValue({ count: 1 } as never);

    const res = await reorderFavorites({ ids: ["f2", "f1"] });

    expect(res.success).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][0] as unknown[]).toHaveLength(3);
    expect(favorite.update).toHaveBeenNthCalledWith(1, {
      where: { id: "f2" },
      data: { sortOrder: 0 },
    });
    expect(favorite.update).toHaveBeenNthCalledWith(2, {
      where: { id: "f1" },
      data: { sortOrder: 1 },
    });
    expect(favorite.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", id: { notIn: ["f2", "f1"] } },
      data: { sortOrder: null },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/settings");
  });
});

describe("deleteFavorite", () => {
  it("hard-deletes an owned favorite and tracks the remaining count", async () => {
    signIn();
    favorite.findFirst.mockResolvedValue({ id: "f1" } as never);
    favorite.delete.mockResolvedValue({ id: "f1" } as never);
    favorite.count.mockResolvedValue(4 as never);

    const res = await deleteFavorite("f1");

    expect(res.success).toBe(true);
    expect(favorite.findFirst).toHaveBeenCalledWith({
      where: { id: "f1", userId: "u1" },
      select: { id: true },
    });
    expect(favorite.delete).toHaveBeenCalledWith({ where: { id: "f1" } });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/settings");
    expect(mockTrack).toHaveBeenCalledWith("favorite_deleted", {
      favoriteCount: 4,
    });
  });

  it("returns not found for a foreign row", async () => {
    signIn();
    favorite.findFirst.mockResolvedValue(null as never);

    const res = await deleteFavorite("foreign");

    expect(res).toEqual({ success: false, error: "Favorite not found." });
    expect(favorite.delete).not.toHaveBeenCalled();
  });
});

describe("trackFavoriteUsed", () => {
  it("emits only the hasAmount flag", async () => {
    signIn();

    const res = await trackFavoriteUsed({ hasAmount: false });

    expect(res.success).toBe(true);
    expect(mockTrack).toHaveBeenCalledWith("favorite_used", {
      hasAmount: false,
    });
  });
});
