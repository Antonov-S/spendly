import { revalidatePath } from "next/cache";

/**
 * Revalidate every surface that renders transactions or derived balances.
 * Lives in a plain module (not a `"use server"` file) so it can be a shared
 * synchronous helper: server actions must export only async functions, but a
 * sync helper imported into them is fine. Reused by transaction mutations and
 * by `confirmDraft` (which writes a real transaction).
 *
 * Deliberately does NOT touch `/recurring` — a manual transaction never changes
 * templates or drafts. The recurring actions own `/recurring` revalidation.
 */
export function revalidateTransactionViews() {
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  // Spend consumed by a budget is derived from transactions — keep /budgets fresh.
  revalidatePath("/budgets");
}
