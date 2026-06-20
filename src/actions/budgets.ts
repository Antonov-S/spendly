"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getBudgetForEdit as getBudgetForEditQuery } from "@/lib/db/budgets";
import { BUDGET_PRESETS } from "@/lib/constants";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import {
  createBudgetSchema,
  updateBudgetSchema,
  type CreateBudgetInput,
  type UpdateBudgetInput,
} from "@/lib/validations/budget";
import type { BudgetEditable } from "@/types/dashboard";

/** Standard mutation result for the write actions. */
export interface MutationResult {
  success: boolean;
  error?: string;
}

const NOT_AUTHED: MutationResult = {
  success: false,
  error: "You must be signed in.",
};

const DUPLICATE_ERROR =
  "A budget for this category already exists this month.";

/** Revalidate every surface that renders budgets or derived remaining totals. */
function revalidateBudgetViews() {
  revalidatePath("/budgets");
  revalidatePath("/dashboard");
}

/** Round a money magnitude to the 2 decimals the Decimal(12,2) column stores. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** True when a thrown error is a Prisma unique-constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Create a budget for a category + period. Revive-or-create: the unique key
 * ignores `isArchived`, so a plain create can collide with an archived row. A
 * best-effort pre-check returns a friendly error for an *active* duplicate, then
 * an atomic `upsert` revives an archived row (keeping its id) or inserts.
 */
export async function createBudget(
  input: CreateBudgetInput
): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  const parsed = createBudgetSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { categoryId, amount, month, year } = parsed.data;

  try {
    const category = await prisma.category.findFirst({
      where: { id: categoryId, OR: [{ userId }, { userId: null }] },
      select: { id: true },
    });
    if (!category) return { success: false, error: "Category not found." };

    const key = {
      userId_categoryId_month_year: { userId, categoryId, month, year },
    };

    // UX-only pre-check: an *active* duplicate is a user error, not a revive.
    const existing = await prisma.budget.findUnique({ where: key });
    if (existing && !existing.isArchived) {
      return { success: false, error: DUPLICATE_ERROR };
    }

    const magnitude = round2(amount);
    await prisma.budget.upsert({
      where: key,
      update: {
        amount: magnitude,
        currency: DEFAULT_CURRENCY,
        isArchived: false,
      },
      create: {
        userId,
        categoryId,
        amount: magnitude,
        currency: DEFAULT_CURRENCY,
        month,
        year,
      },
    });

    revalidateBudgetViews();
    return { success: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { success: false, error: DUPLICATE_ERROR };
    }
    console.error("createBudget failed", error);
    return { success: false, error: "Could not create the budget." };
  }
}

/** Update an existing active budget's ceiling. Category/period are immutable. */
export async function updateBudget(
  id: string,
  input: UpdateBudgetInput
): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  const parsed = updateBudgetSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const existing = await prisma.budget.findFirst({
      where: { id, userId, isArchived: false },
      select: { id: true },
    });
    if (!existing) return { success: false, error: "Budget not found." };

    await prisma.budget.update({
      where: { id },
      data: { amount: round2(parsed.data.amount) },
    });

    revalidateBudgetViews();
    return { success: true };
  } catch (error) {
    console.error("updateBudget failed", error);
    return { success: false, error: "Could not update the budget." };
  }
}

/** Archive a budget — the UI "delete". Reversible via `unarchiveBudget`. */
export async function archiveBudget(id: string): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  try {
    const existing = await prisma.budget.findFirst({
      where: { id, userId, isArchived: false },
      select: { id: true },
    });
    if (!existing) return { success: false, error: "Budget not found." };

    await prisma.budget.update({
      where: { id },
      data: { isArchived: true },
    });

    revalidateBudgetViews();
    return { success: true };
  } catch (error) {
    console.error("archiveBudget failed", error);
    return { success: false, error: "Could not archive the budget." };
  }
}

/**
 * Snackbar undo — reactivates an archived budget. The defensive duplicate guard
 * only fires if another *active* row took the slot via an external mutation
 * (not reachable through normal app flow, since revival happens in place).
 */
export async function unarchiveBudget(id: string): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  try {
    const existing = await prisma.budget.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) return { success: false, error: "Budget not found." };

    await prisma.budget.update({
      where: { id },
      data: { isArchived: false },
    });

    revalidateBudgetViews();
    return { success: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        success: false,
        error: "A budget for this category already exists this month.",
      };
    }
    console.error("unarchiveBudget failed", error);
    return { success: false, error: "Could not restore the budget." };
  }
}

/** Result of a preset-seed: how many starter budgets were created. */
export interface SeedPresetResult extends MutationResult {
  data?: { created: number };
}

/**
 * One-tap starter budgets for an empty period. Resolves preset names → system
 * category ids, skips any category that already has *any* row for the period
 * (archived or active — bulk convenience must not resurrect archived budgets),
 * and inserts the rest. Never overwrites an existing amount.
 */
export async function seedPresetBudgets(
  month: number,
  year: number
): Promise<SeedPresetResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  try {
    const presetNames = BUDGET_PRESETS.map((p) => p.categoryName);
    const categories = await prisma.category.findMany({
      where: { isSystem: true, name: { in: presetNames } },
      select: { id: true, name: true },
    });
    const idByName = new Map(categories.map((c) => [c.name, c.id]));

    const existing = await prisma.budget.findMany({
      where: { userId, month, year },
      select: { categoryId: true },
    });
    const taken = new Set(existing.map((b) => b.categoryId));

    const data = BUDGET_PRESETS.flatMap((preset) => {
      const categoryId = idByName.get(preset.categoryName);
      if (!categoryId || taken.has(categoryId)) return [];
      return [
        {
          userId,
          categoryId,
          amount: round2(preset.amount),
          currency: DEFAULT_CURRENCY,
          month,
          year,
        },
      ];
    });

    if (data.length === 0) {
      return { success: true, data: { created: 0 } };
    }

    const result = await prisma.budget.createMany({
      data,
      skipDuplicates: true,
    });

    revalidateBudgetViews();
    return { success: true, data: { created: result.count } };
  } catch (error) {
    console.error("seedPresetBudgets failed", error);
    return { success: false, error: "Could not add starter budgets." };
  }
}

/** Thin auth-guarded proxy over the read fetcher, for the drawer's edit pre-fill. */
export async function getBudgetForEdit(id: string): Promise<{
  success: boolean;
  data?: BudgetEditable;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: NOT_AUTHED.error };

  try {
    const budget = await getBudgetForEditQuery(session.user.id, id);
    if (!budget) return { success: false, error: "Budget not found." };
    return { success: true, data: budget };
  } catch (error) {
    console.error("getBudgetForEdit failed", error);
    return { success: false, error: "Could not load the budget." };
  }
}
