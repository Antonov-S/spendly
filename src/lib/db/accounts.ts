import "server-only";
import { prisma } from "@/lib/prisma";
import { mapAccountRow } from "@/lib/account";
import type { AccountOption } from "@/types/transactions";
import type { AccountListRow, EditableAccount } from "@/types/accounts";

/**
 * Non-archived accounts for the global topbar selector, ordered by name.
 *
 * Two invariants every selector surface (topbar pill, drawer, transfer,
 * recurring, budgets) relies on without re-filtering:
 *   1. Active-only — `isArchived: false` is the single mechanism keeping
 *      archived accounts out of every selector.
 *   2. Canonical order — alphabetical by name; the "first active account" the
 *      drawer pre-selects is element [0].
 * Returns the minimal `{ id, name }` shape — balances are `getAccountsWithBalances`'s job.
 */
export async function getUserAccounts(
  userId: string
): Promise<AccountOption[]> {
  return prisma.financialAccount.findMany({
    where: { userId, isArchived: false },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Count of the user's *active* (non-archived) accounts — the onboarding gate
 * signal. Zero means "no usable account yet", which routes the user into the
 * first-run flow. Uses the same `isArchived: false` predicate every selector
 * relies on, so "onboarded" matches "can capture a transaction right now".
 */
export async function getActiveAccountCount(userId: string): Promise<number> {
  return prisma.financialAccount.count({
    where: { userId, isArchived: false },
  });
}

/**
 * Accounts with their derived balance for the `/accounts` management list.
 * Two queries (no N+1): one `findMany` for the accounts, one `groupBy` summing
 * every non-deleted transaction per account. Ordering is the §11 business rule —
 * active accounts first, then archived; alphabetical within each group.
 */
export async function getAccountsWithBalances(
  userId: string,
  { includeArchived }: { includeArchived: boolean }
): Promise<AccountListRow[]> {
  const [accounts, sums] = await Promise.all([
    prisma.financialAccount.findMany({
      where: { userId, ...(includeArchived ? {} : { isArchived: false }) },
      orderBy: [{ isArchived: "asc" }, { name: "asc" }],
    }),
    prisma.transaction.groupBy({
      by: ["financialAccountId"],
      where: { userId, deletedAt: null },
      _sum: { amount: true },
    }),
  ]);

  const sumByAccount = new Map(
    sums.map((s) => [s.financialAccountId, s._sum.amount])
  );

  return accounts.map((account) =>
    mapAccountRow(account, sumByAccount.get(account.id) ?? null)
  );
}

/**
 * Single account scoped by `userId`, mapped to the drawer pre-fill shape.
 * Returns null if not found or not owned.
 */
export async function getAccountForEdit(
  userId: string,
  id: string
): Promise<EditableAccount | null> {
  const account = await prisma.financialAccount.findFirst({
    where: { id, userId },
    select: {
      id: true,
      name: true,
      type: true,
      startingBalance: true,
      currency: true,
      color: true,
      icon: true,
    },
  });
  if (!account) return null;
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    startingBalance: Number(account.startingBalance),
    currency: account.currency,
    color: account.color,
    icon: account.icon,
  };
}
