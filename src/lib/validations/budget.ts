import { z } from "zod";
import { BUDGET_AMOUNT_MAX } from "@/lib/constants";

/**
 * Validation for the budget write actions. The user always enters a positive
 * magnitude (budgets are ceilings — no sign games). Currency, userId and
 * isArchived are resolved server-side and never accepted from the client.
 */

/** Positive money magnitude, capped at the same limit the UI advertises. */
const amount = z.coerce
  .number()
  .refine((n) => Number.isFinite(n), "Enter a valid amount")
  .refine((n) => n > 0, "Enter an amount greater than 0")
  .refine((n) => n <= BUDGET_AMOUNT_MAX, "That budget is too large");

const month = z.coerce.number().int().min(1).max(12);
const year = z.coerce.number().int().min(2020).max(2100);

/** Opt-in carry of the unspent/overspent remainder into the next month. */
const rollover = z.boolean();

/** Create: category + amount for a given period. Currency is server-resolved. */
export const createBudgetSchema = z.object({
  categoryId: z.string().min(1, "Select a category"),
  amount,
  month,
  year,
  rollover,
});

export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;

/**
 * Update: the ceiling and the rollover flag are editable in place (period +
 * category remain the immutable identity).
 */
export const updateBudgetSchema = z.object({ amount, rollover });

export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;
