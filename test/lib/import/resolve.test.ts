import { describe, it, expect } from "vitest";
import {
  normalizeCatKey,
  buildCategoryIndex,
  buildCategoryIdSet,
  buildTagIndex,
  resolveCategory,
  resolveSplitCategory,
  resolveTag,
} from "@/lib/import/resolve";

describe("normalizeCatKey", () => {
  it("trims, collapses internal whitespace, and lower-cases", () => {
    expect(normalizeCatKey("  Coffee  ")).toBe("coffee");
    expect(normalizeCatKey("Eating   Out")).toBe("eating out");
    expect(normalizeCatKey("COFFEE")).toBe("coffee");
  });

  it("produces the same key for NFC and NFD spellings of café", () => {
    const nfc = "café"; // café (single codepoint é)
    const nfd = "café"; // café (e + combining acute)
    expect(normalizeCatKey(nfc)).toBe(normalizeCatKey(nfd));
  });
});

describe("resolveSplitCategory", () => {
  const cats = [
    { id: "sys-groceries", name: "Groceries" },
    { id: "own-coffee", name: "Coffee" },
  ];
  const index = buildCategoryIndex(cats);
  const ids = buildCategoryIdSet(cats);

  it("uses name match first", () => {
    expect(
      resolveSplitCategory(
        { category: "Groceries", categoryId: "own-coffee" },
        index,
        ids,
        "CREATE"
      )
    ).toEqual({ categoryId: "sys-groceries", createCategoryName: null });
  });

  it("falls back to owned/system id when name is absent or unmatched", () => {
    expect(
      resolveSplitCategory(
        { category: null, categoryId: "own-coffee" },
        index,
        ids,
        "CREATE"
      )
    ).toEqual({ categoryId: "own-coffee", createCategoryName: null });
    expect(
      resolveSplitCategory(
        { category: "Old Coffee", categoryId: "own-coffee" },
        index,
        ids,
        "CREATE"
      )
    ).toEqual({ categoryId: "own-coffee", createCategoryName: null });
  });

  it("falls through to the name policy when name and id do not resolve", () => {
    expect(
      resolveSplitCategory(
        { category: "Travel", categoryId: "foreign" },
        index,
        ids,
        "CREATE"
      )
    ).toEqual({ categoryId: null, createCategoryName: "Travel" });
    expect(
      resolveSplitCategory(
        { category: "Travel", categoryId: "foreign" },
        index,
        ids,
        "UNCATEGORIZED"
      )
    ).toEqual({ categoryId: null, createCategoryName: null });
  });

  it("returns null when there is no category signal", () => {
    expect(
      resolveSplitCategory(
        { category: null, categoryId: null },
        index,
        ids,
        "CREATE"
      )
    ).toEqual({ categoryId: null, createCategoryName: null });
  });
});

describe("buildTagIndex / resolveTag", () => {
  const index = buildTagIndex([
    { id: "tag-trip", name: "Trip" },
    { id: "tag-receipt", name: "Receipt" },
  ]);

  it("matches existing tags by normalized label key", () => {
    expect(resolveTag(" trip ", index)).toEqual({
      tagId: "tag-trip",
      createName: null,
    });
  });

  it("returns a create name for missing tags", () => {
    expect(resolveTag(" New Tag ", index)).toEqual({
      tagId: null,
      createName: "New Tag",
    });
  });
});

describe("buildCategoryIndex / resolveCategory", () => {
  const index = buildCategoryIndex([
    { id: "sys-groceries", name: "Groceries" },
    { id: "own-coffee", name: "Coffee" },
  ]);

  it("matches an existing category under the normalized key", () => {
    expect(resolveCategory("  groceries ", index, "CREATE")).toEqual({
      categoryId: "sys-groceries",
    });
    expect(resolveCategory("COFFEE", index, "UNCATEGORIZED")).toEqual({
      categoryId: "own-coffee",
    });
  });

  it("returns a createName for an unmatched name under CREATE", () => {
    expect(resolveCategory("  New   Cat ", index, "CREATE")).toEqual({
      createName: "New Cat",
    });
  });

  it("returns null for an unmatched name under UNCATEGORIZED", () => {
    expect(resolveCategory("Mystery", index, "UNCATEGORIZED")).toEqual({
      categoryId: null,
    });
  });

  it("returns null for empty/blank/null text", () => {
    expect(resolveCategory("   ", index, "CREATE")).toEqual({
      categoryId: null,
    });
    expect(resolveCategory(null, index, "CREATE")).toEqual({
      categoryId: null,
    });
  });

  it("never creates an over-cap category name (falls back to null)", () => {
    const longName = "x".repeat(60);
    expect(resolveCategory(longName, index, "CREATE")).toEqual({
      categoryId: null,
    });
  });

  it("never returns an id absent from the index", () => {
    const res = resolveCategory("groceries", index, "CREATE");
    expect(res).toEqual({ categoryId: "sys-groceries" });
  });
});
