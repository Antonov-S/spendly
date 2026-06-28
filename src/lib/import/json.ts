import { z } from "zod";
import { EXPORT_JSON_SCHEMA_VERSION } from "@/lib/system-constants";
import { normalizeJsonRow } from "@/lib/import/parse";
import type { ImportStructuralError, NormalizedImportRow } from "@/types/import";

/**
 * JSON envelope handling (data-import-spec §6.1 / T3). Strict on `schemaVersion`
 * (only the current generation parses; a higher one is rejected, not best-effort
 * parsed), lenient on shape (unknown fields ignored → forward-compatible). Pure:
 * no Prisma, no HTTP. Returns either normalized rows or a distinct structural
 * error so the action can branch (D5).
 */

/**
 * Lenient transaction shape — every field optional (Zod 4 treats `z.unknown()` as
 * *required*, so an absent field would otherwise structurally reject the whole
 * file). A missing/malformed field must make that single row invalid downstream
 * (D5), never reject the import (T3). Unknown extra keys pass through.
 */
const txSchema = z
  .object({
    date: z.unknown().optional(),
    amount: z.unknown().optional(),
    type: z.unknown().optional(),
    category: z.unknown().optional(),
    merchant: z.unknown().optional(),
    note: z.unknown().optional(),
  })
  .passthrough();

/** Envelope: strict version handled separately; unknown envelope keys passthrough. */
const envelopeSchema = z
  .object({
    schemaVersion: z.number(),
    data: z
      .object({ transactions: z.array(txSchema) })
      .passthrough(),
  })
  .passthrough();

export type EnvelopeParseResult =
  | { ok: true; rows: NormalizedImportRow[] }
  | { ok: false; error: ImportStructuralError; message: string };

const UNREADABLE_MESSAGE =
  "We couldn't read this file — is it a valid Spendly JSON export?";
const EMPTY_MESSAGE = "This file has no transactions to import.";
const NEWER_VERSION_MESSAGE =
  "This file was exported by a newer version of Spendly. Update and try again.";
const BAD_SHAPE_MESSAGE =
  "This file isn't a Spendly JSON export — its structure doesn't match.";

/**
 * Parse + validate a Spendly JSON export, returning normalized rows (only
 * `data.transactions` is read — accounts/categories/budgets/goals/recurring are
 * ignored in v1). Distinct errors: invalid syntax → unreadable; higher/unknown
 * `schemaVersion` or bad shape → bad_envelope (with its own message); empty
 * `transactions` → empty.
 */
export function parseImportEnvelope(text: string): EnvelopeParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "unreadable", message: UNREADABLE_MESSAGE };
  }

  // Read the version before full validation so a future generation gets the
  // precise "newer version" message rather than a generic shape error.
  if (
    typeof raw === "object" &&
    raw !== null &&
    "schemaVersion" in raw &&
    typeof (raw as { schemaVersion: unknown }).schemaVersion === "number" &&
    (raw as { schemaVersion: number }).schemaVersion > EXPORT_JSON_SCHEMA_VERSION
  ) {
    return { ok: false, error: "bad_envelope", message: NEWER_VERSION_MESSAGE };
  }

  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "bad_envelope", message: BAD_SHAPE_MESSAGE };
  }
  if (parsed.data.schemaVersion !== EXPORT_JSON_SCHEMA_VERSION) {
    return { ok: false, error: "bad_envelope", message: BAD_SHAPE_MESSAGE };
  }

  const transactions = parsed.data.data.transactions;
  if (transactions.length === 0) {
    return { ok: false, error: "empty", message: EMPTY_MESSAGE };
  }

  const rows = transactions.map((tx, i) => normalizeJsonRow(tx, i + 1));
  return { ok: true, rows };
}
