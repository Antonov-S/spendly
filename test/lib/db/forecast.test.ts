import { describe, it, expect, vi, beforeEach } from "vitest";
import { getScheduledItems } from "@/lib/db/forecast";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    recurringTemplate: { findMany: vi.fn() },
    recurringDraft: { findMany: vi.fn() },
  },
}));

const templateFindMany = vi.mocked(prisma.recurringTemplate.findMany);
const draftFindMany = vi.mocked(prisma.recurringDraft.findMany);

beforeEach(() => {
  vi.clearAllMocks();
  templateFindMany.mockResolvedValue([] as never);
  draftFindMany.mockResolvedValue([] as never);
});

describe("getScheduledItems — query contract", () => {
  it("scopes the template query to active, non-archived-account rows with a PENDING sub-read", async () => {
    await getScheduledItems("u1");

    const args = templateFindMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    };
    expect(args.where.userId).toBe("u1");
    expect(args.where.isActive).toBe(true);
    expect(args.where.financialAccount).toEqual({ isArchived: false });
    // hasPendingDraft is derived from a take:1 PENDING sub-read.
    expect(args.select.drafts).toEqual({
      where: { status: "PENDING" },
      select: { id: true },
      take: 1,
    });
    // Select-only projection (no Decimal-heavy full rows).
    expect(args.select).toMatchObject({
      type: true,
      amount: true,
      cadence: true,
      nextOccurrence: true,
    });
  });

  it("scopes the draft query to PENDING drafts on the user's non-archived accounts", async () => {
    await getScheduledItems("u1");

    const args = draftFindMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    };
    expect(args.where.status).toBe("PENDING");
    expect(args.where.recurringTemplate).toEqual({
      userId: "u1",
      financialAccount: { isArchived: false },
    });
    expect(args.select).toMatchObject({
      suggestedDate: true,
      suggestedAmount: true,
      recurringTemplate: { select: { type: true } },
    });
  });
});

describe("getScheduledItems — mapping", () => {
  it("maps Decimal-like amounts to positive-magnitude numbers and derives hasPendingDraft", async () => {
    templateFindMany.mockResolvedValue([
      {
        type: "EXPENSE",
        amount: "-900", // stored signed magnitude (Decimal string)
        cadence: "MONTHLY",
        nextOccurrence: new Date(Date.UTC(2026, 0, 15)),
        drafts: [{ id: "d1" }], // one PENDING draft → hasPendingDraft true
      },
      {
        type: "INCOME",
        amount: "2400",
        cadence: "MONTHLY",
        nextOccurrence: new Date(Date.UTC(2026, 0, 25)),
        drafts: [], // no pending draft
      },
    ] as never);

    const { templates } = await getScheduledItems("u1");

    expect(templates).toEqual([
      {
        type: "EXPENSE",
        amount: 900, // abs magnitude
        cadence: "MONTHLY",
        nextOccurrence: new Date(Date.UTC(2026, 0, 15)),
        hasPendingDraft: true,
      },
      {
        type: "INCOME",
        amount: 2400,
        cadence: "MONTHLY",
        nextOccurrence: new Date(Date.UTC(2026, 0, 25)),
        hasPendingDraft: false,
      },
    ]);
  });

  it("maps drafts with the parent template's type and a positive-magnitude amount", async () => {
    draftFindMany.mockResolvedValue([
      {
        suggestedDate: new Date(Date.UTC(2026, 0, 5)),
        suggestedAmount: "-13.5",
        recurringTemplate: { type: "EXPENSE" },
      },
    ] as never);

    const { drafts } = await getScheduledItems("u1");

    expect(drafts).toEqual([
      {
        type: "EXPENSE",
        amount: 13.5,
        suggestedDate: new Date(Date.UTC(2026, 0, 5)),
      },
    ]);
  });

  it("returns empty arrays when nothing is scheduled", async () => {
    const result = await getScheduledItems("u1");
    expect(result).toEqual({ templates: [], drafts: [] });
  });
});
