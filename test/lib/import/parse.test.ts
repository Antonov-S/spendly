import { describe, it, expect } from "vitest";
import {
  parseDateFlexible,
  parseAmount,
  resolveType,
  normalizeCsvRow,
  normalizeJsonRow,
} from "@/lib/import/parse";
import type { ImportMapping } from "@/types/import";

describe("parseDateFlexible", () => {
  it("normalizes each whitelisted format to ISO", () => {
    expect(parseDateFlexible("2026-03-04", "YYYY-MM-DD")).toBe("2026-03-04");
    expect(parseDateFlexible("03/04/2026", "MM/DD/YYYY")).toBe("2026-03-04");
    expect(parseDateFlexible("03/04/2026", "DD/MM/YYYY")).toBe("2026-04-03");
    expect(parseDateFlexible("03.04.2026", "DD.MM.YYYY")).toBe("2026-04-03");
  });

  it("pads single-digit month/day", () => {
    expect(parseDateFlexible("2026-1-2", "YYYY-MM-DD")).toBe("2026-01-02");
  });

  it("rejects an impossible calendar date", () => {
    expect(parseDateFlexible("02/30/2026", "MM/DD/YYYY")).toBeNull();
  });

  it("returns null for junk or a wrong-format value", () => {
    expect(parseDateFlexible("not a date", "YYYY-MM-DD")).toBeNull();
    expect(parseDateFlexible("03/04/2026", "YYYY-MM-DD")).toBeNull();
    expect(parseDateFlexible("", "YYYY-MM-DD")).toBeNull();
    expect(parseDateFlexible(null, "YYYY-MM-DD")).toBeNull();
  });
});

describe("parseAmount", () => {
  it("parses a European amount with comma decimal", () => {
    expect(parseAmount("€1.234,56", ",")).toEqual({
      magnitude: 1234.56,
      negative: false,
    });
  });

  it("parses a US amount with dot decimal", () => {
    expect(parseAmount("1,234.56", ".")).toEqual({
      magnitude: 1234.56,
      negative: false,
    });
  });

  it("treats parentheses and leading minus as negative", () => {
    expect(parseAmount("(12.00)", ".")).toEqual({
      magnitude: 12,
      negative: true,
    });
    expect(parseAmount("-47.00", ".")).toEqual({
      magnitude: 47,
      negative: true,
    });
  });

  it("strips currency symbols and whitespace", () => {
    expect(parseAmount("  $ 99.50 ", ".")).toEqual({
      magnitude: 99.5,
      negative: false,
    });
  });

  it("auto-detects the decimal when no override is given", () => {
    expect(parseAmount("9,99", null)).toEqual({
      magnitude: 9.99,
      negative: false,
    });
  });

  it("returns null for non-numeric input", () => {
    expect(parseAmount("abc", ".")).toBeNull();
    expect(parseAmount("", ".")).toBeNull();
    expect(parseAmount(null, ".")).toBeNull();
  });
});

describe("resolveType", () => {
  it("maps a mapped type cell case-insensitively", () => {
    expect(resolveType("income", false)).toBe("INCOME");
    expect(resolveType("Expense", false)).toBe("EXPENSE");
    expect(resolveType("TRANSFER", false)).toBe("TRANSFER");
  });

  it("derives from the amount sign when there is no type cell", () => {
    expect(resolveType(null, true)).toBe("EXPENSE");
    expect(resolveType("", false)).toBe("INCOME");
  });

  it("returns null for an unknown token", () => {
    expect(resolveType("refund", false)).toBeNull();
  });
});

const CSV_MAPPING: ImportMapping = {
  date: 0,
  amount: 1,
  type: 2,
  category: 3,
  merchant: 4,
  note: 5,
};

