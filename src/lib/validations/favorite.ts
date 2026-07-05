import { z } from "zod";
import {
  FAVORITE_NAME_MAX,
  MERCHANT_MAX,
  NOTE_MAX,
} from "@/lib/system-constants";

const amount = z.coerce
  .number()
  .refine((n) => Number.isFinite(n), "Enter a valid amount")
  .refine((n) => n > 0, "Enter an amount greater than 0");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .nullish()
    .transform((v) => (v ? v : null));

const optionalId = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null));

export const createFavoriteSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(FAVORITE_NAME_MAX),
  type: z.enum(["INCOME", "EXPENSE"]),
  amount: amount.nullish().transform((v) => v ?? null),
  categoryId: optionalId,
  financialAccountId: optionalId,
  merchant: optionalText(MERCHANT_MAX),
  note: optionalText(NOTE_MAX),
});

export type CreateFavoriteInput = z.infer<typeof createFavoriteSchema>;

export const updateFavoriteSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(FAVORITE_NAME_MAX),
});

export type UpdateFavoriteInput = z.infer<typeof updateFavoriteSchema>;
