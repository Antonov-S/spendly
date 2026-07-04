import { describe, it, expect } from "vitest";
import { normalizeLabelKey } from "@/lib/text";

describe("normalizeLabelKey", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeLabelKey("  Netflix  ")).toBe("netflix");
  });

  it("collapses internal whitespace runs to a single space", () => {
    expect(normalizeLabelKey("Whole   Foods\tMarket")).toBe("whole foods market");
  });

  it("lower-cases (locale-independent)", () => {
    expect(normalizeLabelKey("NETFLIX")).toBe("netflix");
  });

  it("converges NFC and NFD forms of the same string", () => {
    // Built from codepoints so the source stays ASCII (editors normalize literals):
    // composed é = U+00E9; decomposed = "e" + combining acute U+0301.
    const composed = "caf" + String.fromCharCode(0x00e9);
    const decomposed = "cafe" + String.fromCharCode(0x0301);
    expect(composed).not.toBe(decomposed); // genuinely different inputs
    expect(normalizeLabelKey(composed)).toBe(normalizeLabelKey(decomposed));
  });

  it("returns empty string for a blank label", () => {
    expect(normalizeLabelKey("   ")).toBe("");
  });
});
