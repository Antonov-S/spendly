import { describe, it, expect } from "vitest";
import { suggestMapping, applyMapping } from "@/lib/import/mapping";
import type { ImportMapping } from "@/types/import";

describe("suggestMapping", () => {
  it("maps a Spendly-exported header with zero clicks", () => {
    const mapping = suggestMapping([
      "Date",
      "Amount",
      "Type",
      "Category",
      "Account",
      "Merchant",
      "Note",
    ]);
    expect(mapping).toMatchObject({
      date: 0,
      amount: 1,
      type: 2,
      category: 3,
      merchant: 5,
      note: 6,
    });
  });

  it("matches synonyms case-insensitively (Payee → merchant)", () => {
    const mapping = suggestMapping(["DATE", "VALUE", "PAYEE"]);
    expect(mapping.date).toBe(0);
    expect(mapping.amount).toBe(1);
    expect(mapping.merchant).toBe(2);
  });

  it("leaves an unmatched required field null", () => {
    const mapping = suggestMapping(["Foo", "Bar"]);
    expect(mapping.date).toBeNull();
    expect(mapping.amount).toBeNull();
  });

  it("suggests the first of two tied headers and leaves the rest", () => {
    const mapping = suggestMapping(["Amount", "Amount"]);
    expect(mapping.amount).toBe(0);
  });
});

describe("applyMapping", () => {
  const mapping: ImportMapping = {
    date: 0,
    amount: 1,
    type: null,
    category: null,
    merchant: 2,
    note: null,
  };

  it("reads cells by column index", () => {
    const out = applyMapping(["2026-01-01", "10", "Pret"], mapping);
    expect(out.date).toBe("2026-01-01");
    expect(out.amount).toBe("10");
    expect(out.merchant).toBe("Pret");
    expect(out.type).toBeNull();
  });

  it("binds duplicate-named columns to the chosen index, not the first match", () => {
    // Two 'Amount' columns; the user mapped amount → index 4 (col 5).
    const dupMapping: ImportMapping = {
      date: 0,
      amount: 4,
      type: null,
      category: null,
      merchant: null,
      note: null,
    };
    const out = applyMapping(["d", "100", "x", "y", "999"], dupMapping);
    expect(out.amount).toBe("999");
  });

  it("returns null for an out-of-range or unmapped index", () => {
    const out = applyMapping(["2026-01-01"], mapping);
    expect(out.amount).toBeNull(); // index 1 out of range
    expect(out.note).toBeNull(); // unmapped
  });
});
