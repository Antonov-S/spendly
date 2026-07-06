"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getGoalForEdit as getGoalForEditQuery } from "@/lib/db/goals";
import { revalidateGoalViews } from "@/lib/revalidation";
import { track } from "@/lib/analytics/track";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { dateInputToUtc } from "@/lib/date";
import {
  createGoalSchema,
  updateGoalSchema,
  addContributionSchema,
  type CreateGoalInput,
  type UpdateGoalInput,
  type AddContributionInput,
} from "@/lib/validations/goal";
import type { EditableGoal } from "@/types/goals";

/** Standard mutation result for the write actions. */
export interface MutationResult {
  success: boolean;
  error?: string;
}

const NOT_AUTHED: MutationResult = {
  success: false,
  error: "You must be signed in.",
};

/**
 * Thrown inside a `$transaction` to force a rollback when the target goal is
 * missing or owned by another user. Caught outside and collapsed to a single
 * "not found" message so ownership stays non-enumerable.
 */
class GoalNotFoundError extends Error {}

/** Round a money magnitude to the 2 decimals the Decimal(12,2) column stores. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Create a virtual savings goal. `currency` is server-stamped EUR
 * (`DEFAULT_CURRENCY`), `currentAmount` starts at 0, and `isCompleted` is false
 * — none of these are accepted from the client.
 */
export async function createGoal(
  input: CreateGoalInput
): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  const parsed = createGoalSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { name, targetAmount, targetDate } = parsed.data;

  try {
    await prisma.goal.create({
      data: {
        userId,
        name,
        targetAmount: round2(targetAmount),
        currentAmount: 0,
        currency: DEFAULT_CURRENCY,
        isCompleted: false,
        targetDate: targetDate ? dateInputToUtc(targetDate) : null,
      },
    });

    revalidateGoalViews();
    void track("goal_created");
    return { success: true };
  } catch (error) {
    console.error("createGoal failed", error);
    return { success: false, error: "Could not create the goal." };
  }
}

/**
 * Patch a goal's name / target / targetDate. Ownership-scoped. Never touches
 * `currentAmount` or `isCompleted` — lowering the target below the saved amount
 * is allowed (the goal becomes overfunded, not auto-completed).
 */
export async function updateGoal(
  id: string,
  input: UpdateGoalInput
): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  const parsed = updateGoalSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { name, targetAmount, targetDate } = parsed.data;

  try {
    const existing = await prisma.goal.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) return { success: false, error: "Goal not found." };

    await prisma.goal.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(targetAmount !== undefined ? { targetAmount: round2(targetAmount) } : {}),
        // targetDate is nullish: undefined = leave as-is, null = clear, string = set.
        ...(targetDate !== undefined
          ? { targetDate: targetDate ? dateInputToUtc(targetDate) : null }
          : {}),
      },
    });

    revalidateGoalViews();
    return { success: true };
  } catch (error) {
    console.error("updateGoal failed", error);
    return { success: false, error: "Could not update the goal." };
  }
}

/**
 * Mark a goal complete. Manual only — the app never auto-completes at 100%, and
 * this is the single setter of `isCompleted`. Independent of progress.
 */
export async function completeGoal(id: string): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  try {
    const existing = await prisma.goal.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) return { success: false, error: "Goal not found." };

    await prisma.goal.update({
      where: { id },
      data: { isCompleted: true },
    });

    revalidateGoalViews();
    return { success: true };
  } catch (error) {
    console.error("completeGoal failed", error);
    return { success: false, error: "Could not complete the goal." };
  }
}

/**
 * Hard delete a goal. No `deletedAt`, no undo — cascades to all contributions
 * (`onDelete: Cascade`). Guarded by a confirm dialog in the UI, not a snackbar.
 */
export async function deleteGoal(id: string): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  try {
    const existing = await prisma.goal.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) return { success: false, error: "Goal not found." };

    await prisma.goal.delete({ where: { id } });

    revalidateGoalViews();
    return { success: true };
  } catch (error) {
    console.error("deleteGoal failed", error);
    return { success: false, error: "Could not delete the goal." };
  }
}

/**
 * Add a contribution (or withdrawal). The `amount` is signed and taken verbatim
 * (negative = withdrawal). Atomic: inserts the row AND increments the goal's
 * `currentAmount` in the same `$transaction`, so the invariant
 * `currentAmount === SUM(contributions)` can never half-apply.
 */
export async function addContribution(
  input: AddContributionInput
): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  const parsed = addContributionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { goalId, amount, date, note } = parsed.data;
  const magnitude = round2(amount);

  try {
    await prisma.$transaction(async (tx) => {
      // Ownership gate INSIDE the tx — a foreign/missing goal must not create a row.
      const goal = await tx.goal.findFirst({
        where: { id: goalId, userId },
        select: { id: true },
      });
      if (!goal) throw new GoalNotFoundError();

      await tx.goalContribution.create({
        data: {
          goalId,
          amount: magnitude,
          date: dateInputToUtc(date),
          note: note ?? null,
        },
      });
      await tx.goal.update({
        where: { id: goalId },
        data: { currentAmount: { increment: magnitude } },
      });
    });

    revalidateGoalViews();
    return { success: true };
  } catch (error) {
    if (error instanceof GoalNotFoundError) {
      return { success: false, error: "Goal not found." };
    }
    console.error("addContribution failed", error);
    return { success: false, error: "Could not add the contribution." };
  }
}

/**
 * Delete a contribution. Atomic: removes the row AND decrements the goal's
 * `currentAmount` by the **stored row amount** (read from the DB inside the
 * transaction — never a client-supplied or recomputed figure), preserving the
 * invariant exactly. Takes only the contribution `id`.
 */
export async function deleteContribution(id: string): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  try {
    await prisma.$transaction(async (tx) => {
      const contribution = await tx.goalContribution.findFirst({
        where: { id, goal: { userId } },
        select: { id: true, amount: true, goalId: true },
      });
      if (!contribution) throw new GoalNotFoundError();

      await tx.goalContribution.delete({ where: { id: contribution.id } });
      await tx.goal.update({
        where: { id: contribution.goalId },
        // Decrement by the value read from the DB row (Decimal-native).
        data: { currentAmount: { decrement: contribution.amount } },
      });
    });

    revalidateGoalViews();
    return { success: true };
  } catch (error) {
    if (error instanceof GoalNotFoundError) {
      return { success: false, error: "Contribution not found." };
    }
    console.error("deleteContribution failed", error);
    return { success: false, error: "Could not delete the contribution." };
  }
}

/** Thin auth-guarded proxy over the read fetcher, for the drawer's edit pre-fill. */
export async function getGoalForEdit(id: string): Promise<{
  success: boolean;
  data?: EditableGoal;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: NOT_AUTHED.error };

  try {
    const goal = await getGoalForEditQuery(session.user.id, id);
    if (!goal) return { success: false, error: "Goal not found." };
    return { success: true, data: goal };
  } catch (error) {
    console.error("getGoalForEdit failed", error);
    return { success: false, error: "Could not load the goal." };
  }
}
