import { describe, it, expect } from "vitest";
import {
  buildTransactionWhere,
  collapseTransfers,
  formatDeletedAt,
  groupTransactionsByDate,
  parseDateParam,
  parseType,
} from "@/lib/transactions";
import type {
  FeedTransaction,
  TransactionLeg,
} from "@/types/transactions";

function leg(overrides: Partial<TransactionLeg>): TransactionLeg {
  return {
    id: "t1",
    type: "EXPENSE",
    amount: -10,
    currency: "USD",
    date: new Date(Date.UTC(2026, 5, 15)),
    merchant: null,
    note: null,
    isTransferLeg: false,
    transferPairId: null,
    financialAccountId: "acc1",
    accountName: "Checking",
    category: null,
    ...overrides,
  };
}

function feedRow(overrides: Partial<FeedTransaction>): FeedTransaction {
  return {
    id: "t1",
    type: "EXPENSE",
    description: "x",
    category: null,
    date: new Date(Date.UTC(2026, 5, 15)),
    currency: "USD",
    amount: -10,
    accountName: "Checking",
    isTransferLeg: false,
    ...overrides,
  };
}

describe("buildTransactionWhere", () => {
  it("always scopes to the user and excludes soft-deleted rows", () => {
    const where = buildTransactionWhere("u1", {});
    expect(where.userId).toBe("u1");
    expect(where.deletedAt).toBeNull();
  });

  it("excludes archived accounts when no account is selected", () => {
    const where = buildTransactionWhere("u1", {});
    expect(where.financialAccount).toEqual({ isArchived: false });
    expect(where.financialAccountId).toBeUndefined();
  });

  it("scopes to a specific account instead of excluding archived ones", () => {
    const where = buildTransactionWhere("u1", { accountId: "acc9" });
    expect(where.financialAccountId).toBe("acc9");
    expect(where.financialAccount).toBeUndefined();
  });

  it("applies a type filter", () => {
    expect(buildTransactionWhere("u1", { type: "INCOME" }).type).toBe("INCOME");
  });

  it("builds an inclusive date range", () => {
    const from = new Date(Date.UTC(2026, 5, 1));
    const to = new Date(Date.UTC(2026, 5, 30));
    expect(buildTransactionWhere("u1", { from, to }).date).toEqual({
      gte: from,
      lte: to,
    });
  });

  it("supports an open-ended (from-only) date range", () => {
    const from = new Date(Date.UTC(2026, 5, 1));
    expect(buildTransactionWhere("u1", { from }).date).toEqual({ gte: from });
  });

  it("filters by category ids", () => {
    expect(
      buildTransactionWhere("u1", { categoryIds: ["c1", "c2"] }).categoryId
    ).toEqual({ in: ["c1", "c2"] });
  });

  it("ignores the category filter for transfers", () => {
    const where = buildTransactionWhere("u1", {
      type: "TRANSFER",
      categoryIds: ["c1"],
    });
    expect(where.categoryId).toBeUndefined();
  });

  it("searches merchant, note, and category name (case-insensitive)", () => {
    const where = buildTransactionWhere("u1", { q: "coffee" });
    expect(where.OR).toEqual([
      { merchant: { contains: "coffee", mode: "insensitive" } },
      { note: { contains: "coffee", mode: "insensitive" } },
      { category: { name: { contains: "coffee", mode: "insensitive" } } },
    ]);
  });
});

