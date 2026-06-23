"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCategoryForEdit as getCategoryForEditQuery } from "@/lib/db/categories";
import { revalidateCategoryViews } from "@/lib/revalidation";
import {
  createCategorySchema,
  updateCategorySchema,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from "@/lib/validations/category";
import type { CategoryOption } from "@/types/transactions";
import type { EditableCategory } from "@/types/categories";

/** Standard mutation result for the write actions. */
export interface MutationResult {
  success: boolean;
  error?: string;
}

/** `createCategory` returns the persisted row so the picker can auto-select it. */
export type CreateCategoryResult =
  | { success: true; data: CategoryOption }
  | { success: false; error: string };

const NOT_AUTHED: MutationResult = {
  success: false,
  error: "You must be signed in.",
};

const NOT_FOUND = "Category not found.";
const DUPLICATE_ERROR = "A category with that name already exists.";

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
 * Case-insensitive dedup pre-check spanning the user's own categories AND the
 * shared system categories. This is the only enforcement of the system-collision
 * rule (no index can express "unique across userId = null OR userId = me") and
 * gives an instant friendly error on the common path. Pass `editingId` to exclude
 * the row being renamed (so recasing your own category is allowed).
 * Returns an error message, or null when the name is free.
 */
async function assertNameAvailable(
  userId: string,
  name: string,
  editingId?: string
): Promise<string | null> {
  const clash = await prisma.category.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      OR: [{ userId: null }, { userId }],
      ...(editingId ? { NOT: { id: editingId } } : {}),
    },
    select: { id: true },
  });
  return clash ? DUPLICATE_ERROR : null;
}

/**
 * Map a thrown write error to a friendly result, or null when the caller should
 * rethrow. A P2002 here is the functional `(lower(name), userId)` index firing on
 * a race the pre-check couldn't see — surface the same "already exists" message,
 * never a 500.
 */
function mapCategoryWriteError(error: unknown): MutationResult | null {
  if (isUniqueViolation(error)) {
    return { success: false, error: DUPLICATE_ERROR };
  }
  return null;
}

/**
 * Create a user category. `userId` is stamped from the session and `isSystem` is
 * forced false — neither is ever accepted from the client. Returns the persisted
 * row as a `CategoryOption` so an inline picker can append-and-select it without
 * an optimistic guess.
 */
export async function createCategory(
  input: CreateCategoryInput
): Promise<CreateCategoryResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: NOT_AUTHED.error! };
  const userId = session.user.id;

  const parsed = createCategorySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { name, icon, color } = parsed.data;

  try {
    const clash = await assertNameAvailable(userId, name);
    if (clash) return { success: false, error: clash };

    const created = await prisma.category.create({
      data: { name, icon, color, userId, isSystem: false },
      select: { id: true, name: true, color: true, icon: true },
    });

    revalidateCategoryViews();
    return { success: true, data: created };
  } catch (error) {
    const mapped = mapCategoryWriteError(error);
    if (mapped) return mapped as CreateCategoryResult;
    console.error("createCategory failed", error);
    return { success: false, error: "Could not create the category." };
  }
}

/**
 * Patch a user category's name / icon / color. Ownership-scoped: a system row
 * (isSystem = true) or another user's row matches zero rows and collapses to
 * "not found" (non-enumerable). Dedup runs only when the name changes, excluding
 * the row itself so recasing is allowed.
 */
export async function updateCategory(
  input: UpdateCategoryInput
): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  const parsed = updateCategorySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { id, name, icon, color } = parsed.data;

  try {
    const existing = await prisma.category.findFirst({
      where: { id, userId, isSystem: false },
      select: { id: true },
    });
    if (!existing) return { success: false, error: NOT_FOUND };

    if (name !== undefined) {
      const clash = await assertNameAvailable(userId, name, id);
      if (clash) return { success: false, error: clash };
    }

    await prisma.category.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(icon !== undefined ? { icon } : {}),
        ...(color !== undefined ? { color } : {}),
      },
    });

    revalidateCategoryViews();
    return { success: true };
  } catch (error) {
    const mapped = mapCategoryWriteError(error);
    if (mapped) return mapped;
    console.error("updateCategory failed", error);
    return { success: false, error: "Could not update the category." };
  }
}

/**
 * Hard delete a user category (no `deletedAt`, no undo — guarded by a confirm
 * dialog). Ownership-scoped. The schema's FK rules then fire automatically:
 * transactions/templates → SetNull (Uncategorized), budgets → Cascade (deleted).
 */
export async function deleteCategory(id: string): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  try {
    const existing = await prisma.category.findFirst({
      where: { id, userId, isSystem: false },
      select: { id: true },
    });
    if (!existing) return { success: false, error: NOT_FOUND };

    await prisma.category.delete({ where: { id } });

    revalidateCategoryViews();
    return { success: true };
  } catch (error) {
    console.error("deleteCategory failed", error);
    return { success: false, error: "Could not delete the category." };
  }
}

/** Thin auth-guarded proxy over the read fetcher, for the drawer's edit pre-fill. */
export async function getCategoryForEdit(id: string): Promise<{
  success: boolean;
  data?: EditableCategory;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: NOT_AUTHED.error };

  try {
    const category = await getCategoryForEditQuery(session.user.id, id);
    if (!category) return { success: false, error: NOT_FOUND };
    return { success: true, data: category };
  } catch (error) {
    console.error("getCategoryForEdit failed", error);
    return { success: false, error: "Could not load the category." };
  }
}