describe("normalizeCsvRow", () => {
  it("normalizes a full row through the mapping", () => {
    const row = normalizeCsvRow(
      ["2026-03-04", "12.50", "EXPENSE", "Dining", "Pret", "lunch"],
      CSV_MAPPING,
      "YYYY-MM-DD",
      ".",
      1
    );
    expect(row).toMatchObject({
      source: 1,
      date: "2026-03-04",
      amount: 12.5,
      type: "EXPENSE",
      categoryText: "Dining",
      merchant: "Pret",
      note: "lunch",
      splits: [],
      tags: [],
    });
  });

  it("nulls whitespace-only merchant/note/category", () => {
    const row = normalizeCsvRow(
      ["2026-03-04", "1", "INCOME", "   ", "  ", "\t"],
      CSV_MAPPING,
      "YYYY-MM-DD",
      ".",
      2
    );
    expect(row.merchant).toBeNull();
    expect(row.note).toBeNull();
    expect(row.categoryText).toBeNull();
  });

  it("truncates over-cap merchant/note and flags it", () => {
    const longMerchant = "m".repeat(200);
    const longNote = "n".repeat(600);
    const row = normalizeCsvRow(
      ["2026-03-04", "1", "INCOME", "Cat", longMerchant, longNote],
      CSV_MAPPING,
      "YYYY-MM-DD",
      ".",
      3
    );
    expect(row.merchant).toHaveLength(120);
    expect(row.merchantTruncated).toBe(true);
    expect(row.note).toHaveLength(500);
    expect(row.noteTruncated).toBe(true);
  });

  it("falls back to null for over-cap category text (never a truncated category)", () => {
    const longCat = "c".repeat(60);
    const row = normalizeCsvRow(
      ["2026-03-04", "1", "INCOME", longCat, "m", "n"],
      CSV_MAPPING,
      "YYYY-MM-DD",
      ".",
      4
    );
    expect(row.categoryText).toBeNull();
  });

  it("marks a row invalid (nulls) when required cells are missing/unparseable", () => {
    const row = normalizeCsvRow(
      ["bad-date", "xyz", "EXPENSE", "Cat", "m", "n"],
      CSV_MAPPING,
      "YYYY-MM-DD",
      ".",
      5
    );
    expect(row.date).toBeNull();
    expect(row.amount).toBeNull();
  });
});

describe("normalizeJsonRow", () => {
  it("maps a signed export row to magnitude + type", () => {
    const row = normalizeJsonRow(
      {
        date: "2026-03-04",
        amount: -12.5,
        type: "EXPENSE",
        category: "Dining",
        merchant: "Pret",
        note: "lunch",
      },
      1
    );
    expect(row).toMatchObject({
      date: "2026-03-04",
      amount: 12.5,
      type: "EXPENSE",
      categoryText: "Dining",
      merchant: "Pret",
      splits: [],
      splitPayloadMalformed: false,
      tags: [],
    });
  });

  it("preserves a TRANSFER row (skipped downstream)", () => {
    const row = normalizeJsonRow(
      { date: "2026-03-04", amount: 50, type: "TRANSFER" },
      2
    );
    expect(row.type).toBe("TRANSFER");
  });

  it("nulls out malformed fields rather than throwing", () => {
    const row = normalizeJsonRow(
      { date: 123, amount: "oops", type: 7, category: 9 },
      3
    );
    expect(row.date).toBeNull();
    expect(row.amount).toBeNull();
    expect(row.type).toBeNull();
    expect(row.categoryText).toBeNull();
  });

  it("defensively coerces split entries and drops malformed ones", () => {
    const row = normalizeJsonRow(
      {
        date: "2026-03-04",
        amount: -10,
        type: "EXPENSE",
        splits: [
          { category: "Food", categoryId: "c1", amount: 6, note: "x".repeat(130) },
          { category: 1, amount: 4, note: null },
          { category: "Bad", amount: 0 },
          "not-object",
        ],
      },
      4
    );
    expect(row.splits).toEqual([
      { category: "Food", categoryId: "c1", amount: 6, note: "x".repeat(120) },
      { category: null, categoryId: null, amount: 4, note: null },
    ]);
    expect(row.splitPayloadMalformed).toBe(false);
  });

  it("marks wholly malformed split payloads so preview can show a split issue", () => {
    expect(
      normalizeJsonRow(
        {
          date: "2026-03-04",
          amount: -10,
          type: "EXPENSE",
          splits: { nope: true },
        },
        6
      ).splitPayloadMalformed
    ).toBe(true);

    const allDropped = normalizeJsonRow(
      {
        date: "2026-03-04",
        amount: -10,
        type: "EXPENSE",
        splits: [{ amount: 0 }, "not-object"],
      },
      7
    );
    expect(allDropped.splits).toEqual([]);
    expect(allDropped.splitPayloadMalformed).toBe(true);
  });

  it("normalizes tags with trim, case-insensitive dedup, max length, and cap", () => {
    const row = normalizeJsonRow(
      {
        date: "2026-03-04",
        amount: 10,
        type: "INCOME",
        tags: [
          " Trip ",
          "trip",
          "Receipt",
          "x".repeat(40),
          ...Array.from({ length: 20 }, (_, i) => `tag-${i}`),
        ],
      },
      5
    );
    expect(row.tags).toHaveLength(12);
    expect(row.tags.slice(0, 3)).toEqual(["Trip", "Receipt", "tag-0"]);
    expect(row.tags).not.toContain("x".repeat(40));
  });
});
