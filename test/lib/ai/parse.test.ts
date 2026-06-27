import { describe, it, expect } from "vitest";
import { parseDraftJson, resolveDraftDate } from "@/lib/ai/parse";
import { AiParseError } from "@/lib/ai/errors";
import { todayDateInputValue } from "@/lib/date";

describe("parseDraftJson", () => {
  it("parses the wrapped shape and normalizes each field", () => {
    const out = parseDraftJson(
      '{ "type": "EXPENSE", "amount": 12.5, "date": "2026-06-26", "category": "  Dining  ", "merchant": "  Pret  ", "note": "lunch", "confidence": "high" }'
    );
    expect(out).toEqual({
      type: "EXPENSE",
      amount: 12.5,
      date: "2026-06-26",
      category: "dining", // lowercased + trimmed
      merchant: "Pret", // trimmed, original case
      note: "lunch",
      confidence: "high",
    });
  });

  it("defaults type to EXPENSE unless the model said INCOME exactly", () => {
    expect(parseDraftJson('{ "type": "INCOME", "amount": 5 }').type).toBe(
      "INCOME"
    );
    expect(parseDraftJson('{ "type": "income", "amount": 5 }').type).toBe(
      "EXPENSE"
    );
    expect(parseDraftJson('{ "amount": 5 }').type).toBe("EXPENSE");
    expect(parseDraftJson('{ "type": "TRANSFER", "amount": 5 }').type).toBe(
      "EXPENSE"
    );
  });

  it("returns a positive magnitude and rejects NaN/0/non-numeric", () => {
    expect(parseDraftJson('{ "amount": -12 }').amount).toBe(12); // Math.abs
    expect(parseDraftJson('{ "amount": 0 }').amount).toBeNull();
    expect(parseDraftJson('{ "amount": null }').amount).toBeNull();
    expect(parseDraftJson('{ "amount": "abc" }').amount).toBeNull(); // no number
    expect(parseDraftJson('{ "amount": {} }').amount).toBeNull(); // object
  });

  it("coerces a numeric string amount, even with a currency word or EU comma", () => {
    expect(parseDraftJson('{ "amount": "12" }').amount).toBe(12);
    expect(parseDraftJson('{ "amount": "15 euro" }').amount).toBe(15);
    expect(parseDraftJson('{ "amount": "€15.50" }').amount).toBe(15.5);
    expect(parseDraftJson('{ "amount": "15,50" }').amount).toBe(15.5);
  });

  it("treats a well-formed payload with amount null as NOT an error", () => {
    const out = parseDraftJson('{ "category": "groceries" }');
    expect(out.amount).toBeNull();
    expect(out.category).toBe("groceries");
  });

  it("defaults confidence to low for any non-\"high\" value", () => {
    expect(
      parseDraftJson('{ "amount": 1, "confidence": "medium" }').confidence
    ).toBe("low");
    expect(parseDraftJson('{ "amount": 1 }').confidence).toBe("low");
    expect(
      parseDraftJson('{ "amount": 1, "confidence": "high" }').confidence
    ).toBe("high");
  });

  it("normalizes blank/absent merchant, note and category to null", () => {
    const out = parseDraftJson(
      '{ "amount": 1, "merchant": "   ", "note": "", "category": "   " }'
    );
    expect(out.merchant).toBeNull();
    expect(out.note).toBeNull();
    expect(out.category).toBeNull();
  });

  it("yields a null-amount EXPENSE draft for a useless non-object payload", () => {
    const out = parseDraftJson("42");
    expect(out).toEqual({
      type: "EXPENSE",
      amount: null,
      date: null,
      category: null,
      merchant: null,
      note: null,
      confidence: "low",
    });
  });

  it("throws AiParseError on empty or malformed JSON", () => {
    expect(() => parseDraftJson("")).toThrow(AiParseError);
    expect(() => parseDraftJson("   ")).toThrow(AiParseError);
    expect(() => parseDraftJson("{not json")).toThrow(AiParseError);
  });
});

describe("resolveDraftDate", () => {
  it("passes a valid YYYY-MM-DD through unchanged", () => {
    expect(resolveDraftDate("2026-06-26")).toBe("2026-06-26");
  });

  it("falls back to today for empty / malformed / wrong-shape input", () => {
    const today = todayDateInputValue();
    expect(resolveDraftDate(null)).toBe(today);
    expect(resolveDraftDate(undefined)).toBe(today);
    expect(resolveDraftDate("")).toBe(today);
    expect(resolveDraftDate("yesterday")).toBe(today);
    expect(resolveDraftDate("2026/06/26")).toBe(today);
    expect(resolveDraftDate("26-06-2026")).toBe(today);
  });
});
