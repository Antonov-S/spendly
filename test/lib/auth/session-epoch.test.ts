import { describe, expect, it } from "vitest";
import { isTokenRevoked } from "@/lib/auth/session-epoch";

describe("isTokenRevoked", () => {
  it("keeps a token valid when the epoch matches and the account is active", () => {
    expect(
      isTokenRevoked(2, { sessionEpoch: 2, deletedAt: null })
    ).toBe(false);
  });

  it("revokes a token when the epoch differs", () => {
    expect(
      isTokenRevoked(1, { sessionEpoch: 2, deletedAt: null })
    ).toBe(true);
  });

  it("revokes a token when the account is soft-deleted", () => {
    expect(
      isTokenRevoked(2, {
        sessionEpoch: 2,
        deletedAt: new Date("2026-07-05"),
      })
    ).toBe(true);
  });

  it("revokes a token when the user row is missing", () => {
    expect(isTokenRevoked(0, null)).toBe(true);
  });

  it("treats a missing token epoch as zero for pre-deploy tokens", () => {
    expect(
      isTokenRevoked(undefined, { sessionEpoch: 0, deletedAt: null })
    ).toBe(false);
    expect(
      isTokenRevoked(undefined, { sessionEpoch: 1, deletedAt: null })
    ).toBe(true);
  });

  it("treats a non-numeric token epoch as zero", () => {
    expect(
      isTokenRevoked("1", { sessionEpoch: 0, deletedAt: null })
    ).toBe(false);
    expect(
      isTokenRevoked("1", { sessionEpoch: 1, deletedAt: null })
    ).toBe(true);
  });
});
