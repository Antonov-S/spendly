import { describe, it, expect } from "vitest";
import {
  deriveBalance,
  mapAccountRow,
  getDefaultActiveAccount,
  type MappableAccount,
} from "@/lib/account";

/** A Prisma-Decimal-like object (only `toString` is read by `Number()`). */
function decimal(value: string) {
  return { toString: () => value };
}

function account(overrides: Partial<MappableAccount> = {}): MappableAccount {
  return {
    id: "a1",
    name: "Checking",
    type: "CHECKING",
    currency: "EUR",
    startingBalance: 100,
    color: "#1D9E75",
    icon: "Wallet",
    isArchived: false,
    ...overrides,
  };
}

describe("deriveBalance", () => {
  it("adds the transaction sum to the starting balance", () => {
    expect(deriveBalance(100, 50)).toBe(150);
  });

  it("treats a null sum (no transactions) as zero", () => {
    expect(deriveBalance(100, null)).toBe(100);
  });

  it("treats an undefined sum as zero", () => {
    expect(deriveBalance(100, undefined)).toBe(100);
  });

  it("handles a negative sum (net outflow)", () => {
    expect(deriveBalance(100, -250)).toBe(-150);
  });

  it("handles a negative starting balance (liability account)", () => {
    expect(deriveBalance(-500, 200)).toBe(-300);
  });

  it("coerces Prisma Decimal-like and string inputs", () => {
    expect(deriveBalance(decimal("100.50"), decimal("-0.50"))).toBe(100);
    expect(deriveBalance("100", "50")).toBe(150);
  });
});

describe("mapAccountRow", () => {
  it("converts Decimal fields to numbers and derives the balance", () => {
    const row = mapAccountRow(
      account({ startingBalance: decimal("1800.00") }),
      decimal("-300.00")
    );
    expect(row.startingBalance).toBe(1800);
    expect(row.balance).toBe(1500);
    expect(typeof row.balance).toBe("number");
    expect(typeof row.startingBalance).toBe("number");
  });

  it("passes color and icon through unchanged", () => {
    const row = mapAccountRow(account({ color: "#EF9F27", icon: "PiggyBank" }), 0);
    expect(row.color).toBe("#EF9F27");
    expect(row.icon).toBe("PiggyBank");
  });

  it("preserves null color/icon and isArchived", () => {
    const row = mapAccountRow(
      account({ color: null, icon: null, isArchived: true }),
      null
    );
    expect(row.color).toBeNull();
    expect(row.icon).toBeNull();
    expect(row.isArchived).toBe(true);
  });

  it("defaults the balance to the starting balance when there are no transactions", () => {
    const row = mapAccountRow(account({ startingBalance: 42 }), null);
    expect(row.balance).toBe(42);
  });
});

describe("getDefaultActiveAccount", () => {
  const accounts = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("returns the scoped account when it matches the filter", () => {
    expect(getDefaultActiveAccount(accounts, "b")).toEqual({ id: "b" });
  });

  it("falls back to the first account when the scoped id is not in the list", () => {
    expect(getDefaultActiveAccount(accounts, "z")).toEqual({ id: "a" });
  });

  it("falls back to the first account when no scope is given", () => {
    expect(getDefaultActiveAccount(accounts)).toEqual({ id: "a" });
    expect(getDefaultActiveAccount(accounts, null)).toEqual({ id: "a" });
  });

  it("returns null for an empty list", () => {
    expect(getDefaultActiveAccount([], "a")).toBeNull();
    expect(getDefaultActiveAccount([])).toBeNull();
  });
});
