import { describe, it, expect } from "vitest";
import { getInitials } from "@/lib/avatar";

describe("getInitials", () => {
  it("returns first + last initial for a multi-word name", () => {
    expect(getInitials("Brad Traversy", null)).toBe("BT");
  });

  it("ignores extra whitespace between name parts", () => {
    expect(getInitials("  Brad   Traversy  ", null)).toBe("BT");
  });

  it("uses first two letters of a single-word name", () => {
    expect(getInitials("Madonna", null)).toBe("MA");
  });

  it("uppercases the result", () => {
    expect(getInitials("jane doe", null)).toBe("JD");
  });

  it("falls back to the email when name is empty", () => {
    expect(getInitials("   ", "person@example.com")).toBe("PE");
  });

  it("falls back to the email when name is null", () => {
    expect(getInitials(null, "alex@example.com")).toBe("AL");
  });

  it("returns '?' when both name and email are missing", () => {
    expect(getInitials(null, null)).toBe("?");
  });

  it("returns '?' when both name and email are blank", () => {
    expect(getInitials("  ", "  ")).toBe("?");
  });
});
