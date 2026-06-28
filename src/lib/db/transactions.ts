import "server-only";
import { prisma } from "@/lib/prisma";
import { buildTransactionWhere, collapseTransfers } from "@/lib/transactions";
import { TRANSACTIONS_PAGE_SIZE } from "@/lib/constants";
import type { Prisma } from "@/generated/prisma/client";
import type {
  TransactionFilters,
  TransactionLeg,
  TransactionPage,
  TrashTransaction,
} from "@/types/transactions";

/** Shape returned by the feed query (relations selected for display). */
type QueriedTransaction = Prisma.TransactionGetPayload<{
  include: {
    category: { select: { name: true; color: true; icon: true } };
    financialAccount: { select: { name: true } };
  };
}>;

const FEED_INCLUDE = {
  category: { select: { name: true, color: true, icon: true } },
  financialAccount: { select: { name: true } },
} satisfies Prisma.TransactionInclude;

/** Normalize a queried row into a `TransactionLeg` with a resolved category. */
function toLeg(tx: QueriedTransaction): TransactionLeg {
  return {
    id: tx.id,
    type: tx.type,
    amount: Number(tx.amount),
    currency: tx.currency,
    date: tx.date,
    merchant: tx.merchant,
    note: tx.note,
    isTransferLeg: tx.isTransferLeg,
    transferPairId: tx.transferPairId,
    financialAccountId: tx.financialAccountId,
    accountName: tx.financialAccount.name,
    category: tx.category
      ? {
          name: tx.category.name,
          color: tx.category.color,
          icon: tx.category.icon,
        }
      : null,
  };
}

/**
 * Fetch one page of the transaction feed for a user.
 *
 * Pagination is cursor-based on `(date, createdAt, id)`. Transfer pairs are
 * collapsed to a single row **before** the limit so a pair can never be split
 * across a page boundary: in all-accounts mode the inflow leg is excluded at the
 * query level (one canonical outflow row per pair); in single-account mode the
 * query already returns just the in-account leg. The counterparty leg is then
 * backfilled by `transferPairId` purely to name the other account.
 */
export async function getTransactions(
  userId: string,
  filters: TransactionFilters,
  cursor?: string
): Promise<TransactionPage> {
  const where = buildTransactionWhere(userId, filters);

  // All-accounts view: keep one canonical row per transfer by dropping the
  // inflow (positive) leg. Single-account view already returns one leg.
  if (!filters.accountId) {
    where.NOT = { isTransferLeg: true, amount: { gt: 0 } };
  }

  const queried = await prisma.transaction.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: TRANSACTIONS_PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: FEED_INCLUDE,
  });

  const hasMore = queried.length > TRANSACTIONS_PAGE_SIZE;
  const pageRows = queried.slice(0, TRANSACTIONS_PAGE_SIZE);
  const canonicalLegs = pageRows.map(toLeg);

  // Backfill counterparty legs for any transfers on this page so the collapse
  // helper can name the other account.
  const pairIds = canonicalLegs
    .filter((l) => l.transferPairId)
    .map((l) => l.transferPairId as string);

  let counterpartyLegs: TransactionLeg[] = [];
  if (pairIds.length > 0) {
    const onPage = new Set(canonicalLegs.map((l) => l.id));
    const others = await prisma.transaction.findMany({
      where: { userId, deletedAt: null, transferPairId: { in: pairIds } },
      include: FEED_INCLUDE,
    });
    counterpartyLegs = others.map(toLeg).filter((l) => !onPage.has(l.id));
  }

  const rows = collapseTransfers(
    [...canonicalLegs, ...counterpartyLegs],
    filters.accountId
  );

  const nextCursor =
    hasMore && canonicalLegs.length > 0
      ? canonicalLegs[canonicalLegs.length - 1].id
      : null;

  return { rows, nextCursor };
}

/**
 * Fetch the user's soft-deleted transactions for the `/trash` recovery list,
 * newest deletion first.
 *
 * Unlike the feed, this includes rows on **archived** accounts (their history
 * stays recoverable) and does NOT drop the inflow transfer leg at the query
 * level: both legs of a deleted transfer share `deletedAt`, so keeping them both
 * in the result lets `collapseTransfers` pair them with no counterparty backfill.
 * The deletion timestamp is re-attached to each collapsed row by the canonical
 * (outflow) leg id, which `collapseTransfers` preserves as `FeedTransaction.id`.
 */
export async function getDeletedTransactions(
  userId: string
): Promise<TrashTransaction[]> {
  const queried = await prisma.transaction.findMany({
    where: { userId, deletedAt: { not: null } },
    orderBy: [{ deletedAt: "desc" }, { id: "desc" }],
    take: TRANSACTIONS_PAGE_SIZE,
    include: FEED_INCLUDE,
  });

  const deletedAtById = new Map<string, Date>(
    // `deletedAt` is non-null here (the where filters it), but Prisma still types
    // it as `Date | null`; the `!` is safe within this query's result set.
    queried.map((tx) => [tx.id, tx.deletedAt!])
  );

  const rows = collapseTransfers(queried.map(toLeg));

  return rows.map((row) => ({
    ...row,
    deletedAt: deletedAtById.get(row.id)!,
  }));
}

/** Count of the user's soft-deleted transactions — drives the header badge. */
export async function getDeletedTransactionCount(
  userId: string
): Promise<number> {
  return prisma.transaction.count({
    where: { userId, deletedAt: { not: null } },
  });
}
