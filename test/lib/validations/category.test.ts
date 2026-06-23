import { describe, it, expect } from "vitest";
import { HelpCircle } from "lucide-react";
import {
  createCategorySchema,
  updateCategorySchema,
} from "@/lib/validations/category";
import { CATEGORY_ICONS, CATEGORY_COLORS } from "@/lib/constants";
import { resolveIcon } from "@/lib/icon-map";

const VALID = {
  name: "Hobbies",
  icon: CATEGORY_ICONS[0],
  color: CATEGORY_COLORS[0],
} as const;

describe("createCategorySchema", () => {
  it("accepts a valid name + icon + color triple", () => {
    const result = createCategorySchema.safeParse(VALID);
    expect(result.success).toBe(true);
  });

  it("trims surrounding whitespace from the name", () => {
    const result = createCategorySchema.safeParse({ ...VALID, name: "  BBQ  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("BBQ");
  });

  it("rejects an empty name", () => {
    expect(
      createCategorySchema.safeParse({ ...VALID, name: "" }).success
    ).toBe(false);
  });

  it("rejects a whitespace-only name", () => {
    expect(
      createCategorySchema.safeParse({ ...VALID, name: "   " }).success
    ).toBe(false);
  });

  it("rejects a name longer than 50 chars", () => {
    expect(
      createCategorySchema.safeParse({ ...VALID, name: "a".repeat(51) }).success
    ).toBe(false);
  });

  it("accepts a name exactly 50 chars", () => {
    expect(
      createCategorySchema.safeParse({ ...VALID, name: "a".repeat(50) }).success
    ).toBe(true);
  });

  it("rejects an icon outside the whitelist", () => {
    expect(
      createCategorySchema.safeParse({ ...VALID, icon: "NotAnIcon" }).success
    ).toBe(false);
  });

  it("rejects a non-hex color", () => {
    expect(
      createCategorySchema.safeParse({ ...VALID, color: "red" }).success
    ).toBe(false);
    expect(
      createCategorySchema.safeParse({ ...VALID, color: "#FFF" }).success
    ).toBe(false);
  });
});

describe("updateCategorySchema", () => {
  it("requires an id", () => {
    expect(updateCategorySchema.safeParse({ name: "X" }).success).toBe(false);
  });

  it("accepts id alone (all fields optional)", () => {
    expect(updateCategorySchema.safeParse({ id: "c1" }).success).toBe(true);
  });

  it("accepts a partial patch (name only)", () => {
    const result = updateCategorySchema.safeParse({ id: "c1", name: "New" });
    expect(result.success).toBe(true);
  });

  it("still rejects an out-of-whitelist icon when provided", () => {
    expect(
      updateCategorySchema.safeParse({ id: "c1", icon: "Nope" }).success
    ).toBe(false);
  });
});

describe("icon ↔ map drift guard", () => {
  it("every CATEGORY_ICONS name resolves to a non-fallback component", () => {
    for (const name of CATEGORY_ICONS) {
      const resolved = resolveIcon(name);
      if (name === "HelpCircle") {
        expect(resolved).toBe(HelpCircle);
      } else {
        // A name missing from icon-map.ts would fall back to HelpCircle.
        expect(resolved).not.toBe(HelpCircle);
      }
    }
  });
});
