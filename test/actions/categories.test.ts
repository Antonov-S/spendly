import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoryForEdit,
} from "@/actions/categories";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCategoryForEdit as getCategoryForEditQuery } from "@/lib/db/categories";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/revalidation", () => ({ revalidateCategoryViews: vi.fn() }));
vi.mock("@/lib/db/categories", () => ({ getCategoryForEdit: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const mockAuth = vi.mocked(auth);

/** Authenticate the session as `id` for the action under test. */
function signIn(id = "u1") {
  mockAuth.mockResolvedValue({ user: { id } } as never);
}

/** A Prisma unique-constraint error shape (the functional index firing on a race). */
function p2002(): Error & { code: string } {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

const VALID = {
  name: "Hobbies",
  icon: "Gamepad2" as const,
  color: "#7F77DD",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authentication", () => {
  it("rejects every mutation when not signed in", async () => {
    mockAuth.mockResolvedValue(null as never);

    expect((await createCategory(VALID)).success).toBe(false);
    expect((await updateCategory({ id: "c1", name: "Y" })).success).toBe(false);
    expect((await deleteCategory("c1")).success).toBe(false);
    expect((await getCategoryForEdit("c1")).success).toBe(false);

    expect(prisma.category.create).not.toHaveBeenCalled();
    expect(prisma.category.update).not.toHaveBeenCalled();
    expect(prisma.category.delete).not.toHaveBeenCalled();
  });
});

describe("createCategory", () => {
  it("inserts with the session userId + isSystem false and returns the new option", async () => {
    signIn("u1");
    vi.mocked(prisma.category.findFirst).mockResolvedValue(null as never); // no clash
    vi.mocked(prisma.category.create).mockResolvedValue({
      id: "c1",
      name: "Hobbies",
      color: "#7F77DD",
      icon: "Gamepad2",
    } as never);

    const res = await createCategory(VALID);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual({
        id: "c1",
        name: "Hobbies",
        color: "#7F77DD",
        icon: "Gamepad2",
      });
    }

    const data = vi.mocked(prisma.category.create).mock.calls[0][0].data;
    expect(data.userId).toBe("u1");
    expect(data.isSystem).toBe(false);
    expect(data.name).toBe("Hobbies");
  });

  it("ignores client-supplied userId / isSystem", async () => {
    signIn("u1");
    vi.mocked(prisma.category.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.category.create).mockResolvedValue({
      id: "c1",
      name: "Hobbies",
      color: "#7F77DD",
      icon: "Gamepad2",
    } as never);

    await createCategory({
      ...VALID,
      // @ts-expect-error — these are not part of CreateCategoryInput; must be ignored
      userId: "attacker",
      isSystem: true,
    });

    const data = vi.mocked(prisma.category.create).mock.calls[0][0].data;
    expect(data.userId).toBe("u1");
    expect(data.isSystem).toBe(false);
  });

  it("rejects invalid input without touching the DB", async () => {
    signIn("u1");
    const res = await createCategory({ ...VALID, name: "" });
    expect(res.success).toBe(false);
    expect(prisma.category.create).not.toHaveBeenCalled();
  });

  it("rejects a name that collides (case-insensitive) with a system or own category", async () => {
    signIn("u1");
    vi.mocked(prisma.category.findFirst).mockResolvedValue({ id: "sys" } as never);

    const res = await createCategory({ ...VALID, name: "groceries" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toBe("A category with that name already exists.");
    }
    // pre-check ran with a case-insensitive equals over system + own
    const where = vi.mocked(prisma.category.findFirst).mock.calls[0][0].where;
    expect(where.name).toEqual({ equals: "groceries", mode: "insensitive" });
    expect(where.OR).toEqual([{ userId: null }, { userId: "u1" }]);
    expect(prisma.category.create).not.toHaveBeenCalled();
  });

  it("maps a P2002 race to the friendly duplicate message", async () => {
    signIn("u1");
    vi.mocked(prisma.category.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.category.create).mockRejectedValue(p2002());

    const res = await createCategory(VALID);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toBe("A category with that name already exists.");
    }
  });

  it("rethrows a non-P2002 error as a generic failure result", async () => {
    signIn("u1");
    vi.mocked(prisma.category.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.category.create).mockRejectedValue(new Error("boom"));

    const res = await createCategory(VALID);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Could not create the category.");
  });
});

describe("updateCategory", () => {
  it("scopes ownership by userId AND isSystem false, patches provided fields", async () => {
    signIn("u1");
    vi.mocked(prisma.category.findFirst).mockResolvedValue({ id: "c1" } as never);
    vi.mocked(prisma.category.update).mockResolvedValue({ id: "c1" } as never);

    const res = await updateCategory({ id: "c1", color: "#10B981" });
    expect(res.success).toBe(true);

    expect(vi.mocked(prisma.category.findFirst).mock.calls[0][0].where).toEqual({
      id: "c1",
      userId: "u1",
      isSystem: false,
    });
    const data = vi.mocked(prisma.category.update).mock.calls[0][0].data;
    expect(data).toEqual({ color: "#10B981" });
    expect(data).not.toHaveProperty("name");
  });

  it("returns 'not found' for a system or foreign row (no write)", async () => {
    signIn("u1");
    vi.mocked(prisma.category.findFirst).mockResolvedValue(null as never);

    const res = await updateCategory({ id: "sys", name: "X" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Category not found.");
    expect(prisma.category.update).not.toHaveBeenCalled();
  });

  it("allows recasing your own category (dedup excludes the row itself)", async () => {
    signIn("u1");
    vi.mocked(prisma.category.findFirst)
      .mockResolvedValueOnce({ id: "c1" } as never) // ownership lookup
      .mockResolvedValueOnce(null as never); // dedup: no OTHER row clashes
    vi.mocked(prisma.category.update).mockResolvedValue({ id: "c1" } as never);

    const res = await updateCategory({ id: "c1", name: "Groceries" });
    expect(res.success).toBe(true);

    const dedupWhere = vi.mocked(prisma.category.findFirst).mock.calls[1][0].where;
    expect(dedupWhere.NOT).toEqual({ id: "c1" });
  });

  it("maps a P2002 race on a name change to the friendly duplicate message", async () => {
    signIn("u1");
    vi.mocked(prisma.category.findFirst)
      .mockResolvedValueOnce({ id: "c1" } as never) // ownership
      .mockResolvedValueOnce(null as never); // dedup pre-check passes
    vi.mocked(prisma.category.update).mockRejectedValue(p2002());

    const res = await updateCategory({ id: "c1", name: "Food" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toBe("A category with that name already exists.");
    }
  });
});

describe("deleteCategory", () => {
  it("hard-deletes a row scoped by userId + isSystem false", async () => {
    signIn("u1");
    vi.mocked(prisma.category.findFirst).mockResolvedValue({ id: "c1" } as never);
    vi.mocked(prisma.category.delete).mockResolvedValue({ id: "c1" } as never);

    const res = await deleteCategory("c1");
    expect(res.success).toBe(true);

    expect(vi.mocked(prisma.category.findFirst).mock.calls[0][0].where).toEqual({
      id: "c1",
      userId: "u1",
      isSystem: false,
    });
    expect(vi.mocked(prisma.category.delete).mock.calls[0][0].where).toEqual({
      id: "c1",
    });
  });

  it("returns 'not found' for a system or foreign row (no delete)", async () => {
    signIn("u1");
    vi.mocked(prisma.category.findFirst).mockResolvedValue(null as never);

    const res = await deleteCategory("sys");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Category not found.");
    expect(prisma.category.delete).not.toHaveBeenCalled();
  });
});

describe("getCategoryForEdit", () => {
  it("returns the row from the scoped fetcher", async () => {
    signIn("u1");
    vi.mocked(getCategoryForEditQuery).mockResolvedValue({
      id: "c1",
      name: "Hobbies",
      icon: "Gamepad2",
      color: "#7F77DD",
    } as never);

    const res = await getCategoryForEdit("c1");
    expect(res.success).toBe(true);
    expect(res.data?.id).toBe("c1");
    expect(getCategoryForEditQuery).toHaveBeenCalledWith("u1", "c1");
  });

  it("returns 'not found' when the fetcher yields null", async () => {
    signIn("u1");
    vi.mocked(getCategoryForEditQuery).mockResolvedValue(null as never);

    const res = await getCategoryForEdit("sys");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Category not found.");
  });
});
