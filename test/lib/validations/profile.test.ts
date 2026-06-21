import { describe, it, expect } from "vitest";
import { updateProfileSchema } from "@/lib/validations/profile";
import { PROFILE_NAME_MAX } from "@/lib/system-constants";

describe("updateProfileSchema", () => {
  it("accepts a normal name", () => {
    const result = updateProfileSchema.safeParse({ name: "Ann Smith" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("Ann Smith");
  });

  it("trims surrounding whitespace", () => {
    const result = updateProfileSchema.safeParse({ name: "  Ann  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("Ann");
  });

  it("rejects an empty name", () => {
    expect(updateProfileSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects a whitespace-only name", () => {
    expect(updateProfileSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("rejects a name longer than the max", () => {
    const result = updateProfileSchema.safeParse({
      name: "a".repeat(PROFILE_NAME_MAX + 1),
    });
    expect(result.success).toBe(false);
  });

  it("accepts a name exactly at the max length", () => {
    const result = updateProfileSchema.safeParse({
      name: "a".repeat(PROFILE_NAME_MAX),
    });
    expect(result.success).toBe(true);
  });
});
