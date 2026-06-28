import { z } from "zod";
import { IMPORT_DATE_FORMATS } from "@/lib/constants";

/**
 * Validation for the import options the client sends to `previewImport` /
 * `commitImport` (data-import-spec §3.2). The uploaded `File` rides in `FormData`;
 * this validates the accompanying plain-object options only. `accountId` is
 * re-verified owned + active server-side (C1) — this schema only checks shape.
 */

const columnIndex = z.number().int().nullable();

/** 0-based column-index mapping for a CSV (null when unmapped). */
export const importMappingSchema = z.object({
  date: columnIndex,
  amount: columnIndex,
  type: columnIndex,
  category: columnIndex,
  merchant: columnIndex,
  note: columnIndex,
});

export const importOptionsSchema = z
  .object({
    format: z.enum(["csv", "json"]),
    accountId: z.string().min(1, "Select an account"),
    categoryResolution: z.enum(["CREATE", "UNCATEGORIZED"]),
    skipDuplicates: z.boolean(),
    mapping: importMappingSchema.nullable(),
    dateFormat: z.enum(IMPORT_DATE_FORMATS).nullable(),
    decimal: z.enum([".", ","]).nullable(),
  })
  .refine(
    (o) =>
      o.format !== "csv" ||
      (o.mapping !== null &&
        o.mapping.date !== null &&
        o.mapping.amount !== null),
    {
      message: "Map the Date and Amount columns to continue.",
      path: ["mapping"],
    }
  );

export type ImportOptionsInput = z.infer<typeof importOptionsSchema>;
