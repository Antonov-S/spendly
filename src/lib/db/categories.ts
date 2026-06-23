import "server-only";
import { prisma } from "@/lib/prisma";
import type { CategoryOption } from "@/types/transactions";
import type { ManageableCategory, EditableCategory } from "@/types/categories";

/**
 * System categories (userId = null) plus the user's own categories, for the
 * filter-bar multi-select. Ordered by name.
 */
export async function getUserCategories(
  userId: string
): Promise<CategoryOption[]> {
  return prisma.category.findMany({
    where: { OR: [{ userId: null }, { userId }] },
    select: { id: true, name: true, color: true, icon: true },
    orderBy: { name: "asc" },
  });
}

/**
 * The user's OWN categories (isSystem = false), with usage counts for the manage
 * list + delete-impact dialog. System categories are intentionally excluded —
 * they are immutable and don't belong in a "your categories" management view.
 *
 * Counts scope to *user-visible* rows (one consistent "count what the user will
 * notice changing" rule): non-deleted transactions, active (non-archived)
 * budgets, active (non-paused) templates. The FK action at the DB still fires on
 * hidden rows too (a paused template is also nulled; an archived budget is also
 * cascade-deleted), but those are out of view, so the headline impact omits them.
 * `_count` keeps this to one query — no N+1.
 */
export async function getManageableCategories(
  userId: string
): Promise<ManageableCategory[]> {
  const categories = await prisma.category.findMany({
    where: { userId, isSystem: false },
    select: {
      id: true,
      name: true,
      icon: true,
      color: true,
      _count: {
        select: {
          transactions: { where: { deletedAt: null } },
          budgets: { where: { isArchived: false } },
          recurringTemplates: { where: { isActive: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.icon,
    color: c.color,
    transactionCount: c._count.transactions,
    budgetCount: c._count.budgets,
    recurringCount: c._count.recurringTemplates,
  }));
}

/**
 * A single user-owned category for the drawer's edit pre-fill. Scoped so a
 * system row or another user's row returns null (collapsed to "not found" by
 * the action proxy). Mirrors `getBudgetForEdit`.
 */
export async function getCategoryForEdit(
  userId: string,
  id: string
): Promise<EditableCategory | null> {
  return prisma.category.findFirst({
    where: { id, userId, isSystem: false },
    select: { id: true, name: true, icon: true, color: true },
  });
}
