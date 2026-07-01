import "server-only";
import { prisma } from "@/lib/prisma";
import type { TagOption, ManageableTag, EditableTag } from "@/types/tags";

/**
 * All of the user's tags, for the drawer picker + the feed filter pill. Ordered
 * by name (the one ordering rule applied on every tag surface). There are no
 * system tags, so this is simply "the user's own tags".
 */
export async function getUserTags(userId: string): Promise<TagOption[]> {
  return prisma.tag.findMany({
    where: { userId },
    select: { id: true, name: true, color: true },
    orderBy: { name: "asc" },
  });
}

/**
 * The user's tags + usage count, for the `/settings` manage list + delete-impact
 * dialog. The count scopes to non-deleted transactions (one consistent "count
 * what the user will notice" rule — a soft-deleted transaction's join row still
 * exists but is out of the feed). `_count` keeps this to one query — no N+1.
 */
export async function getManageableTags(
  userId: string
): Promise<ManageableTag[]> {
  const tags = await prisma.tag.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      color: true,
      _count: {
        select: {
          transactions: { where: { transaction: { deletedAt: null } } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return tags.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    transactionCount: t._count.transactions,
  }));
}

/**
 * A single tag for the drawer's edit pre-fill. Scoped so a foreign row returns
 * null (collapsed to "not found" by the action proxy). Mirrors
 * `getCategoryForEdit`, minus the `isSystem` axis (there are no system tags).
 */
export async function getTagForEdit(
  userId: string,
  id: string
): Promise<EditableTag | null> {
  return prisma.tag.findFirst({
    where: { id, userId },
    select: { id: true, name: true, color: true },
  });
}
