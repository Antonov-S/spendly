import { z } from "zod";
import { RECURRING_AMOUNT_MAX } from "@/lib/constants";

/**
 * Validation for the recurring template write actions. The user enters a
 * positive magnitude; the stored transaction sign is derived from `type` at
 * confirm time. `currency` and `userId` are resolved server-side and never
 * accepted from the client. TRANSFER is excluded — a single-account template
 * cannot model a two-legged transfer.
 */

/** Positive money magnitude, capped at the same limit the UI advertises. */
const amount = z.coerce
  .number()
  .refine((n) => Number.isFinite(n), "Enter a valid amount")
  .refine((n) => n > 0, "Enter an amount greater than 0")
  .refine((n) => n <= RECURRING_AMOUNT_MAX, "That amount is too large");

const cadence = z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);

/** Create a recurring template. Currency comes from the chosen account. */
export const createTemplateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  type: z.enum(["INCOME", "EXPENSE"]),
  amount,
  cadence,
  nextOccurrence: z.string().min(1, "Select a start date"), // "YYYY-MM-DD"
  financialAccountId: z.string().min(1, "Select an account"),
  categoryId: z.string().optional(),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

/**
 * Edit a template. Type, account, category, and first-occurrence date are
 * immutable after create — only name, amount, and cadence are editable.
 */
export const updateTemplateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  amount,
  cadence,
});

export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
