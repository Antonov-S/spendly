import { describe, it, expect, vi, beforeEach } from "vitest";
import { deriveNotifications } from "@/lib/db/notifications";
import { getBudgetsData } from "@/lib/db/dashboard";
import { getPendingDrafts } from "@/lib/db/recurring";
import { getGoalsSummary } from "@/lib/db/goals";

vi.mock("@/lib/db/dashboard", () => ({ getBudgetsData: vi.fn() }));
vi.mock("@/lib/db/recurring", () => ({ getPendingDrafts: vi.fn() }));
vi.mock("@/lib/db/goals", () => ({ getGoalsSummary: vi.fn() }));

const mockBudgets = vi.mocked(getBudgetsData);
const mockDrafts = vi.mocked(getPendingDrafts);
const mockGoals = vi.mocked(getGoalsSummary);

function catRef(name: string) {
  return { name, color: "#000", icon: "Tag" };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBudgets.mockResolvedValue({
    rows: [
      {
        id: "b1",
        category: catRef("Rent"),
        spent: 120,
        limit: 100,
        rollover: false,
        carriedAmount: 0,
      },
    ],
    summary: {
      remaining: 0,
      total: 100,
      daysLeft: 5,
      categoryCount: 1,
      hasMixedCurrencies: false,
    },
  } as never);
  mockDrafts.mockResolvedValue([
    {
      id: "dr1",
      suggestedDate: new Date(Date.UTC(2026, 5, 28)),
      suggestedAmount: 15,
      templateId: "t1",
      templateName: "Netflix",
      type: "EXPENSE",
      currency: "EUR",
      accountName: "Checking",
      category: null,
    },
  ] as never);
  mockGoals.mockResolvedValue([
    { id: "g1", name: "Japan", color: "#000", saved: 10, target: 100, overdue: true },
  ] as never);
});

describe("deriveNotifications", () => {
  it("composes the three fetchers and feeds the builder", async () => {
    const payload = await deriveNotifications("u1", new Date(2026, 5, 15));

    expect(mockBudgets).toHaveBeenCalledWith("u1", 6, 2026);
    expect(mockDrafts).toHaveBeenCalledWith("u1");
    expect(mockGoals).toHaveBeenCalledWith("u1");

    expect(payload.items.map((i) => i.kind)).toEqual([
      "budget-over",
      "draft",
      "goal-overdue",
    ]);
    expect(payload.counts).toEqual({
      "budget-over": 1,
      "budget-risk": 0,
      draft: 1,
      "goal-overdue": 1,
    });
    expect(payload.totalCount).toBe(3);
  });

  it("resolves month/year from the injected `now` (local calendar, dashboard parity)", async () => {
    await deriveNotifications("u1", new Date(2026, 11, 15)); // December
    expect(mockBudgets).toHaveBeenCalledWith("u1", 12, 2026);
  });

  it("resolves across a year boundary (Jan)", async () => {
    await deriveNotifications("u1", new Date(2027, 0, 5)); // January 2027
    expect(mockBudgets).toHaveBeenCalledWith("u1", 1, 2027);
  });

  it("works with the default `now` (no injected date)", async () => {
    const payload = await deriveNotifications("u1");
    expect(mockBudgets).toHaveBeenCalledTimes(1);
    expect(payload.totalCount).toBe(3);
  });

  it("maps a non-overdue goal out of the payload", async () => {
    mockGoals.mockResolvedValue([
      { id: "g1", name: "Safe", color: "#000", saved: 10, target: 100, overdue: false },
    ] as never);
    const payload = await deriveNotifications("u1", new Date(2026, 5, 15));
    expect(payload.counts["goal-overdue"]).toBe(0);
  });
});
