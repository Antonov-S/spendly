import { describe, expect, it } from "vitest";
import { acceptSplits } from "@/lib/import/split-gate";
import type { NormalizedImportRow } from "@/types/import";

function row(
  overrides: Partial<NormalizedImportRow> = {}
): NormalizedImportRow {
  return {
    source: 1,
    date: "2026-03-04",
    amount: 10,
    type: "EXPENSE",
    categoryText: null,
    merchant: null,
    note: null,
    merchantTruncated: false,
    noteTruncated: false,
    splits: [
      { category: "A", categoryId: "a", amount: 6, note: null },
      { category: "B", categoryId: "b", amount: 4, note: null },
    ],
    splitPayloadMalformed: false,
    tags: [],
    ...overrides,
  };
}

describe("acceptSplits", () => {
  it("accepts an exact expense split", () => {
    const res = acceptSplits(row());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.splits).toHaveLength(2);
  });

  it("accepts float-noise sums via cent rounding", () => {
    const res = acceptSplits(
      row({
        amount: 0.3,
        splits: [
          { category: "A", categoryId: "a", amount: 0.1, note: null },
          { category: "B", categoryId: "b", amount: 0.2, note: null },
        ],
      })
    );
    expect(res.ok).toBe(true);
  });

  it("degrades non-expense rows", () => {
    const res = acceptSplits(row({ type: "INCOME" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/only expenses/i);
  });

  it("degrades a wholly malformed split payload even when no lines survive coercion", () => {
    const res = acceptSplits(row({ splits: [], splitPayloadMalformed: true }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/couldn't read split lines/i);
  });

  it("degrades one-line, over-cap, non-positive, and mismatched splits", () => {
    expect(
      acceptSplits(
        row({ splits: [{ category: "A", categoryId: "a", amount: 10, note: null }] })
      ).ok
    ).toBe(false);
    expect(
      acceptSplits(
        row({
          splits: Array.from({ length: 21 }, (_, i) => ({
            category: `C${i}`,
            categoryId: `c${i}`,
            amount: 1,
            note: null,
          })),
        })
      ).ok
    ).toBe(false);
    expect(
      acceptSplits(
        row({
          splits: [
            { category: "A", categoryId: "a", amount: 10, note: null },
            { category: "B", categoryId: "b", amount: 0, note: null },
          ],
        })
      ).ok
    ).toBe(false);
    expect(
      acceptSplits(
        row({
          splits: [
            { category: "A", categoryId: "a", amount: 9.98, note: null },
            { category: "B", categoryId: "b", amount: 0.01, note: null },
          ],
        })
      ).ok
    ).toBe(false);
  });
});
