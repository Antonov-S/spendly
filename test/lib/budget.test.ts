import { describe, it, expect } from "vitest";
import {
  budgetFraction,
  budgetState,
  budgetPercent,
  budgetColor,
} from "@/lib/budget";

describe("budgetFraction", () => {
  it("returns 0 when limit is zero", () => {
    expect(budgetFraction(50, 0)).toBe(0);
  });

  it("returns 0 when limit is negative", () => {
    expect(budgetFraction(50, -100)).toBe(0);
  });

  it("returns the ratio of spent to limit", () => {
    expect(budgetFraction(60, 100)).toBe(0.6);
  });

  it("returns a value greater than 1 when over budget", () => {
    expect(budgetFraction(150, 100)).toBe(1.5);
  });

  it("returns 0 when spent is 0", () => {
    expect(budgetFraction(0, 200)).toBe(0);
  });
});

describe("budgetState", () => {
  it("returns success when under the warning threshold (< 60%)", () => {
    expect(budgetState(59, 100)).toBe("success");
  });

  it("returns warning at exactly the warning threshold (60%)", () => {
    expect(budgetState(60, 100)).toBe("warning");
  });

  it("returns warning between 60% and 100%", () => {
    expect(budgetState(80, 100)).toBe("warning");
  });

  it("returns danger at exactly 100%", () => {
    expect(budgetState(100, 100)).toBe("danger");
  });

  it("returns danger when over 100%", () => {
    expect(budgetState(150, 100)).toBe("danger");
  });

  it("returns success when limit is zero", () => {
    expect(budgetState(50, 0)).toBe("success");
  });
});

describe("budgetPercent", () => {
  it("returns 0 when nothing is spent", () => {
    expect(budgetPercent(0, 100)).toBe(0);
  });

  it("returns the percentage spent when within budget", () => {
    expect(budgetPercent(75, 100)).toBe(75);
  });

  it("clamps to 100 when over budget", () => {
    expect(budgetPercent(150, 100)).toBe(100);
  });

  it("returns 0 when limit is zero", () => {
    expect(budgetPercent(50, 0)).toBe(0);
  });
});

describe("budgetColor", () => {
  it("returns the green hex for success", () => {
    expect(budgetColor("success")).toBe("#1D9E75");
  });

  it("returns the amber hex for warning", () => {
    expect(budgetColor("warning")).toBe("#EF9F27");
  });

  it("returns the red hex for danger", () => {
    expect(budgetColor("danger")).toBe("#E24B4A");
  });
});
