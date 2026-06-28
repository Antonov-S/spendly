import type { ResolvedRow } from "@/types/import";

/**
 * Count-based multiset dedup (data-import-spec D4). Per target account, the
 * identity tuple is `(date, signedAmount, type, merchant, note)` — category is
 * intentionally excluded, so re-categorizing a row never creates a phantom. Pure:
 * no Prisma, no I/O.
 */

/** The signed stored amount for a resolved row (EXPENSE negative). */
export function signedAmount(row: {
  amount: number;
  type: "INCOME" | "EXPENSE";
}): number {
  return row.type === "EXPENSE" ? -row.amount : row.amount;
}

/**
 * Stable identity key. `amount` is the **signed** stored value, so a +10 income
 * and a −10 expense never collide. `JSON.stringify` keeps null vs "" distinct and
 * the field boundaries unambiguous.
 */
export function dedupKey(r: {
  date: string;
  amount: number;
  type: string;
  merchant: string | null;
  note: string | null;
}): string {
  return JSON.stringify([r.date, r.amount, r.type, r.merchant, r.note]);
}

/**
 * For each identity key, create `max(0, incoming − existing)` rows — making a
 * re-import of the same file idempotent while preserving legitimate duplicates
 * (two €3 coffees, same day). When `skipDuplicates` is false, every row is
 * created. Map-based, single pass (sub-quadratic at the row ceiling).
 */
export function partitionForWrite(
  rows: ResolvedRow[],
  existingCounts: Map<string, number>,
  skipDuplicates: boolean
): { toCreate: ResolvedRow[]; duplicatesSkipped: number } {
  if (!skipDuplicates) {
    return { toCreate: [...rows], duplicatesSkipped: 0 };
  }

  const remaining = new Map(existingCounts);
  const toCreate: ResolvedRow[] = [];
  let duplicatesSkipped = 0;

  for (const r of rows) {
    const key = dedupKey({
      date: r.date,
      amount: signedAmount(r),
      type: r.type,
      merchant: r.merchant,
      note: r.note,
    });
    const rem = remaining.get(key) ?? 0;
    if (rem > 0) {
      remaining.set(key, rem - 1);
      duplicatesSkipped++;
    } else {
      toCreate.push(r);
    }
  }
  return { toCreate, duplicatesSkipped };
}
