import "server-only";
import { prisma } from "@/lib/prisma";
import { mapGoalCard, mapGoalRow } from "@/lib/goals";
import { toDateInputValue } from "@/lib/date";
import type { GoalRow } from "@/types/dashboard";
import type { GoalCard, EditableGoal } from "@/types/goals";

/**
 * Single source of truth for goal reads. The `/goals` page uses `getGoals`
 * (full, with contributions); the dashboard widget uses `getGoalsSummary`
 * (narrowed, active-only). Both map through the shared helpers in
 * `src/lib/goals.ts`, so the two surfaces can never disagree on progress/overdue.
 */

/** Page list — all goals (active + completed), each with its contributions (date-desc). */
export async function getGoals(userId: string): Promise<GoalCard[]> {
  const goals = await prisma.goal.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { contributions: { orderBy: { date: "desc" } } },
  });
  const now = new Date();
  return goals.map((goal, i) => mapGoalCard(goal, i, now));
}

/** Dashboard widget — active goals only, no contributions, mapped to `GoalRow`. */
export async function getGoalsSummary(userId: string): Promise<GoalRow[]> {
  const goals = await prisma.goal.findMany({
    where: { userId, isCompleted: false },
    orderBy: { createdAt: "asc" },
  });
  const now = new Date();
  return goals.map((goal, i) => mapGoalRow(goal, i, now));
}

/** Single goal scoped by `userId`, for the form drawer pre-fill. */
export async function getGoalForEdit(
  userId: string,
  id: string
): Promise<EditableGoal | null> {
  const goal = await prisma.goal.findFirst({
    where: { id, userId },
    select: { id: true, name: true, targetAmount: true, targetDate: true },
  });
  if (!goal) return null;
  return {
    id: goal.id,
    name: goal.name,
    targetAmount: Number(goal.targetAmount),
    targetDate: goal.targetDate ? toDateInputValue(goal.targetDate) : null,
  };
}
