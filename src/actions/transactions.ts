"use server";

import { auth } from "@/auth";
import { getTransactions } from "@/lib/db/transactions";
import type { TransactionFilters, TransactionPage } from "@/types/transactions";

/** Result of a "load more" request, following the action result convention. */
export interface LoadMoreResult {
  success: boolean;
  data?: TransactionPage;
  error?: string;
}

/**
 * Read-only pagination for the transactions feed: returns the next cursor page
 * for the signed-in user. No writes — create/edit/delete arrive in Part 2.
 */
export async function loadMoreTransactions(
  filters: TransactionFilters,
  cursor: string
): Promise<LoadMoreResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated." };
  }

  try {
    const data = await getTransactions(session.user.id, filters, cursor);
    return { success: true, data };
  } catch (error) {
    console.error("loadMoreTransactions failed", error);
    return { success: false, error: "Could not load more transactions." };
  }
}
