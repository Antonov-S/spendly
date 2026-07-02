import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCategorySpend } from "@/lib/db/split-spend";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { groupBy: vi.fn() },
    transactionSplit: { groupBy: vi.fn() },
  },
}));

const txGroupBy = vi.mocked(prisma.transaction.groupBy);
const splitGroupBy = vi.mocked(prisma.transactionSplit.groupBy);
const WINDOW = { gte: new Date("2026-06-01"), lt: new Date("2026-07-01") };

const grandTotal = (m: Map<string | null, number>) =>
  [...m.values()].reduce((s, v) => s + v, 0);

beforeEach(() => {
  txGroupBy.mockReset();
  splitGroupBy.mockReset();
});

/**
 * Converting a single-category expense into a split of the SAME total must leave
 * every derived total invariant — splitting re-attributes spend, it never creates
 * or destroys it. All four consuming surfaces (getBudgets, resolveRolloverCarry,
 * getBudgetsData, getCategoryBreakdown) route category spend through
 * getCategorySpend, so exercising it against the same €80 both ways guards the
 * whole class. The amount+date surfaces (income-vs-expenses, cashflow, balances)
 * are invariant by construction — they never read category — so they need no
 * mock here (documented in §7).
 */
describe("split conversion conserves spend across surfaces", () => {
  it("keeps the grand total identical while moving only per-category attribution", async () => {
    // BEFORE: one €80 expense wholly in c1 (no split lines).
    txGroupBy.mockResolvedValue([
      { categoryId: "c1", _sum: { amount: -80 } },
    ] as never);
    splitGroupBy.mockResolvedValue([] as never);
    const before = await getCategorySpend("u1", WINDOW);

    // AFTER: same €80, now split 55→c1 / 25→c2. The parent (categoryId null +
    // has children) drops out of query (a); its amount re-enters via query (b).
    txGroupBy.mockResolvedValue([] as never);
    splitGroupBy.mockResolvedValue([
      { categoryId: "c1", _sum: { amount: 55 } },
      { categoryId: "c2", _sum: { amount: 25 } },
    ] as never);
    const after = await getCategorySpend("u1", WINDOW);

    // Conservation: the grand total is unchanged.
    expect(grandTotal(after)).toBe(grandTotal(before));
    expect(grandTotal(after)).toBe(80);

    // Only attribution moved: c1 shrinks from 80→55, c2 appears at 25.
    expect(before.get("c1")).toBe(80);
    expect(before.has("c2")).toBe(false);
    expect(after.get("c1")).toBe(55);
    expect(after.get("c2")).toBe(25);
  });

  it("a rollover-carry period that includes the converted month sees the same total", async () => {
    // resolveRolloverCarry reads a past month's spend via getCategorySpend too;
    // the converted month's total must be unchanged when carried forward.
    txGroupBy.mockResolvedValue([] as never);
    // The real WHERE scopes to categoryIds; the mock returns c1's share only.
    splitGroupBy.mockResolvedValue([
      { categoryId: "c1", _sum: { amount: 55 } },
    ] as never);
    const scopedToC1 = await getCategorySpend("u1", WINDOW, {
      categoryIds: ["c1"],
    });
    // c1 sees the same 55 it contributes — the amount carried against its budget.
    expect(scopedToC1.get("c1")).toBe(55);
    expect(
      (splitGroupBy.mock.calls[0][0].where as { categoryId?: unknown }).categoryId
    ).toEqual({ in: ["c1"] });
  });
});
