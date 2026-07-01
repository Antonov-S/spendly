import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTag, updateTag, deleteTag, getTagForEdit } from "@/actions/tags";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getTagForEdit as getTagForEditQuery } from "@/lib/db/tags";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/revalidation", () => ({ revalidateTagViews: vi.fn() }));
vi.mock("@/lib/db/tags", () => ({ getTagForEdit: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tag: {
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

const VALID = { name: "vacation-2026", color: "#7F77DD" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authentication", () => {
  it("rejects every mutation when not signed in", async () => {
    mockAuth.mockResolvedValue(null as never);

    expect((await createTag(VALID)).success).toBe(false);
    expect((await updateTag({ id: "t1", name: "Y" })).success).toBe(false);
    expect((await deleteTag("t1")).success).toBe(false);
    expect((await getTagForEdit("t1")).success).toBe(false);

    expect(prisma.tag.create).not.toHaveBeenCalled();
    expect(prisma.tag.update).not.toHaveBeenCalled();
    expect(prisma.tag.delete).not.toHaveBeenCalled();
  });
});

describe("createTag", () => {
  it("inserts with the session userId and returns the persisted TagOption", async () => {
    signIn("u1");
    vi.mocked(prisma.tag.findFirst).mockResolvedValue(null as never); // no clash
    vi.mocked(prisma.tag.create).mockResolvedValue({
      id: "t1",
      name: "vacation-2026",
      color: "#7F77DD",
    } as never);

    const res = await createTag(VALID);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual({
        id: "t1",
        name: "vacation-2026",
        color: "#7F77DD",
      });
    }

    const data = vi.mocked(prisma.tag.create).mock.calls[0][0].data;
    expect(data.userId).toBe("u1");
    expect(data.name).toBe("vacation-2026");
  });

  it("ignores a client-supplied userId", async () => {
    signIn("u1");
    vi.mocked(prisma.tag.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.tag.create).mockResolvedValue({
      id: "t1",
      name: "vacation-2026",
      color: "#7F77DD",
    } as never);

    await createTag({
      ...VALID,
      // @ts-expect-error — not part of CreateTagInput; must be ignored
      userId: "attacker",
    });

    expect(vi.mocked(prisma.tag.create).mock.calls[0][0].data.userId).toBe("u1");
  });

  it("accepts a name-only tag (no color) and stores color null", async () => {
    signIn("u1");
    vi.mocked(prisma.tag.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.tag.create).mockResolvedValue({
      id: "t1",
      name: "reimbursable",
      color: null,
    } as never);

    const res = await createTag({ name: "reimbursable" });
    expect(res.success).toBe(true);
    expect(vi.mocked(prisma.tag.create).mock.calls[0][0].data.color).toBeNull();
  });

  it("rejects a case-insensitive own-name clash without inserting", async () => {
    signIn("u1");
    vi.mocked(prisma.tag.findFirst).mockResolvedValue({ id: "t9" } as never);

    const res = await createTag({ ...VALID, name: "Vacation-2026" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toBe("A tag with that name already exists.");
    }
    const where = vi.mocked(prisma.tag.findFirst).mock.calls[0][0].where;
    expect(where.name).toEqual({ equals: "Vacation-2026", mode: "insensitive" });
    expect(where.userId).toBe("u1");
    expect(prisma.tag.create).not.toHaveBeenCalled();
  });

  it("maps a P2002 race to the friendly duplicate message", async () => {
    signIn("u1");
    vi.mocked(prisma.tag.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.tag.create).mockRejectedValue(p2002());

    const res = await createTag(VALID);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toBe("A tag with that name already exists.");
    }
  });

  it("returns a generic failure for a non-P2002 error", async () => {
    signIn("u1");
    vi.mocked(prisma.tag.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.tag.create).mockRejectedValue(new Error("boom"));

    const res = await createTag(VALID);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Could not create the tag.");
  });
});

describe("updateTag", () => {
  it("scopes ownership by userId and patches only provided fields", async () => {
    signIn("u1");
    vi.mocked(prisma.tag.findFirst).mockResolvedValue({ id: "t1" } as never);
    vi.mocked(prisma.tag.update).mockResolvedValue({ id: "t1" } as never);

    const res = await updateTag({ id: "t1", color: "#10B981" });
    expect(res.success).toBe(true);

    expect(vi.mocked(prisma.tag.findFirst).mock.calls[0][0].where).toEqual({
      id: "t1",
      userId: "u1",
    });
    const data = vi.mocked(prisma.tag.update).mock.calls[0][0].data;
    expect(data).toEqual({ color: "#10B981" });
    expect(data).not.toHaveProperty("name");
  });

  it("clears the color to null when passed null", async () => {
    signIn("u1");
    vi.mocked(prisma.tag.findFirst).mockResolvedValue({ id: "t1" } as never);
    vi.mocked(prisma.tag.update).mockResolvedValue({ id: "t1" } as never);

    const res = await updateTag({ id: "t1", color: null });
    expect(res.success).toBe(true);
    expect(vi.mocked(prisma.tag.update).mock.calls[0][0].data).toEqual({
      color: null,
    });
  });

  it("returns 'not found' for a foreign row (no write)", async () => {
    signIn("u1");
    vi.mocked(prisma.tag.findFirst).mockResolvedValue(null as never);

    const res = await updateTag({ id: "foreign", name: "X" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Tag not found.");
    expect(prisma.tag.update).not.toHaveBeenCalled();
  });

  it("allows recasing your own tag (dedup excludes the row itself)", async () => {
    signIn("u1");
    vi.mocked(prisma.tag.findFirst)
      .mockResolvedValueOnce({ id: "t1" } as never) // ownership lookup
      .mockResolvedValueOnce(null as never); // dedup: no OTHER row clashes
    vi.mocked(prisma.tag.update).mockResolvedValue({ id: "t1" } as never);

    const res = await updateTag({ id: "t1", name: "Vacation-2026" });
    expect(res.success).toBe(true);

    const dedupWhere = vi.mocked(prisma.tag.findFirst).mock.calls[1][0].where;
    expect(dedupWhere.NOT).toEqual({ id: "t1" });
  });
});

describe("deleteTag", () => {
  it("hard-deletes a row scoped by userId", async () => {
    signIn("u1");
    vi.mocked(prisma.tag.findFirst).mockResolvedValue({ id: "t1" } as never);
    vi.mocked(prisma.tag.delete).mockResolvedValue({ id: "t1" } as never);

    const res = await deleteTag("t1");
    expect(res.success).toBe(true);

    expect(vi.mocked(prisma.tag.findFirst).mock.calls[0][0].where).toEqual({
      id: "t1",
      userId: "u1",
    });
    expect(vi.mocked(prisma.tag.delete).mock.calls[0][0].where).toEqual({
      id: "t1",
    });
  });

  it("returns 'not found' for a foreign row (no delete)", async () => {
    signIn("u1");
    vi.mocked(prisma.tag.findFirst).mockResolvedValue(null as never);

    const res = await deleteTag("foreign");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Tag not found.");
    expect(prisma.tag.delete).not.toHaveBeenCalled();
  });
});

describe("getTagForEdit", () => {
  it("returns the row from the scoped fetcher", async () => {
    signIn("u1");
    vi.mocked(getTagForEditQuery).mockResolvedValue({
      id: "t1",
      name: "vacation-2026",
      color: "#7F77DD",
    } as never);

    const res = await getTagForEdit("t1");
    expect(res.success).toBe(true);
    expect(res.data?.id).toBe("t1");
    expect(getTagForEditQuery).toHaveBeenCalledWith("u1", "t1");
  });

  it("returns 'not found' when the fetcher yields null", async () => {
    signIn("u1");
    vi.mocked(getTagForEditQuery).mockResolvedValue(null as never);

    const res = await getTagForEdit("foreign");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Tag not found.");
  });
});
