import "server-only";
import { prisma } from "@/lib/prisma";
import { dateInputToUtc, toDateInputValue } from "@/lib/date";
import { dedupKey } from "@/lib/import/dedup";

/**
 * Read-only data layer for Data Import (data-import-spec §3.5). The atomic write
 * lives in the action (§7.2) so the `$transaction` (D7) is co-located with
 * `revalidate*`. Both fetchers are `userId`-scoped (S2).
 */

export interface ImportTargets {
  /** Active accounts only — the target picker (C1). */
  accounts: { id: string; name: string }[];
  /** System + own categories — the resolution index (C2). */
  categories: { id: string; name: string }[];
}

/** Active accounts + visible categories, for the import page + resolver (C1, C2). */
export async function getImportTargets(userId: string): Promise<ImportTargets> {
  const [accounts, categories] = await Promise.all([
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
  ]);
  return { accounts, categories };
}

/**
 * Count existing non-deleted rows in the target account, keyed by the dedup
 * identity tuple (D4). Scoped to `userId` + `financialAccountId` + `deletedAt:
 * null` + the batch's distinct dates — a bounded `findMany` (not a full-account
 * scan, not N+1). Returns `dedupKey → count`, the `existingCount` half of the
 * multiset dedup. `amount` is read as the **signed** stored value, matching how
 * incoming rows compute their key.
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
