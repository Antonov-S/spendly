import { describe, it, expect } from "vitest";
import { createTagSchema, updateTagSchema } from "@/lib/validations/tag";
import { TAG_NAME_MAX } from "@/lib/system-constants";

describe("createTagSchema", () => {
  it("accepts a name-only tag (no color)", () => {
    const res = createTagSchema.safeParse({ name: "reimbursable" });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.color).toBeUndefined();
  });

  it("accepts a name + valid hex color", () => {
    const res = createTagSchema.safeParse({
      name: "vacation-2026",
      color: "#7F77DD",
    });
    expect(res.success).toBe(true);
  });

  it("trims the name", () => {
    const res = createTagSchema.safeParse({ name: "  travel  " });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.name).toBe("travel");
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(createTagSchema.safeParse({ name: "" }).success).toBe(false);
    expect(createTagSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("rejects a name longer than TAG_NAME_MAX", () => {
    const res = createTagSchema.safeParse({ name: "x".repeat(TAG_NAME_MAX + 1) });
    expect(res.success).toBe(false);
  });

  it("rejects a non-hex color", () => {
    expect(
      createTagSchema.safeParse({ name: "x", color: "blue" }).success
    ).toBe(false);
    expect(
      createTagSchema.safeParse({ name: "x", color: "#FFF" }).success
    ).toBe(false);
  });
});

describe("updateTagSchema", () => {
  it("requires an id", () => {
    expect(updateTagSchema.safeParse({ name: "x" }).success).toBe(false);
    expect(updateTagSchema.safeParse({ id: "", name: "x" }).success).toBe(false);
  });

  it("allows name and color to be omitted (pure patch)", () => {
    const res = updateTagSchema.safeParse({ id: "t1" });
    expect(res.success).toBe(true);
  });

  it("allows clearing the color to null", () => {
    const res = updateTagSchema.safeParse({ id: "t1", color: null });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.color).toBeNull();
  });

  it("rejects an over-long name on update too", () => {
    const res = updateTagSchema.safeParse({
      id: "t1",
      name: "x".repeat(TAG_NAME_MAX + 1),
    });
    expect(res.success).toBe(false);
  });
});
