import { describe, expect, it } from "vitest";
import {
  createFavoriteSchema,
  updateFavoriteSchema,
} from "@/lib/validations/favorite";
import {
  FAVORITE_NAME_MAX,
  MERCHANT_MAX,
  NOTE_MAX,
} from "@/lib/system-constants";

describe("createFavoriteSchema", () => {
  it("trims the name and optional text fields", () => {
    const res = createFavoriteSchema.safeParse({
      name: "  Coffee  ",
      type: "EXPENSE",
      amount: "3.50",
      categoryId: "",
      financialAccountId: "acc1",
      merchant: "  Cafe  ",
      note: "  morning  ",
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual({
        name: "Coffee",
        type: "EXPENSE",
        amount: 3.5,
        categoryId: null,
        financialAccountId: "acc1",
        merchant: "Cafe",
        note: "morning",
      });
    }
  });

  it("accepts nullish amount as prompt-on-use", () => {
    expect(
      createFavoriteSchema.safeParse({
        name: "Groceries",
        type: "EXPENSE",
      }).success
    ).toBe(true);
    const withNull = createFavoriteSchema.safeParse({
      name: "Groceries",
      type: "EXPENSE",
      amount: null,
    });
    expect(withNull.success).toBe(true);
    if (withNull.success) expect(withNull.data.amount).toBeNull();
  });

  it("rejects TRANSFER favorites", () => {
    expect(
      createFavoriteSchema.safeParse({
        name: "Move money",
        type: "TRANSFER",
      }).success
    ).toBe(false);
  });

  it("rejects non-positive or non-finite amounts", () => {
    for (const amount of [0, -1, Number.POSITIVE_INFINITY, "abc"]) {
      expect(
        createFavoriteSchema.safeParse({
          name: "Bad",
          type: "EXPENSE",
          amount,
        }).success
      ).toBe(false);
    }
  });

  it("enforces name, merchant, and note caps", () => {
    expect(
      createFavoriteSchema.safeParse({
        name: "x".repeat(FAVORITE_NAME_MAX + 1),
        type: "EXPENSE",
      }).success
    ).toBe(false);
    expect(
      createFavoriteSchema.safeParse({
        name: "x",
        type: "EXPENSE",
        merchant: "x".repeat(MERCHANT_MAX + 1),
      }).success
    ).toBe(false);
    expect(
      createFavoriteSchema.safeParse({
        name: "x",
        type: "EXPENSE",
        note: "x".repeat(NOTE_MAX + 1),
      }).success
    ).toBe(false);
  });
});

describe("updateFavoriteSchema", () => {
  it("is rename-only and trims the name", () => {
    const res = updateFavoriteSchema.safeParse({ name: "  Coffee  " });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data).toEqual({ name: "Coffee" });
  });

  it("rejects empty and over-long names", () => {
    expect(updateFavoriteSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(
      updateFavoriteSchema.safeParse({
        name: "x".repeat(FAVORITE_NAME_MAX + 1),
      }).success
    ).toBe(false);
  });
});
