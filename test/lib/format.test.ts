import { describe, it, expect } from "vitest";
import { formatCurrency, formatSigned } from "@/lib/format";

describe("formatCurrency", () => {
  it("formats a positive whole-dollar amount", () => {
    expect(formatCurrency(8560)).toBe("$8,560");
  });

  it("rounds fractional cents", () => {
    expect(formatCurrency(8560.9)).toBe("$8,561");
  });

  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0");
  });

  it("uses the absolute value for negative amounts", () => {
    expect(formatCurrency(-200)).toBe("$200");
  });

  it("formats a large amount with commas", () => {
    expect(formatCurrency(1000000)).toBe("$1,000,000");
  });
});

describe("formatSigned", () => {
  it("prefixes positive amounts with +", () => {
    expect(formatSigned(3200)).toBe("+$3,200");
  });

  it("prefixes negative amounts with the true minus sign −", () => {
    expect(formatSigned(-47)).toBe("−$47");
  });

  it("returns $0 for zero (no sign prefix)", () => {
    expect(formatSigned(0)).toBe("$0");
  });

  it("rounds before signing — positive fractional", () => {
    expect(formatSigned(99.6)).toBe("+$100");
  });

  it("rounds before signing — negative fractional", () => {
    expect(formatSigned(-99.4)).toBe("−$99");
  });
});
