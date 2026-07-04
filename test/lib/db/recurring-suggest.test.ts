import { describe, it, expect, vi, beforeEach } from "vitest";
import { getRecurringSuggestions } from "@/lib/db/recurring-suggest";
import { prisma } from "@/lib/prisma";
import { track } from "@/lib/analytics/track";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findMany: vi.fn() },
    recurringTemplate: { findMany: vi.fn() },
    recurringSuggestionMute: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));

const txFindMany = vi.mocked(prisma.transaction.findMany);
const templateFindMany = vi.mocked(prisma.recurringTemplate.findMany);
const muteFindMany = vi.mocked(prisma.recurringSuggestionMute.findMany);
const mockTrack = vi.mocked(track);

const NOW = new Date(Date.UTC(2026, 5, 20)); // 2026-06-20

/** A monthly EXPENSE candidate row (Decimal-like negative amount, like storage). */
function row(month: number, amount: string, merchant = "Netflix") {
  return {
    merchant,
    amount, // stored signed magnitude as a Decimal string
    type: "EXPENSE",
    date: new Date(Date.UTC(2026, month - 1, 15)),
    categoryId: null,
    financialAccountId: "acc1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  templateFindMany.mockResolvedValue([] as never);
  muteFindMany.mockResolvedValue([] as never);
});

describe("getRecurringSuggestions — candidate query contract", () => {
  it("scopes the candidate query with all six §3 predicates and the lookback window", async () => {
    txFindMany.mockResolvedValue([] as never);

    await getRecurringSuggestions("u1", NOW);

    const args = txFindMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      orderBy: unknown;
      select: Record<string, boolean>;
    };
    expect(args.where.userId).toBe("u1");
    expect(args.where.deletedAt).toBeNull();
    expect(args.where.merchant).toEqual({ not: null });
    expect(args.where.type).toEqual({ in: ["INCOME", "EXPENSE"] });
    expect(args.where.isTransferLeg).toBe(false);
    expect(args.where.recurringTemplateId).toBeNull();
    expect(args.where.financialAccount).toEqual({ isArchived: false });
    // 12-month lookback before 2026-06-20 → 2025-06-20 (UTC midnight).
    expect(args.where.date).toEqual({ gte: new Date(Date.UTC(2025, 5, 20)) });
    expect(args.orderBy).toEqual({ date: "asc" });
    // Selected columns only.
    expect(args.select).toEqual({
      merchant: true,
      amount: true,
      type: true,
      date: true,
      categoryId: true,
      financialAccountId: true,
    });
  });

  it("maps Decimal-like amounts to positive magnitudes before detection", async () => {
    txFindMany.mockResolvedValue([
      row(4, "-12.99"),
      row(5, "-12.99"),
      row(6, "-12.99"),
    ] as never);

    const res = await getRecurringSuggestions("u1", NOW);

    expect(res.suggestions).toHaveLength(1);
    expect(res.suggestions[0].amount).toBe(12.99); // abs-mapped
  });

  it("reads templates and mutes in parallel and feeds them to suppression", async () => {
    txFindMany.mockResolvedValue([
      row(4, "-20", "Rent"),
      row(5, "-20", "Rent"),
      row(6, "-20", "Rent"),
    ] as never);
    // A mute on the same normalized key suppresses the group.
    muteFindMany.mockResolvedValue([{ merchantKey: "rent" }] as never);

    const res = await getRecurringSuggestions("u1", NOW);

    expect(templateFindMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      select: { name: true },
    });
    expect(muteFindMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      select: { merchantKey: true },
    });
    expect(res.suggestions).toHaveLength(0);
    expect(res.detectedCount).toBe(0);
  });
});

describe("getRecurringSuggestions — telemetry", () => {
  it("emits one impression event with count/cadence props when patterns are found", async () => {
    txFindMany.mockResolvedValue([
      row(4, "-12.99"),
      row(5, "-12.99"),
      row(6, "-12.99"),
    ] as never);

    await getRecurringSuggestions("u1", NOW);

    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith("recurring_suggested", {
      detected: 1,
      surfaced: 1,
      weekly: 0,
      monthly: 1,
    });
  });

  it("stays silent when nothing is detected", async () => {
    txFindMany.mockResolvedValue([] as never);

    await getRecurringSuggestions("u1", NOW);

    expect(mockTrack).not.toHaveBeenCalled();
  });
});
