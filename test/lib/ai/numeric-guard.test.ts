import { describe, expect, it } from "vitest";
import {
  lineNumbersAllowed,
  NUMERIC_GUARD_MONEY_EPSILON,
  NUMERIC_GUARD_PCT_EPSILON,
  type AllowedNumbers,
} from "@/lib/ai/numeric-guard";

const ALLOWED: AllowedNumbers = {
  money: [1234.5, 220, -40, 40, 915],
  pct: [31, -31],
};

describe("lineNumbersAllowed", () => {
  it("passes a line with no numbers at all", () => {
    expect(lineNumbersAllowed("Spending held steady this month.", ALLOWED)).toBe(
      true
    );
  });

  it("keeps a line whose numbers are all in the allowed set", () => {
    expect(
      lineNumbersAllowed("You spent €220 — up 31% vs last month.", ALLOWED)
    ).toBe(true);
  });

  it("rejects a line when a single number is not allowed", () => {
    expect(
      lineNumbersAllowed("You spent €220 and saved €999 on top.", ALLOWED)
    ).toBe(false);
  });

  describe("separator normalization", () => {
    it("accepts €1,234.5 (comma thousands, dot decimal)", () => {
      expect(lineNumbersAllowed("Total was €1,234.5 overall.", ALLOWED)).toBe(
        true
      );
    });

    it("accepts 1.234,5 (dot thousands, comma decimal)", () => {
      expect(lineNumbersAllowed("Total was 1.234,5 overall.", ALLOWED)).toBe(
        true
      );
    });

    it("accepts the plain 1234.5 form", () => {
      expect(lineNumbersAllowed("Total was 1234.5 overall.", ALLOWED)).toBe(
        true
      );
    });
  });

  describe("signs", () => {
    it("accepts the absolute form of a signed allowed value", () => {
      // -40 is allowed alongside 40; prose usually words the direction.
      expect(lineNumbersAllowed("You're €40 over the limit.", ALLOWED)).toBe(
        true
      );
    });

    it("accepts an explicitly signed value, including unicode minus", () => {
      expect(lineNumbersAllowed("Cashflow moved by −40 there.", ALLOWED)).toBe(
        true
      );
      expect(lineNumbersAllowed("Cashflow moved by +915 there.", ALLOWED)).toBe(
        true
      );
    });
  });

  describe("epsilons", () => {
    it("money matches within one cent", () => {
      expect(NUMERIC_GUARD_MONEY_EPSILON).toBe(0.01);
      expect(lineNumbersAllowed("€220.01 covers it.", ALLOWED)).toBe(true);
      expect(lineNumbersAllowed("€220.02 covers it.", ALLOWED)).toBe(false);
    });

    it("percentages match within ±1 point", () => {
      expect(NUMERIC_GUARD_PCT_EPSILON).toBe(1);
      expect(lineNumbersAllowed("Dining is up 32% now.", ALLOWED)).toBe(true);
      expect(lineNumbersAllowed("Dining is up 33% now.", ALLOWED)).toBe(false);
    });
  });

  it("routes % tokens to the pct set, not money", () => {
    // 915 is allowed as money but not as a percentage.
    expect(lineNumbersAllowed("That's 915% higher.", ALLOWED)).toBe(false);
  });
});
