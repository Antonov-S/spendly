import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { hashToken } from "@/lib/auth/token-hash";

describe("hashToken", () => {
  it("returns a 64-char lowercase hex SHA-256 digest", () => {
    const hash = hashToken("some-raw-token");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches a known SHA-256 vector", () => {
    expect(hashToken("abc")).toBe(
      createHash("sha256").update("abc").digest("hex")
    );
  });

  it("is deterministic for the same input", () => {
    expect(hashToken("repeat")).toBe(hashToken("repeat"));
  });

  it("produces different digests for different inputs", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});
