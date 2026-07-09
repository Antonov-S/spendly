import "server-only";
import { prisma } from "@/lib/prisma";
import { dateInputToUtc, toDateInputValue } from "@/lib/date";
import { dedupKey } from "@/lib/import/dedup";

/**
 * Read-only data layer for Data Import. The atomic write lives in the action so
 * the transaction is co-located with revalidation. Fetchers are user-scoped.
 */

export interface ImportTargets {
  /** Active accounts only - the target picker (C1). */
  accounts: { id: string; name: string }[];
  /** System + own categories - the resolution index (C2). */
  categories: { id: string; name: string }[];
  /** User-owned tags for JSON round-trip resolution. */
  tags: { id: string; name: string }[];
}

/** Active accounts + visible categories/tags, for the import page + resolver. */
export async function getImportTargets(userId: string): Promise<ImportTargets> {
  const [accounts, categories, tags] = await Promise.all([
    prisma.financialAccount.findMany({
      where: { userId, isArchived: false },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.category.findMany({
      where: { OR: [{ userId: null }, { userId }] },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.tag.findMany({
      where: { userId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { accounts, categories, tags };
}

/**
 * Count existing non-deleted rows in the target account, keyed by the dedup
 * identity tuple. Scoped to userId + financialAccountId + deletedAt:null + the
 * batch's distinct dates. Returns dedupKey -> count.
 */
export async function countExistingForDedup(
  userId: string,
  accountId: string,
  dates: string[]
): Promise<Map<string, number>> {
  const distinctDates = [...new Set(dates)];
  if (distinctDates.length === 0) return new Map();

  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      financialAccountId: accountId,
      deletedAt: null,
      date: { in: distinctDates.map(dateInputToUtc) },
    },
    select: { date: true, amount: true, type: true, merchant: true, note: true },
  });

  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = dedupKey({
      date: toDateInputValue(r.date),
      amount: Number(r.amount),
      type: r.type,
      merchant: r.merchant,
      note: r.note,
    });
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
