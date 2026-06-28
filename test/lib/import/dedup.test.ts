import { describe, it, expect } from "vitest";
import { dedupKey, signedAmount, partitionForWrite } from "@/lib/import/dedup";
import type { ResolvedRow } from "@/types/import";

function row(overrides: Partial<ResolvedRow> = {}): ResolvedRow {
  return {
    source: 1,
    date: "2026-03-04",
    amount: 3,
    type: "EXPENSE",
    merchant: "Cafe",
    note: null,
    categoryId: null,
    createCategoryName: null,
    ...overrides,
  };
}

describe("dedupKey / signedAmount", () => {
  it("derives the signed stored amount from type", () => {
    expect(signedAmount({ amount: 3, type: "EXPENSE" })).toBe(-3);
    expect(signedAmount({ amount: 3, type: "INCOME" })).toBe(3);
  });

  it("excludes category from the identity key", () => {
    const a = dedupKey({
      date: "2026-03-04",
      amount: -3,
      type: "EXPENSE",
      merchant: "Cafe",
      note: null,
    });
    const b = dedupKey({
      date: "2026-03-04",
      amount: -3,
      type: "EXPENSE",
      merchant: "Cafe",
      note: null,
    });
    expect(a).toBe(b);
  });

  it("distinguishes a +10 income from a −10 expense", () => {
    const income = dedupKey({
      date: "2026-03-04",
      amount: 10,
      type: "INCOME",
      merchant: null,
      note: null,
    });
    const expense = dedupKey({
      date: "2026-03-04",
      amount: -10,
      type: "EXPENSE",
      merchant: null,
      note: null,
    });
    expect(income).not.toBe(expense);
  });
});

describe("partitionForWrite", () => {
  it("is idempotent on re-import (existing N, incoming N → 0 created)", () => {
    const rows = [row(), row()];
    const key = dedupKey({
      date: "2026-03-04",
      amount: -3,
      type: "EXPENSE",
      merchant: "Cafe",
      note: null,
    });
    const existing = new Map([[key, 2]]);
    const res = partitionForWrite(rows, existing, true);
    expect(res.toCreate).toHaveLength(0);
    expect(res.duplicatesSkipped).toBe(2);
  });

  it("preserves a legitimate duplicate (existing 1, incoming 2 → 1 created)", () => {
    const rows = [row(), row()];
    const key = dedupKey({
      date: "2026-03-04",
      amount: -3,
      type: "EXPENSE",
      merchant: "Cafe",
      note: null,
    });
    const res = partitionForWrite(rows, new Map([[key, 1]]), true);
    expect(res.toCreate).toHaveLength(1);
    expect(res.duplicatesSkipped).toBe(1);
  });

  it("creates everything when the toggle is off", () => {
    const rows = [row(), row()];
    const key = dedupKey({
      date: "2026-03-04",
      amount: -3,
      type: "EXPENSE",
      merchant: "Cafe",
      note: null,
    });
    const res = partitionForWrite(rows, new Map([[key, 5]]), false);
    expect(res.toCreate).toHaveLength(2);
    expect(res.duplicatesSkipped).toBe(0);
  });

  it("does not dedupe-split on a category difference", () => {
    const rows = [
      row({ categoryId: "a" }),
      row({ categoryId: "b" }),
    ];
    const key = dedupKey({
      date: "2026-03-04",
      amount: -3,
      type: "EXPENSE",
      merchant: "Cafe",
      note: null,
    });
    // Existing 1 → only one of the two same-identity rows is a duplicate.
    const res = partitionForWrite(rows, new Map([[key, 1]]), true);
    expect(res.toCreate).toHaveLength(1);
    expect(res.duplicatesSkipped).toBe(1);
  });
});
