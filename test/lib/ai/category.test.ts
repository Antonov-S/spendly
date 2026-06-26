import { describe, it, expect } from "vitest";
import {
  parseSuggestionJson,
  matchCategoryByName,
} from "@/lib/ai/category";
import { AiParseError } from "@/lib/ai/errors";
import type { CategoryOption } from "@/types/transactions";

const categories: CategoryOption[] = [
  { id: "c1", name: "Groceries", color: "#000", icon: "ShoppingCart" },
  { id: "c2", name: "Dining", color: "#000", icon: "UtensilsCrossed" },
  { id: "c3", name: "Transport", color: "#000", icon: "Bus" },
];

describe("parseSuggestionJson", () => {
  it("parses the wrapped shape and normalizes case/whitespace", () => {
    const out = parseSuggestionJson(
      '{ "category": "  Groceries  ", "confidence": "high", "merchant": "Amazon" }'
    );
    expect(out).toEqual({
      category: "groceries",
      confidence: "high",
      merchant: "Amazon",
    });
  });

  it("accepts a bare quoted string as the category name (low confidence)", () => {
    const out = parseSuggestionJson('"Dining"');
    expect(out).toEqual({
      category: "dining",
      confidence: "low",
      merchant: null,
    });
  });

  it("falls back to the first tags[] entry when category is absent", () => {
    const out = parseSuggestionJson('{ "tags": ["Transport", "Bus"] }');
    expect(out.category).toBe("transport");
  });

  it("defaults confidence to low for any non-\"high\" value", () => {
    expect(parseSuggestionJson('{ "category": "X", "confidence": "medium" }').confidence).toBe("low");
    expect(parseSuggestionJson('{ "category": "X" }').confidence).toBe("low");
  });

  it("yields a null category (not an error) when none is usable", () => {
    expect(parseSuggestionJson('{ "category": null }').category).toBeNull();
    expect(parseSuggestionJson('{ "category": "   " }').category).toBeNull();
    expect(parseSuggestionJson("42").category).toBeNull();
  });

  it("normalizes a blank merchant to null", () => {
    expect(parseSuggestionJson('{ "category": "X", "merchant": "   " }').merchant).toBeNull();
  });

  it("throws AiParseError on empty or malformed JSON", () => {
    expect(() => parseSuggestionJson("")).toThrow(AiParseError);
    expect(() => parseSuggestionJson("   ")).toThrow(AiParseError);
    expect(() => parseSuggestionJson("{not json")).toThrow(AiParseError);
  });
});

describe("matchCategoryByName", () => {
  it("matches case-insensitively and returns the option", () => {
    expect(matchCategoryByName("groceries", categories)?.id).toBe("c1");
    expect(matchCategoryByName("DINING", categories)?.id).toBe("c2");
  });

  it("returns null for null/blank input", () => {
    expect(matchCategoryByName(null, categories)).toBeNull();
    expect(matchCategoryByName("   ", categories)).toBeNull();
  });

  it("returns null (never invents an id) for an unknown name", () => {
    expect(matchCategoryByName("rent", categories)).toBeNull();
  });
});
