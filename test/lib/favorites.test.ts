import { describe, expect, it } from "vitest";
import { buildFavoritePrefill } from "@/lib/favorites";
import type { FavoriteOption } from "@/types/favorites";

const BASE: FavoriteOption = {
  id: "fav1",
  name: "Coffee",
  type: "EXPENSE",
  amount: 3.5,
  categoryId: "cat1",
  financialAccountId: "acc1",
  merchant: "Cafe",
  note: "morning",
};

const loaded = {
  categoryIds: new Set(["cat1"]),
  accountIds: new Set(["acc1"]),
};

describe("buildFavoritePrefill", () => {
  it("builds a complete wholesale patch for a fixed-amount favorite", () => {
    expect(buildFavoritePrefill(BASE, loaded, "2026-07-05")).toEqual({
      type: "EXPENSE",
      amount: "3.5",
      focusAmount: false,
      date: "2026-07-05",
      categoryId: "cat1",
      accountId: "acc1",
      merchant: "Cafe",
      note: "morning",
    });
  });

  it("clears and focuses amount for prompt-on-use favorites", () => {
    const prefill = buildFavoritePrefill(
      { ...BASE, amount: null },
      loaded,
      "2026-07-05"
    );

    expect(prefill.amount).toBe("");
    expect(prefill.focusAmount).toBe(true);
  });

  it("falls back to Uncategorized when the category is absent or null", () => {
    expect(
      buildFavoritePrefill(
        { ...BASE, categoryId: "missing" },
        loaded,
        "2026-07-05"
      ).categoryId
    ).toBe("");
    expect(
      buildFavoritePrefill(
        { ...BASE, categoryId: null },
        loaded,
        "2026-07-05"
      ).categoryId
    ).toBe("");
  });

  it("leaves the current account untouched when the stored account is absent or null", () => {
    expect(
      buildFavoritePrefill(
        { ...BASE, financialAccountId: "archived" },
        loaded,
        "2026-07-05"
      ).accountId
    ).toBeNull();
    expect(
      buildFavoritePrefill(
        { ...BASE, financialAccountId: null },
        loaded,
        "2026-07-05"
      ).accountId
    ).toBeNull();
  });

  it("normalizes null merchant and note to empty strings", () => {
    const prefill = buildFavoritePrefill(
      { ...BASE, merchant: null, note: null },
      loaded,
      "2026-07-05"
    );

    expect(prefill.merchant).toBe("");
    expect(prefill.note).toBe("");
  });

  it("is deterministic for the same inputs", () => {
    const first = buildFavoritePrefill(BASE, loaded, "2026-07-05");
    const second = buildFavoritePrefill(BASE, loaded, "2026-07-05");
    expect(second).toEqual(first);
  });
});
