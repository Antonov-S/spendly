import { describe, expect, it } from "vitest";
import { AiParseError } from "@/lib/ai/errors";
import {
  parseSuggestionNotes,
  validateSuggestionNotes,
} from "@/lib/ai/budget-suggest";
import type { BudgetSuggestionFacts } from "@/lib/budget-suggest";

const FACTS: BudgetSuggestionFacts = {
  periodLabel: "July 2026",
  lookbackMonths: 3,
  suggestions: [
    {
      categoryId: "cat-groceries",
      name: "Groceries",
      monthly: [180, 240, 210],
      monthsWithSpend: 3,
      median: 210,
      average: 210,
      suggestedAmount: 210,
      spike: false,
      variability: "consistent",
    },
    {
      categoryId: "cat-dining",
      name: "Dining",
      monthly: [40, 50, 60],
      monthsWithSpend: 3,
      median: 50,
      average: 50,
      suggestedAmount: 50,
      spike: false,
      variability: "variable",
    },
  ],
};

function raw(notes: unknown): string {
  return JSON.stringify({ notes });
}

describe("parseSuggestionNotes", () => {
  it("parses well-formed categoryId-keyed notes", () => {
    const map = parseSuggestionNotes(
      raw([
        { categoryId: "cat-groceries", note: "€210 covers a typical month." },
        { categoryId: "cat-dining", note: "Dining swings month to month." },
      ]),
      FACTS
    );
    expect(map.get("cat-groceries")).toBe("€210 covers a typical month.");
    expect(map.get("cat-dining")).toBe("Dining swings month to month.");
  });

  it("tolerates a name key resolved case-insensitively", () => {
    const map = parseSuggestionNotes(
      raw([{ name: "groceries", note: "Steady at €210." }]),
      FACTS
    );
    expect(map.get("cat-groceries")).toBe("Steady at €210.");
  });

  it("drops an entry for a category not in the facts", () => {
    const map = parseSuggestionNotes(
      raw([{ categoryId: "cat-unknown", note: "Should be dropped." }]),
      FACTS
    );
    expect(map.size).toBe(0);
  });

  it("drops an over-long note", () => {
    const map = parseSuggestionNotes(
      raw([{ categoryId: "cat-groceries", note: "x".repeat(241) }]),
      FACTS
    );
    expect(map.has("cat-groceries")).toBe(false);
  });

  it("drops an empty or non-string note", () => {
    const map = parseSuggestionNotes(
      raw([
        { categoryId: "cat-groceries", note: "   " },
        { categoryId: "cat-dining", note: 42 },
      ]),
      FACTS
    );
    expect(map.size).toBe(0);
  });

  it("returns an empty map (no throw) when notes is missing or not an array", () => {
    expect(parseSuggestionNotes(JSON.stringify({}), FACTS).size).toBe(0);
    expect(
      parseSuggestionNotes(JSON.stringify({ notes: "nope" }), FACTS).size
    ).toBe(0);
  });

  it("throws AiParseError on invalid JSON or empty output", () => {
    expect(() => parseSuggestionNotes("not json", FACTS)).toThrow(AiParseError);
    expect(() => parseSuggestionNotes("   ", FACTS)).toThrow(AiParseError);
  });

  it("keeps only the first note per category", () => {
    const map = parseSuggestionNotes(
      raw([
        { categoryId: "cat-groceries", note: "First." },
        { categoryId: "cat-groceries", note: "Second." },
      ]),
      FACTS
    );
    expect(map.get("cat-groceries")).toBe("First.");
  });
});

describe("validateSuggestionNotes", () => {
  it("keeps a note whose numbers are all in the suggestion's facts", () => {
    const notes = new Map([
      ["cat-groceries", "You spent €180, €240 and €210 — €210 covers it."],
    ]);
    const kept = validateSuggestionNotes(notes, FACTS);
    expect(kept.get("cat-groceries")).toBeDefined();
  });

  it("drops a note that misquotes a euro figure", () => {
    const notes = new Map([
      ["cat-groceries", "You spent €999 — €210 covers it."],
    ]);
    const kept = validateSuggestionNotes(notes, FACTS);
    expect(kept.has("cat-groceries")).toBe(false);
  });

  it("tolerates European separator formatting of an allowed figure", () => {
    const notes = new Map([["cat-groceries", "Around €210,00 a month."]]);
    const kept = validateSuggestionNotes(notes, FACTS);
    expect(kept.has("cat-groceries")).toBe(true);
  });

  it("passes a note with no numbers", () => {
    const notes = new Map([["cat-dining", "Dining swings month to month."]]);
    const kept = validateSuggestionNotes(notes, FACTS);
    expect(kept.get("cat-dining")).toBeDefined();
  });

  it("allows the lookbackMonths integer so 'last 3 months' passes", () => {
    const notes = new Map([
      ["cat-groceries", "Median of your last 3 months, about €210."],
    ]);
    const kept = validateSuggestionNotes(notes, FACTS);
    expect(kept.has("cat-groceries")).toBe(true);
  });

  it("does not throw when every note is dropped", () => {
    const notes = new Map([["cat-groceries", "Wildly wrong €12345."]]);
    expect(() => validateSuggestionNotes(notes, FACTS)).not.toThrow();
    expect(validateSuggestionNotes(notes, FACTS).size).toBe(0);
  });
});
