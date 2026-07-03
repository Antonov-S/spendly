import { describe, it, expect } from "vitest";
import { parseReviewJson, validateReviewNumbers } from "@/lib/ai/review";
import { AiParseError } from "@/lib/ai/errors";
import type { ReviewFacts } from "@/lib/reports-review";

describe("parseReviewJson", () => {
  it("accepts { summary: [...] }", () => {
    expect(parseReviewJson('{ "summary": ["a", "b"] }')).toEqual(["a", "b"]);
  });

  it("wraps a single-string summary", () => {
    expect(parseReviewJson('{ "summary": "one line" }')).toEqual(["one line"]);
  });

  it("accepts a bare quoted string", () => {
    expect(parseReviewJson('"just this"')).toEqual(["just this"]);
  });

  it("throws AiParseError on invalid JSON", () => {
    expect(() => parseReviewJson("not json")).toThrow(AiParseError);
  });

  it("throws AiParseError on empty output", () => {
    expect(() => parseReviewJson("   ")).toThrow(AiParseError);
  });

  it("trims the list to at most 4 lines", () => {
    const raw = JSON.stringify({ summary: ["1", "2", "3", "4", "5", "6"] });
    expect(parseReviewJson(raw)).toHaveLength(4);
  });

  it("drops empty and over-long lines", () => {
    const long = "x".repeat(500);
    const raw = JSON.stringify({ summary: ["  ", "keep", long] });
    expect(parseReviewJson(raw)).toEqual(["keep"]);
  });

  it("throws AiParseError when nothing survives coercion", () => {
    expect(() => parseReviewJson('{ "summary": ["   ", "  "] }')).toThrow(
      AiParseError
    );
  });
});

const FACTS: ReviewFacts = {
  periodLabel: "July 2026",
  netCashflow: 420,
  totalIncome: 1000,
  totalExpenses: 580,
  topInsight: { kind: "budget", ref: "Dining" },
  movers: [
    { name: "Dining", current: 1234.5, previous: 942, deltaPct: 0.31, direction: "up" },
  ],
  budgetNotes: [
    {
      name: "Dining",
      spent: 1234.5,
      effectiveLimit: 1000,
      remaining: -234.5,
      status: "over",
    },
  ],
};

describe("validateReviewNumbers", () => {
  it("keeps a line whose figures are all in the facts", () => {
    const lines = ["Dining is up 31% to €1,234.5.", "Net cashflow is €420."];
    expect(validateReviewNumbers(lines, FACTS)).toEqual(lines);
  });

  it("drops a line that misquotes a percentage", () => {
    const lines = ["Net cashflow is €420.", "Dining jumped 38%."];
    expect(validateReviewNumbers(lines, FACTS)).toEqual(["Net cashflow is €420."]);
  });

  it("tolerates money formatting variants within one cent", () => {
    // €1,234.5 and 1234.50 both normalize to the allowed 1234.5.
    const lines = ["Spent €1,234.5.", "Spent 1234.50."];
    expect(validateReviewNumbers(lines, FACTS)).toEqual(lines);
  });

  it("tolerates a percentage within ±1 point", () => {
    expect(validateReviewNumbers(["Dining up 32%."], FACTS)).toEqual([
      "Dining up 32%.",
    ]);
    expect(() => validateReviewNumbers(["Dining up 34%."], FACTS)).toThrow(
      AiParseError
    );
  });

  it("rejects an invented bare integer (e.g. a day-of-month)", () => {
    expect(() =>
      validateReviewNumbers(["You overspent on the 15th."], FACTS)
    ).toThrow(AiParseError);
  });

  it("passes a line with no numbers", () => {
    expect(validateReviewNumbers(["Spending was higher this month."], FACTS)).toEqual([
      "Spending was higher this month.",
    ]);
  });

  it("throws AiParseError when every line is dropped", () => {
    expect(() =>
      validateReviewNumbers(["Dining rose 99%.", "Rent was €7777."], FACTS)
    ).toThrow(AiParseError);
  });
});
