import { startOfUtcDay, toDateInputValue } from "@/lib/date";
import { GOAL_COLORS } from "@/lib/constants";
import type { GoalRow } from "@/types/dashboard";
import type { GoalCard, ContributionRow } from "@/types/goals";

/** Decimal-like value: a number, numeric string, or Prisma Decimal. */
type Numeric = number | string | { toString(): string };

/** The minimum a goal record needs for overdue/progress/row mapping. */
export interface GoalRecord {
  id: string;
  name: string;
  currentAmount: Numeric;
  targetAmount: Numeric;
  targetDate: Date | null;
  isCompleted: boolean;
}

interface ContributionRecord {
  id: string;
  amount: Numeric;
  date: Date;
  note: string | null;
}

/** A goal record joined with its contributions (for the page card). */
export interface GoalWithContributions extends GoalRecord {
  contributions: ContributionRecord[];
}

/**
 * A goal is overdue when its target date is strictly **before today** and it
 * isn't yet complete AND progress is still short of target. `now` is injectable
 * for testing.
 *
 * Date comparison rule: `targetDate` is a `@db.Date` stored at UTC midnight. We
 * floor `now` to UTC midnight too (`startOfUtcDay`) and use a **strict `<`**, so
 * a goal whose target date is *today* is NOT overdue — it only flips overdue on
 * the following calendar day. Comparing against an un-floored `now` would
 * (wrongly) mark a goal overdue from 00:00:01 UTC on its own due date. This
 * floor-both-sides rule matches the recurring slice's day-boundary handling.
 */
export function isGoalOverdue(
  goal: {
    targetDate: Date | null;
    isCompleted: boolean;
    currentAmount: number;
    targetAmount: number;
  },
  now: Date = new Date()
): boolean {
  if (goal.targetDate == null || goal.isCompleted) return false;
  if (goal.currentAmount >= goal.targetAmount) return false;
  return goal.targetDate < startOfUtcDay(now);
}

/**
 * Progress clamped to [0, 100] for display. `currentAmount` may exceed the
 * target (overfunded) or go negative (net withdrawals); this clamps the *bar*
 * only — never the underlying figure.
 */
export function goalProgressPercent(saved: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((saved / target) * 100)));
}

/** Narrowed goal row for the dashboard widget. */
export function mapGoalRow(
  goal: GoalRecord,
  index: number,
  now: Date = new Date()
): GoalRow {
  const saved = Number(goal.currentAmount);
  const target = Number(goal.targetAmount);
  return {
    id: goal.id,
    name: goal.name,
    color: GOAL_COLORS[index % GOAL_COLORS.length],
    saved,
    target,
    overdue: isGoalOverdue(
      { targetDate: goal.targetDate, isCompleted: goal.isCompleted, currentAmount: saved, targetAmount: target },
      now
    ),
  };
}

/** Full goal card for the `/goals` page (includes mapped contributions). */
export function mapGoalCard(
  goal: GoalWithContributions,
  index: number,
  now: Date = new Date()
): GoalCard {
  const saved = Number(goal.currentAmount);
  const target = Number(goal.targetAmount);
  return {
    id: goal.id,
    name: goal.name,
    color: GOAL_COLORS[index % GOAL_COLORS.length],
    saved,
    target,
    targetDate: goal.targetDate ? toDateInputValue(goal.targetDate) : null,
    isCompleted: goal.isCompleted,
    overdue: isGoalOverdue(
      { targetDate: goal.targetDate, isCompleted: goal.isCompleted, currentAmount: saved, targetAmount: target },
      now
    ),
    contributions: goal.contributions.map(mapContributionRow),
  };
}

function mapContributionRow(c: ContributionRecord): ContributionRow {
  return {
    id: c.id,
    amount: Number(c.amount),
    date: toDateInputValue(c.date),
    note: c.note,
  };
}
