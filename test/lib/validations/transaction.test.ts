import { describe, it, expect } from "vitest";
import { createTransactionSchema } from "@/lib/validations/transaction";
import { SPLIT_MAX_LINES } from "@/lib/system-constants";

const base = {
  amount: 80,
  date: "2026-06-15",
  financialAccountId: "a1",
};

function twoLines(a = 55, b = 25) {
  return [
    { categoryId: "c1", amount: a },
    { categoryId: "c2", amount: b },
  ];
}

describe("createTransactionSchema — splits", () => {
  it("accepts a valid 2-line EXPENSE split that sums to the total", () => {
    const r = createTransactionSchema.safeParse({
      ...base,
      type: "EXPENSE",
      splits: twoLines(),
    });
    expect(r.success).toBe(true);
  });

  it("defaults splits to [] when omitted (non-split path unaffected)", () => {
    const r = createTransactionSchema.safeParse({
      ...base,
      type: "EXPENSE",
      categoryId: "c1",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.splits).toEqual([]);
  });

  it("accepts a SPLIT_MAX_LINES split", () => {
    const per = 80 / SPLIT_MAX_LINES;
    const lines = Array.from({ length: SPLIT_MAX_LINES }, (_, i) => ({
      categoryId: `c${i}`,
      amount: per,
    }));
    const r = createTransactionSchema.safeParse({
      ...base,
      type: "EXPENSE",
      splits: lines,
    });
    expect(r.success).toBe(true);
  });

  it("rejects more than SPLIT_MAX_LINES lines", () => {
    const lines = Array.from({ length: SPLIT_MAX_LINES + 1 }, (_, i) => ({
      categoryId: `c${i}`,
      amount: 1,
    }));
    const r = createTransactionSchema.safeParse({
      ...base,
      amount: SPLIT_MAX_LINES + 1,
      type: "EXPENSE",
      splits: lines,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-EXPENSE split", () => {
    const r = createTransactionSchema.safeParse({
      ...base,
      type: "INCOME",
      splits: twoLines(),
    });
    expect(r.success).toBe(false);
    if (!r.success)
      expect(r.error.issues.some((i) => /only expenses/i.test(i.message))).toBe(
        true
      );
  });

  it("rejects a single-line split (below the minimum)", () => {
    const r = createTransactionSchema.safeParse({
      ...base,
      amount: 55,
      type: "EXPENSE",
      splits: [{ categoryId: "c1", amount: 55 }],
    });
    expect(r.success).toBe(false);
    if (!r.success)
      expect(r.error.issues.some((i) => /at least/i.test(i.message))).toBe(true);
  });

  it("rejects a split combined with a top-level category", () => {
    const r = createTransactionSchema.safeParse({
      ...base,
      type: "EXPENSE",
      categoryId: "c9",
      splits: twoLines(),
    });
    expect(r.success).toBe(false);
    if (!r.success)
      expect(r.error.issues.some((i) => /remove the category/i.test(i.message))).toBe(
        true
      );
  });

  it("rejects lines that don't sum to the total (off by a cent)", () => {
    const r = createTransactionSchema.safeParse({
      ...base,
      type: "EXPENSE",
      splits: twoLines(55, 24.99),
    });
    expect(r.success).toBe(false);
    if (!r.success)
      expect(r.error.issues.some((i) => /add up/i.test(i.message))).toBe(true);
  });

  it("rejects a split line missing a category", () => {
    const r = createTransactionSchema.safeParse({
      ...base,
      type: "EXPENSE",
      splits: [
        { categoryId: "", amount: 55 },
        { categoryId: "c2", amount: 25 },
      ],
    });
    expect(r.success).toBe(false);
  });
});
