import { describe, it, expect, vi, beforeEach } from "vitest";
import { generatePendingDrafts } from "@/lib/db/recurring";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    recurringTemplate: { findMany: vi.fn() },
    recurringDraft: { createMany: vi.fn() },
  },
}));

const findMany = vi.mocked(prisma.recurringTemplate.findMany);
const createMany = vi.mocked(prisma.recurringDraft.createMany);

/** A due template (no pending draft) as returned by the generation query. */
function dueTemplate(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    nextOccurrence: new Date("2026-06-10T00:00:00.000Z"),
    amount: "12.99",
    drafts: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generatePendingDrafts", () => {
  it("creates one PENDING draft per due template with no existing pending draft", async () => {
    findMany.mockResolvedValue([dueTemplate("t1"), dueTemplate("t2")] as never);
    createMany.mockResolvedValue({ count: 2 } as never);

    await generatePendingDrafts("u1");

    const args = createMany.mock.calls[0][0] as {
      data: { recurringTemplateId: string }[];
      skipDuplicates: boolean;
    };
    expect(args.data.map((d) => d.recurringTemplateId)).toEqual(["t1", "t2"]);
    // The partial-index race guard is leaned on via skipDuplicates.
    expect(args.skipDuplicates).toBe(true);
  });

  it("snapshots the template's date and amount onto the draft", async () => {
    findMany.mockResolvedValue([dueTemplate("t1")] as never);
    createMany.mockResolvedValue({ count: 1 } as never);

    await generatePendingDrafts("u1");

    const row = (createMany.mock.calls[0][0] as { data: Record<string, unknown>[] })
      .data[0];
    expect(row.suggestedDate).toEqual(new Date("2026-06-10T00:00:00.000Z"));
    expect(row.suggestedAmount).toBe("12.99");
  });

  it("skips a template that already has a PENDING draft", async () => {
    findMany.mockResolvedValue([
      dueTemplate("t1", { drafts: [{ id: "existing" }] }),
    ] as never);

    await generatePendingDrafts("u1");

    expect(createMany).not.toHaveBeenCalled();
  });

  it("does nothing when no templates are due", async () => {
    findMany.mockResolvedValue([] as never);

    await generatePendingDrafts("u1");

    expect(createMany).not.toHaveBeenCalled();
  });

  it("queries only active templates due on or before today, scoped to the user", async () => {
    findMany.mockResolvedValue([] as never);

    await generatePendingDrafts("u1");

    const where = findMany.mock.calls[0][0]?.where as Record<string, unknown>;
    expect(where.userId).toBe("u1");
    expect(where.isActive).toBe(true);
    expect(where.nextOccurrence).toHaveProperty("lte");
  });
});
