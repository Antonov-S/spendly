import { describe, it, expect, vi } from "vitest";
import {
  bucketByMonth,
  reconstructBalanceHistory,
  hasCategoryData,
  hasBalanceData,
  hasEnoughForTrends,
  trendNudgeCopy,
} from "@/lib/reports";
import { reportTxWhere } from "@/lib/db/reports";
import type { BalancePoint } from "@/types/reports";

// `reportTxWhere` is pure, but it lives in a server-only module that imports the
// Prisma singleton (which throws without DATABASE_URL). Stub prisma so the
// import is harmless — the WHERE builder never touches it.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const MONTHS = [
  { month: 4, year: 2026 },
  { month: 5, year: 2026 },
  { month: 6, year: 2026 },
];

/** Build a `@db.Date`-style UTC-midnight date. */
function d(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

describe("bucketByMonth", () => {
  it("splits income vs expenses by sign and takes abs on expenses", () => {
    const rows = [
      { amount: 1000, date: d(2026, 5, 3) },
      { amount: -200, date: d(2026, 5, 10) },
    ];
    const [, may] = bucketByMonth(rows, MONTHS);
    expect(may).toEqual({ month: 5, year: 2026, income: 1000, expenses: 200 });
  });

  it("zero-fills months with no rows", () => {
    const [apr, may, jun] = bucketByMonth(
      [{ amount: 50, date: d(2026, 5, 1) }],
      MONTHS
    );
    expect(apr).toEqual({ month: 4, year: 2026, income: 0, expenses: 0 });
    expect(may.income).toBe(50);
    expect(jun).toEqual({ month: 6, year: 2026, income: 0, expenses: 0 });
  });

  it("ignores rows outside the month list", () => {
    const rows = [
      { amount: 999, date: d(2026, 3, 31) }, // before window
      { amount: 999, date: d(2026, 7, 1) }, // after window
    ];
    const buckets = bucketByMonth(rows, MONTHS);
    expect(buckets.every((b) => b.income === 0 && b.expenses === 0)).toBe(true);
  });

  it("sums multiple rows within the same month", () => {
    const rows = [
      { amount: -100, date: d(2026, 6, 2) },
      { amount: -50, date: d(2026, 6, 20) },
      { amount: 300, date: d(2026, 6, 9) },
    ];
    const [, , jun] = bucketByMonth(rows, MONTHS);
    expect(jun).toEqual({ month: 6, year: 2026, income: 300, expenses: 150 });
  });

  it("returns one bucket per month in order", () => {
    const buckets = bucketByMonth([], MONTHS);
    expect(buckets.map((b) => b.month)).toEqual([4, 5, 6]);
  });
});

describe("reconstructBalanceHistory", () => {
  const accounts = [
    { id: "a", name: "Checking", color: "#1D9E75", baseline: 1000 },
    { id: "b", name: "Savings", color: "#378ADD", baseline: 500 },
  ];

  it("runs the end-of-month balance = baseline + cumulative net", () => {
    const rows = [
      { financialAccountId: "a", amount: 200, date: d(2026, 4, 5) },
      { financialAccountId: "a", amount: -100, date: d(2026, 5, 5) },
      { financialAccountId: "a", amount: 50, date: d(2026, 6, 5) },
    ];
    const history = reconstructBalanceHistory(accounts, rows, MONTHS);
    const checking = history.map(
      (p) => p.balances.find((x) => x.accountId === "a")!.balance
    );
    expect(checking).toEqual([1200, 1100, 1150]);
  });

  it("keeps multiple accounts separate", () => {
    const rows = [
      { financialAccountId: "b", amount: 100, date: d(2026, 4, 1) },
    ];
    const history = reconstructBalanceHistory(accounts, rows, MONTHS);
    const apr = history[0].balances;
    expect(apr.find((x) => x.accountId === "a")!.balance).toBe(1000);
    expect(apr.find((x) => x.accountId === "b")!.balance).toBe(600);
  });

  it("carries the prior balance forward through a month with no rows", () => {
    const rows = [
      { financialAccountId: "a", amount: 300, date: d(2026, 4, 2) },
    ];
    const history = reconstructBalanceHistory(accounts, rows, MONTHS);
    const checking = history.map(
      (p) => p.balances.find((x) => x.accountId === "a")!.balance
    );
    expect(checking).toEqual([1300, 1300, 1300]);
  });

  it("preserves negative balances (no clamp)", () => {
    const broke = [{ id: "c", name: "Card", color: null, baseline: -100 }];
    const rows = [
      { financialAccountId: "c", amount: -50, date: d(2026, 4, 1) },
    ];
    const history = reconstructBalanceHistory(broke, rows, MONTHS);
    expect(history[0].balances[0].balance).toBe(-150);
  });

  it("falls back to a neutral color when the account color is null", () => {
    const noColor = [{ id: "c", name: "Card", color: null, baseline: 0 }];
    const history = reconstructBalanceHistory(noColor, [], MONTHS);
    expect(history[0].balances[0].color).toBe("#888780");
  });
});

describe("hasCategoryData", () => {
  it("true when any slice total > 0", () => {
    expect(hasCategoryData([{ total: 0 }, { total: 5 }])).toBe(true);
  });

  it("false for empty array or all-zero totals", () => {
    expect(hasCategoryData([])).toBe(false);
    expect(hasCategoryData([{ total: 0 }, { total: 0 }])).toBe(false);
  });
});

describe("hasBalanceData", () => {
  it("true when some month has a non-empty balances series", () => {
    const history: BalancePoint[] = [
      { month: 6, year: 2026, balances: [{ accountId: "a", name: "A", color: "#000", balance: 10 }] },
    ];
    expect(hasBalanceData(history)).toBe(true);
  });

  it("false when every series is empty (not trivially true on non-empty history)", () => {
    const history: BalancePoint[] = [
      { month: 5, year: 2026, balances: [] },
      { month: 6, year: 2026, balances: [] },
    ];
    expect(history.length).toBeGreaterThan(0);
    expect(hasBalanceData(history)).toBe(false);
  });
});

describe("hasEnoughForTrends", () => {
  it("false below the threshold, true at/above", () => {
    expect(hasEnoughForTrends(14)).toBe(false);
    expect(hasEnoughForTrends(15)).toBe(true);
    expect(hasEnoughForTrends(40)).toBe(true);
  });
});

describe("trendNudgeCopy", () => {
  it("uses the exact canonical wording at count 0", () => {
    expect(trendNudgeCopy(0)).toBe(
      "Add 15 more transactions to see spending trends"
    );
  });

  it("counts down toward the threshold", () => {
    expect(trendNudgeCopy(5)).toBe(
      "Add 10 more transactions to see spending trends"
    );
  });

  it("clamps to 'Add 0 more …' at/above threshold (never negative)", () => {
    expect(trendNudgeCopy(15)).toBe(
      "Add 0 more transactions to see spending trends"
    );
    expect(trendNudgeCopy(99)).toBe(
      "Add 0 more transactions to see spending trends"
    );
  });
});

describe("reportTxWhere", () => {
  it("always scopes by userId and soft-delete", () => {
    const where = reportTxWhere("user-1", undefined);
    expect(where.userId).toBe("user-1");
    expect(where.deletedAt).toBeNull();
  });

  it("with no accountId → all accounts, archived excluded", () => {
    const where = reportTxWhere("user-1", undefined);
    expect(where.financialAccount).toEqual({ isArchived: false });
  });

  it("with an accountId → that account by id, no isArchived filter (archived honored)", () => {
    const where = reportTxWhere("user-1", "acc-9");
    expect(where.financialAccount).toEqual({ id: "acc-9" });
  });
});
