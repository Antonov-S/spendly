"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { round2 } from "@/lib/money";
import { track } from "@/lib/analytics/track";
import { FAVORITE_MAX_COUNT } from "@/lib/system-constants";
import {
  createFavoriteSchema,
  reorderFavoritesSchema,
  updateFavoriteSchema,
  type CreateFavoriteInput,
  type ReorderFavoritesInput,
  type UpdateFavoriteInput,
} from "@/lib/validations/favorite";
import { revalidatePath } from "next/cache";
import type { FavoriteOption } from "@/types/favorites";

export interface MutationResult {
  success: boolean;
  error?: string;
}

export type CreateFavoriteResult =
  | { success: true; data: FavoriteOption }
  | { success: false; error: string };

const NOT_AUTHED: MutationResult = {
  success: false,
  error: "You must be signed in.",
};

const NOT_FOUND = "Favorite not found.";
const DUPLICATE_ERROR = "You already have a favorite with this name.";
const LIMIT_ERROR = `You can save up to ${FAVORITE_MAX_COUNT} favorites. Remove one in settings first.`;
const REORDER_STALE_ERROR = "Favorites changed — reload and try again.";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function toFavoriteOption(row: {
  id: string;
  name: string;
  type: string;
  amount: { toString(): string } | number | null;
  categoryId: string | null;
  financialAccountId: string | null;
  merchant: string | null;
  note: string | null;
}): FavoriteOption {
  return {
    id: row.id,
    name: row.name,
    type: row.type === "INCOME" ? "INCOME" : "EXPENSE",
    amount: row.amount === null ? null : Number(row.amount),
    categoryId: row.categoryId,
    financialAccountId: row.financialAccountId,
    merchant: row.merchant,
    note: row.note,
  };
}

async function assertFavoriteNameAvailable(
  userId: string,
  name: string,
  editingId?: string
): Promise<string | null> {
  const clash = await prisma.favorite.findFirst({
    where: {
      userId,
      name: { equals: name, mode: "insensitive" },
      ...(editingId ? { NOT: { id: editingId } } : {}),
    },
    select: { id: true },
  });
  return clash ? DUPLICATE_ERROR : null;
}

function mapFavoriteWriteError(error: unknown): MutationResult | null {
  if (isUniqueViolation(error)) {
    return { success: false, error: DUPLICATE_ERROR };
  }
  return null;
}

async function resolveFavoriteReferences(
  userId: string,
  categoryId: string | null,
  financialAccountId: string | null,
  options?: { skipAccountId?: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (categoryId) {
    const category = await prisma.category.findFirst({
      where: { id: categoryId, OR: [{ userId }, { userId: null }] },
      select: { id: true },
    });
    if (!category) return { ok: false, error: "Category not found." };
  }

  if (financialAccountId && financialAccountId !== options?.skipAccountId) {
    const account = await prisma.financialAccount.findFirst({
      where: { id: financialAccountId, userId, isArchived: false },
      select: { id: true },
    });
    if (!account) return { ok: false, error: "Account not found." };
  }

  return { ok: true };
}

export async function createFavorite(
  input: CreateFavoriteInput
): Promise<CreateFavoriteResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: NOT_AUTHED.error! };
  const userId = session.user.id;

  const parsed = createFavoriteSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const {
    name,
    type,
    amount,
    categoryId,
    financialAccountId,
    merchant,
    note,
  } = parsed.data;

  try {
    const currentCount = await prisma.favorite.count({ where: { userId } });
    if (currentCount >= FAVORITE_MAX_COUNT) {
      return { success: false, error: LIMIT_ERROR };
    }

    const clash = await assertFavoriteNameAvailable(userId, name);
    if (clash) return { success: false, error: clash };

    const refs = await resolveFavoriteReferences(
      userId,
      categoryId,
      financialAccountId
    );
    if (!refs.ok) return { success: false, error: refs.error };

    const created = await prisma.favorite.create({
      data: {
        userId,
        name,
        type,
        amount: amount === null ? null : round2(amount),
        categoryId,
        financialAccountId,
        merchant,
        note,
      },
      select: {
        id: true,
        name: true,
        type: true,
        amount: true,
        categoryId: true,
        financialAccountId: true,
        merchant: true,
        note: true,
      },
    });

    revalidatePath("/settings");
    void track("favorite_created", { favoriteCount: currentCount + 1 });
    return { success: true, data: toFavoriteOption(created) };
  } catch (error) {
    const mapped = mapFavoriteWriteError(error);
    if (mapped) return mapped as CreateFavoriteResult;
    console.error("createFavorite failed", error);
    return { success: false, error: "Could not create the favorite." };
  }
}

export async function updateFavorite(
  id: string,
  input: UpdateFavoriteInput
): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  const parsed = updateFavoriteSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const {
    name,
    type,
    amount,
    categoryId,
    financialAccountId,
    merchant,
    note,
  } = parsed.data;

  try {
    const existing = await prisma.favorite.findFirst({
      where: { id, userId },
      select: { id: true, financialAccountId: true },
    });
    if (!existing) return { success: false, error: NOT_FOUND };

    const clash = await assertFavoriteNameAvailable(userId, name, id);
    if (clash) return { success: false, error: clash };

    const refs = await resolveFavoriteReferences(
      userId,
      categoryId,
      financialAccountId,
      { skipAccountId: existing.financialAccountId }
    );
    if (!refs.ok) return { success: false, error: refs.error };

    await prisma.favorite.update({
      where: { id },
      data: {
        name,
        type,
        amount: amount === null ? null : round2(amount),
        categoryId,
        financialAccountId,
        merchant,
        note,
      },
    });

    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    const mapped = mapFavoriteWriteError(error);
    if (mapped) return mapped;
    console.error("updateFavorite failed", error);
    return { success: false, error: "Could not update the favorite." };
  }
}

export async function reorderFavorites(
  input: ReorderFavoritesInput
): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  const parsed = reorderFavoritesSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { ids } = parsed.data;
  if (new Set(ids).size !== ids.length) {
    return { success: false, error: "Favorite ids must be unique." };
  }

  try {
    const ownedCount = await prisma.favorite.count({
      where: { userId, id: { in: ids } },
    });
    if (ownedCount !== ids.length) {
      return { success: false, error: REORDER_STALE_ERROR };
    }

    await prisma.$transaction([
      ...ids.map((id, sortOrder) =>
        prisma.favorite.update({
          where: { id },
          data: { sortOrder },
        })
      ),
      prisma.favorite.updateMany({
        where: { userId, id: { notIn: ids } },
        data: { sortOrder: null },
      }),
    ]);

    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    console.error("reorderFavorites failed", error);
    return { success: false, error: "Could not reorder favorites." };
  }
}

export async function deleteFavorite(id: string): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  try {
    const existing = await prisma.favorite.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) return { success: false, error: NOT_FOUND };

    await prisma.favorite.delete({ where: { id } });
    const favoriteCount = await prisma.favorite.count({ where: { userId } });

    revalidatePath("/settings");
    void track("favorite_deleted", { favoriteCount });
    return { success: true };
  } catch (error) {
    console.error("deleteFavorite failed", error);
    return { success: false, error: "Could not delete the favorite." };
  }
}

export async function trackFavoriteUsed(input: {
  hasAmount: boolean;
}): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;

  try {
    await track("favorite_used", { hasAmount: input.hasAmount });
    return { success: true };
  } catch (error) {
    console.error("trackFavoriteUsed failed", error);
    return { success: false, error: "Could not track favorite usage." };
  }
}