describe("collapseTransfers", () => {
  it("passes non-transfers through, preserving order", () => {
    const legs = [leg({ id: "a" }), leg({ id: "b" })];
    const rows = collapseTransfers(legs);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("collapses a pair to one outflow row with the destination named (all accounts)", () => {
    const legs = [
      leg({
        id: "out",
        type: "TRANSFER",
        isTransferLeg: true,
        transferPairId: "p1",
        amount: -100,
        financialAccountId: "acc1",
        accountName: "Checking",
      }),
      leg({ id: "normal" }),
      leg({
        id: "in",
        type: "TRANSFER",
        isTransferLeg: true,
        transferPairId: "p1",
        amount: 100,
        financialAccountId: "acc2",
        accountName: "Savings",
      }),
    ];

    const rows = collapseTransfers(legs);
    expect(rows.map((r) => r.id)).toEqual(["out", "normal"]);
    const transfer = rows[0];
    expect(transfer.type).toBe("TRANSFER");
    expect(transfer.amount).toBe(-100);
    expect(transfer.accountName).toBe("Checking");
    expect(transfer.counterpartyAccountName).toBe("Savings");
  });

  it("keeps the in-account leg and names the counterparty (scoped)", () => {
    const legs = [
      leg({
        id: "in",
        type: "TRANSFER",
        isTransferLeg: true,
        transferPairId: "p1",
        amount: 100,
        financialAccountId: "acc2",
        accountName: "Savings",
      }),
      leg({
        id: "out",
        type: "TRANSFER",
        isTransferLeg: true,
        transferPairId: "p1",
        amount: -100,
        financialAccountId: "acc1",
        accountName: "Checking",
      }),
    ];

    const rows = collapseTransfers(legs, "acc2");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("in");
    expect(rows[0].amount).toBe(100);
    expect(rows[0].accountName).toBe("Savings");
    expect(rows[0].counterpartyAccountName).toBe("Checking");
  });
});

describe("groupTransactionsByDate", () => {
  const today = new Date(Date.UTC(2026, 5, 15));

  it("labels today and yesterday", () => {
    const rows = [
      feedRow({ id: "a", date: new Date(Date.UTC(2026, 5, 15)) }),
      feedRow({ id: "b", date: new Date(Date.UTC(2026, 5, 14)) }),
    ];
    const groups = groupTransactionsByDate(rows, today);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday"]);
  });

  it("labels older dates as 'MMM D, YYYY'", () => {
    const rows = [feedRow({ id: "a", date: new Date(Date.UTC(2026, 5, 12)) })];
    const groups = groupTransactionsByDate(rows, today);
    expect(groups[0].label).toBe("Jun 12, 2026");
  });

  it("buckets multiple rows on the same date into one group", () => {
    const rows = [
      feedRow({ id: "a", date: new Date(Date.UTC(2026, 5, 12)) }),
      feedRow({ id: "b", date: new Date(Date.UTC(2026, 5, 12)) }),
    ];
    const groups = groupTransactionsByDate(rows, today);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("preserves group order by first appearance", () => {
    const rows = [
      feedRow({ id: "a", date: new Date(Date.UTC(2026, 5, 15)) }),
      feedRow({ id: "b", date: new Date(Date.UTC(2026, 5, 12)) }),
      feedRow({ id: "c", date: new Date(Date.UTC(2026, 5, 10)) }),
    ];
    const groups = groupTransactionsByDate(rows, today);
    expect(groups.map((g) => g.label)).toEqual([
      "Today",
      "Jun 12, 2026",
      "Jun 10, 2026",
    ]);
  });
});

describe("parseDateParam", () => {
  it("parses a valid YYYY-MM-DD into UTC midnight", () => {
    expect(parseDateParam("2026-06-15")).toEqual(new Date(Date.UTC(2026, 5, 15)));
  });

  it("returns undefined for missing or malformed input", () => {
    expect(parseDateParam(undefined)).toBeUndefined();
    expect(parseDateParam("06/15/2026")).toBeUndefined();
    expect(parseDateParam("")).toBeUndefined();
  });
});

describe("parseType", () => {
  it("accepts valid transaction types", () => {
    expect(parseType("INCOME")).toBe("INCOME");
    expect(parseType("EXPENSE")).toBe("EXPENSE");
    expect(parseType("TRANSFER")).toBe("TRANSFER");
  });

  it("rejects anything else", () => {
    expect(parseType("all")).toBeUndefined();
    expect(parseType(undefined)).toBeUndefined();
  });
});

describe("formatDeletedAt", () => {
  const now = Date.UTC(2026, 5, 28); // Jun 28, 2026 (UTC midnight)

  it("labels a same-day deletion as 'today'", () => {
    const deletedAt = new Date(Date.UTC(2026, 5, 28, 14, 30));
    expect(formatDeletedAt(deletedAt, now)).toBe("Deleted today · Jun 28");
  });

  it("uses the singular '1 day ago' for yesterday", () => {
    const deletedAt = new Date(Date.UTC(2026, 5, 27, 9, 0));
    expect(formatDeletedAt(deletedAt, now)).toBe("Deleted 1 day ago · Jun 27");
  });

  it("uses 'N days ago' for older deletions", () => {
    const deletedAt = new Date(Date.UTC(2026, 5, 25));
    expect(formatDeletedAt(deletedAt, now)).toBe("Deleted 3 days ago · Jun 25");
  });

  it("appends the year only when it isn't the current year", () => {
    const deletedAt = new Date(Date.UTC(2025, 11, 31));
    expect(formatDeletedAt(deletedAt, now)).toBe(
      "Deleted 179 days ago · Dec 31, 2025"
    );
  });

  it("is UTC-stable regardless of the time component", () => {
    const lateNight = new Date(Date.UTC(2026, 5, 27, 23, 59));
    expect(formatDeletedAt(lateNight, now)).toBe("Deleted 1 day ago · Jun 27");
  });
});
