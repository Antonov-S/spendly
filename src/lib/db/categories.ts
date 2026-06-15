import "server-only";
import { prisma } from "@/lib/prisma";
import type { CategoryOption } from "@/types/transactions";

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
