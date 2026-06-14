import "server-only";
import { prisma } from "@/lib/prisma";
import type { ProfileStats } from "@/types/profile";

/**
 * Count the user's records by item type for the profile usage breakdown.
 * Transactions exclude soft-deleted rows to match what the user sees elsewhere.
 */
export async function getProfileStats(userId: string): Promise<ProfileStats> {
  const [financialAccounts, transactions, budgets, goals, recurringTemplates] =
    await Promise.all([
      prisma.financialAccount.count({ where: { userId } }),
      prisma.transaction.count({ where: { userId, deletedAt: null } }),
      prisma.budget.count({ where: { userId } }),
      prisma.goal.count({ where: { userId } }),
      prisma.recurringTemplate.count({ where: { userId } }),
    ]);

  return { financialAccounts, transactions, budgets, goals, recurringTemplates };
}
