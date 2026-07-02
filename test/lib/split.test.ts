import { describe, it, expect } from "vitest";
import {
  assignRemainder,
  isSplitBalanced,
  splitRemaining,
  type SplitDraft,
} from "@/lib/split";

function line(categoryId: string, amount: number, note = ""): SplitDraft {
  return { categoryId, amount, note };
}

describe("splitRemaining", () => {
  it("is 0 when the lines sum exactly to the total", () => {
    expect(splitRemaining(80, [line("c1", 55), line("c2", 25)])).toBe(0);
  });

  it("is positive when under-allocated", () => {
    expect(splitRemaining(80, [line("c1", 55), line("c2", 20)])).toBe(5);
  });

  it("is negative when over-allocated", () => {
    expect(splitRemaining(80, [line("c1", 55), line("c2", 30)])).toBe(-5);
  });

  it("rounds a 3-way split of €10 to the cent", () => {
    // 10/3 ≈ 3.33 each → 9.99 allocated → 0.01 remaining.
    const lines = [line("c1", 3.33), line("c2", 3.33), line("c3", 3.33)];
    expect(splitRemaining(10, lines)).toBe(0.01);
  });

  it("treats a missing/zero amount as 0", () => {
    expect(splitRemaining(50, [line("c1", 50), line("c2", 0)])).toBe(0);
  });
});

describe("isSplitBalanced", () => {
  it("accepts an exact, fully-categorized 2-line split", () => {
    expect(isSplitBalanced(80, [line("c1", 55), line("c2", 25)])).toBe(true);
  });

  it("rejects fewer than the minimum lines", () => {
    expect(isSplitBalanced(55, [line("c1", 55)])).toBe(false);
  });

  it("rejects a line missing a category", () => {
    expect(isSplitBalanced(80, [line("c1", 55), line("", 25)])).toBe(false);
  });

  it("rejects a non-zero remainder", () => {
    expect(isSplitBalanced(80, [line("c1", 55), line("c2", 20)])).toBe(false);
  });
});

describe("assignRemainder", () => {
  it("drops the leftover onto the last line and balances the split", () => {
    const lines = [line("c1", 3.33), line("c2", 3.33), line("c3", 3.33)];
    const next = assignRemainder(10, lines);
    expect(next[2].amount).toBe(3.34);
    expect(splitRemaining(10, next)).toBe(0);
  });

  it("targets a specific line when given an index", () => {
    const lines = [line("c1", 3.33), line("c2", 3.33), line("c3", 3.33)];
    const next = assignRemainder(10, lines, 0);
    expect(next[0].amount).toBe(3.34);
    expect(next[1].amount).toBe(3.33);
  });

  it("is a no-op when already balanced", () => {
    const lines = [line("c1", 55), line("c2", 25)];
    expect(assignRemainder(80, lines)).toBe(lines);
  });

  it("subtracts when over-allocated", () => {
    const lines = [line("c1", 55), line("c2", 30)];
    const next = assignRemainder(80, lines);
    expect(next[1].amount).toBe(25);
    expect(splitRemaining(80, next)).toBe(0);
  });
});
