import { z } from "zod";
import { GOAL_AMOUNT_MAX } from "@/lib/system-constants";

/**
 * Validation for the goal write actions. The user enters a positive magnitude
 * for `targetAmount`; `currency`, `userId`, `currentAmount`, and `isCompleted`
 * are server-resolved and never accepted from the client (mirrors budgets).
 *
 * Contribution `amount` is the exception: it is **signed and nonzero**
 * (negative = withdrawal) and taken verbatim — there is no server-side sign
 * derivation here, unlike transactions/budgets.
 */

/** Positive target magnitude, capped at the same limit the UI advertises. */
const targetAmount = z.coerce
  .number()
  .refine((n) => Number.isFinite(n), "Enter a valid amount")
  .refine((n) => n > 0, "Enter an amount greater than 0")
  .refine((n) => n <= GOAL_AMOUNT_MAX, "That target is too large");

/** Optional calendar date as "YYYY-MM-DD" (matches `dateInputToUtc` consumers). */
const targetDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
  .nullish();

const note = z.string().trim().max(200).nullish();

/** Create: name + target. Currency + currentAmount are server-resolved. */
export const createGoalSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  targetAmount,
  targetDate,
});

/** Update: name / target / targetDate — all optional (patch). currentAmount/isCompleted not editable here. */
export const updateGoalSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  targetAmount: targetAmount.optional(),
  targetDate, // already nullish — allows clearing the date
});

/** Contribution: signed nonzero amount (negative = withdrawal), date, optional note. */
export const addContributionSchema = z.object({
  goalId: z.string().min(1),
  amount: z.coerce
    .number()
    .refine((n) => Number.isFinite(n), "Enter a valid amount")
    .refine((n) => n !== 0, "Enter a nonzero amount")
    .refine((n) => Math.abs(n) <= GOAL_AMOUNT_MAX, "That amount is too large"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date"),
  note,
});

export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;
export type AddContributionInput = z.infer<typeof addContributionSchema>;
