import "server-only";
import { prisma } from "@/lib/prisma";
import type { AccountOption } from "@/types/transactions";

/**
 * Non-archived accounts for the global topbar selector, ordered by name.
 * Archived accounts are hidden from selectors per the architecture rules.
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
