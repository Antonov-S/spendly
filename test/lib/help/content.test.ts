import { describe, it, expect } from "vitest";
import { HELP_SECTIONS } from "@/lib/help/content";

describe("HELP_SECTIONS", () => {
  it("is non-empty", () => {
    expect(HELP_SECTIONS.length).toBeGreaterThan(0);
  });

  it("has a unique anchor id for every section (TOC + deep-link contract)", () => {
    const ids = HELP_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every section a non-empty title and at least one item", () => {
    for (const section of HELP_SECTIONS) {
      expect(section.title.trim().length).toBeGreaterThan(0);
      expect(section.items.length).toBeGreaterThan(0);
    }
  });

  it("gives every item a non-empty detail", () => {
    for (const section of HELP_SECTIONS) {
      for (const item of section.items) {
        expect(item.detail.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("uses anchor-safe ids (lowercase, hyphenated, no spaces)", () => {
    for (const section of HELP_SECTIONS) {
      expect(section.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("gives every section an icon and a hex accent color", () => {
    for (const section of HELP_SECTIONS) {
      expect(section.icon).toBeTruthy();
      expect(section.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
