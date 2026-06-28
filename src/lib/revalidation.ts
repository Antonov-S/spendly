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
  // Soft-deletes feed the trash list, and restores/hard-deletes drain it.
  revalidatePath("/trash");
}

/**
 * Revalidate every surface affected by an account mutation: the `/accounts`
 * management list, the `/dashboard` hero/metric totals, and `/transactions`
 * (the topbar account selector + any account-scoped view). One helper so account
 * actions never scatter individual `revalidatePath` calls (mirrors
 * `revalidateTransactionViews`).
 */
export function revalidateAccountViews() {
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  revalidatePath("/transactions");
}

/**
 * Revalidate every surface that renders goals or goal progress: the `/goals`
 * management page and the `/dashboard` GoalsWidget (which reads the same data).
 * Goals are virtual progress only — they never touch accounts or budgets, so
 * this deliberately does NOT revalidate `/transactions` or `/budgets`.
 */
export function revalidateGoalViews() {
  revalidatePath("/goals");
  revalidatePath("/dashboard");
}

/**
 * Revalidate every surface that lists or assigns categories. Categories fan out
 * widely — every transaction/budget/recurring/report surface renders a category
 * name or color — so this touches more paths than the other helpers. A rename or
 * recolor must propagate everywhere the category is shown; a delete must clear it
 * from feeds and charts.
 */
export function revalidateCategoryViews() {
  revalidatePath("/settings"); // the manage list
  revalidatePath("/transactions"); // pickers + the feed's category labels
  revalidatePath("/budgets"); // picker + budget rows
  revalidatePath("/recurring"); // picker + template rows
  revalidatePath("/dashboard"); // recent-transactions + budget panel
  revalidatePath("/reports"); // spending-by-category chart
}
