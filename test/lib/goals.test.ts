import { describe, it, expect } from "vitest";
import {
  isGoalOverdue,
  goalProgressPercent,
  mapGoalRow,
  mapGoalCard,
  type GoalRecord,
  type GoalWithContributions,
} from "@/lib/goals";
import { GOAL_COLORS } from "@/lib/constants";

/** Fixed "now": 2026-06-20 (matches the project's current date). */
const NOW = new Date(Date.UTC(2026, 5, 20));
/** A `@db.Date` value (UTC midnight) for the given Y-M-D. */
const date = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

function record(overrides: Partial<GoalRecord> = {}): GoalRecord {
  return {
    id: "g1",
    name: "Japan Trip",
    currentAmount: 100,
    targetAmount: 1000,
    targetDate: null,
    isCompleted: false,
    ...overrides,
  };
}

describe("isGoalOverdue", () => {
  it("is false when there is no target date", () => {
    expect(isGoalOverdue({ targetDate: null, isCompleted: false, currentAmount: 0, targetAmount: 100 }, NOW)).toBe(false);
  });

  it("is false when the goal is completed", () => {
    expect(
      isGoalOverdue({ targetDate: date(2026, 6, 1), isCompleted: true, currentAmount: 0, targetAmount: 100 }, NOW)
    ).toBe(false);
  });

  it("is false when fully funded even if the date is past", () => {
    expect(
      isGoalOverdue({ targetDate: date(2026, 6, 1), isCompleted: false, currentAmount: 100, targetAmount: 100 }, NOW)
    ).toBe(false);
  });

  it("is false when over-funded", () => {
    expect(
      isGoalOverdue({ targetDate: date(2026, 6, 1), isCompleted: false, currentAmount: 150, targetAmount: 100 }, NOW)
    ).toBe(false);
  });

  it("is true when past, not complete, and short of target", () => {
    expect(
      isGoalOverdue({ targetDate: date(2026, 6, 19), isCompleted: false, currentAmount: 50, targetAmount: 100 }, NOW)
    ).toBe(true);
  });

  it("is false on the due date itself (strict <, floored to UTC day)", () => {
    expect(
      isGoalOverdue({ targetDate: date(2026, 6, 20), isCompleted: false, currentAmount: 50, targetAmount: 100 }, NOW)
    ).toBe(false);
  });

  it("is false for a future target date", () => {
    expect(
      isGoalOverdue({ targetDate: date(2026, 6, 21), isCompleted: false, currentAmount: 50, targetAmount: 100 }, NOW)
    ).toBe(false);
  });
});

describe("goalProgressPercent", () => {
  it("returns 0 for a zero target", () => {
    expect(goalProgressPercent(50, 0)).toBe(0);
  });

  it("returns 0 for a negative target", () => {
    expect(goalProgressPercent(50, -100)).toBe(0);
  });

  it("clamps a negative saved amount to 0", () => {
    expect(goalProgressPercent(-25, 100)).toBe(0);
  });

  it("clamps an over-funded goal to 100", () => {
    expect(goalProgressPercent(180, 100)).toBe(100);
  });

  it("rounds to the nearest percent", () => {
    expect(goalProgressPercent(333, 1000)).toBe(33);
    expect(goalProgressPercent(335, 1000)).toBe(34);
  });
});

describe("mapGoalRow", () => {
  it("converts Decimals to numbers and cycles colors by index", () => {
    const row0 = mapGoalRow(record({ currentAmount: "250.50", targetAmount: "1000" }), 0, NOW);
    expect(row0.saved).toBe(250.5);
    expect(row0.target).toBe(1000);
    expect(row0.color).toBe(GOAL_COLORS[0]);

    const row6 = mapGoalRow(record(), 6, NOW);
    expect(row6.color).toBe(GOAL_COLORS[6 % GOAL_COLORS.length]);
  });

  it("passes overdue through", () => {
    const row = mapGoalRow(record({ targetDate: date(2026, 6, 1), currentAmount: 10, targetAmount: 100 }), 0, NOW);
    expect(row.overdue).toBe(true);
  });
});

describe("mapGoalCard", () => {
  it("maps contributions, target date, and completion", () => {
    const goal: GoalWithContributions = {
      ...record({ targetDate: date(2026, 12, 31), isCompleted: true, currentAmount: 1200, targetAmount: 1000 }),
      contributions: [
        { id: "c1", amount: "1000", date: date(2026, 5, 1), note: "kickoff" },
        { id: "c2", amount: "-200", date: date(2026, 5, 10), note: null },
        { id: "c3", amount: "400", date: date(2026, 6, 1), note: null },
      ],
    };
    const card = mapGoalCard(goal, 1, NOW);
    expect(card.color).toBe(GOAL_COLORS[1]);
    expect(card.targetDate).toBe("2026-12-31");
    expect(card.isCompleted).toBe(true);
    expect(card.overdue).toBe(false); // completed
    expect(card.contributions).toHaveLength(3);
    expect(card.contributions[0]).toEqual({ id: "c1", amount: 1000, date: "2026-05-01", note: "kickoff" });
    expect(card.contributions[1].amount).toBe(-200);
  });

  it("emits a null target date when unset", () => {
    const goal: GoalWithContributions = { ...record(), contributions: [] };
    expect(mapGoalCard(goal, 0, NOW).targetDate).toBeNull();
  });
});
