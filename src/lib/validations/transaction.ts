import { z } from "zod";
import {
  MERCHANT_MAX,
  NOTE_MAX,
  TAG_MAX_PER_TRANSACTION,
} from "@/lib/system-constants";

/**
 * Validation for the transaction write actions. The user always enters a
 * **positive magnitude** in the drawer; the server action derives the stored
 * sign from the type (see `src/actions/transactions.ts`). Currency is resolved
 * server-side from the account — never taken from the client.
 */

/** "YYYY-MM-DD" local calendar date (no time/timezone; no UTC coercion). */
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date");

/** Positive money magnitude. Coerced so a string from the input is accepted. */
const amount = z.coerce
  .number()
  .refine((n) => Number.isFinite(n), "Enter a valid amount")
  .refine((n) => n > 0, "Enter an amount greater than 0");

/** Optional free-text field: trims, caps length, normalizes null/""/undefined → null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .nullish()
    .transform((v) => (v ? v : null));

/**
 * Optional, bounded tag-id array. Lenient (defaults to `[]`) so existing callers
 * and the AI / quick-add draft path that don't send tags keep working. Ownership
 * of each id is checked in the action, not here.
 */
const tagIds = z
  .array(z.string().min(1))
  .max(TAG_MAX_PER_TRANSACTION, `Up to ${TAG_MAX_PER_TRANSACTION} tags`)
  .optional()
  .transform((v) => v ?? []);

/** Create an income or expense. `type` drives the sign server-side. */
export const createTransactionSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  amount,
  date: dateString,
  financialAccountId: z.string().min(1, "Select an account"),
  categoryId: z
    .string()
    .min(1)
    .nullish()
    .transform((v) => v ?? null),
  merchant: optionalText(MERCHANT_MAX),
  note: optionalText(NOTE_MAX),
  tagIds,
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

/** Update an existing income/expense (transaction id is passed separately). */
export const updateTransactionSchema = createTransactionSchema;

export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

/** Create or replace a transfer: two legs, source and destination must differ. */
export const transferSchema = z
  .object({
    amount,
    date: dateString,
    fromAccountId: z.string().min(1, "Select a source account"),
    toAccountId: z.string().min(1, "Select a destination account"),
    merchant: optionalText(MERCHANT_MAX),
    note: optionalText(NOTE_MAX),
  })
  .refine((d) => d.fromAccountId !== d.toAccountId, {
    message: "Choose two different accounts",
    path: ["toAccountId"],
  });

export type TransferInput = z.infer<typeof transferSchema>;
