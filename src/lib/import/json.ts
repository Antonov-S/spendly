import { z } from "zod";
import { EXPORT_JSON_SCHEMA_VERSION } from "@/lib/system-constants";
import { normalizeJsonRow } from "@/lib/import/parse";
import { normalizeLabelKey } from "@/lib/text";
import { TAG_COLOR_PATTERN } from "@/lib/validations/tag";
import type {
  ImportStructuralError,
  ImportTagRegistryEntry,
  NormalizedImportRow,
} from "@/types/import";

/**
 * JSON envelope handling (data-import-spec §6.1 / T3). Strict on
 * `schemaVersion`, lenient on shape (unknown fields ignored). Pure: no Prisma,
 * no HTTP. Returns normalized rows plus the optional v3 tag registry.
 */

const txSchema = z
  .object({
    date: z.unknown().optional(),
    amount: z.unknown().optional(),
    type: z.unknown().optional(),
    category: z.unknown().optional(),
    merchant: z.unknown().optional(),
    note: z.unknown().optional(),
    splits: z.unknown().optional(),
    tags: z.unknown().optional(),
  })
  .passthrough();

const tagSchema = z
  .object({
    name: z.unknown().optional(),
    color: z.unknown().optional(),
  })
  .passthrough();

/** Envelope: strict version handled separately; unknown envelope keys passthrough. */
const envelopeSchema = z
  .object({
    schemaVersion: z.number(),
    data: z
      .object({
        transactions: z.array(txSchema),
        tags: z.array(tagSchema).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type EnvelopeParseResult =
  | {
      ok: true;
      rows: NormalizedImportRow[];
      tagRegistry: ImportTagRegistryEntry[];
    }
  | { ok: false; error: ImportStructuralError; message: string };

const UNREADABLE_MESSAGE =
  "We couldn't read this file — is it a valid Spendly JSON export?";
const EMPTY_MESSAGE = "This file has no transactions to import.";
const NEWER_VERSION_MESSAGE =
  "This file was exported by a newer version of Spendly. Update and try again.";
const BAD_SHAPE_MESSAGE =
  "This file isn't a Spendly JSON export — its structure doesn't match.";

function coerceTagRegistry(
  rawTags: z.infer<typeof tagSchema>[]
): ImportTagRegistryEntry[] {
  const registry: ImportTagRegistryEntry[] = [];
  const seen = new Set<string>();

  for (const raw of rawTags) {
    if (typeof raw.name !== "string") continue;
    const name = raw.name.trim();
    if (name === "") continue;
    const key = normalizeLabelKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    registry.push({
      name,
      color:
        typeof raw.color === "string" && TAG_COLOR_PATTERN.test(raw.color)
          ? raw.color
          : null,
    });
  }

  return registry;
}

/**
 * Parse + validate a Spendly JSON export, returning normalized rows. Distinct
 * errors: invalid syntax -> unreadable; higher/unknown schemaVersion or bad
 * shape -> bad_envelope; empty transactions -> empty.
 */
export function parseImportEnvelope(text: string): EnvelopeParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "unreadable", message: UNREADABLE_MESSAGE };
  }

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
  if (
    parsed.data.schemaVersion < 1 ||
    parsed.data.schemaVersion > EXPORT_JSON_SCHEMA_VERSION
  ) {
    return { ok: false, error: "bad_envelope", message: BAD_SHAPE_MESSAGE };
  }

  const transactions = parsed.data.data.transactions;
  if (transactions.length === 0) {
    return { ok: false, error: "empty", message: EMPTY_MESSAGE };
  }

  const rows = transactions.map((tx, i) => normalizeJsonRow(tx, i + 1));
  return {
    ok: true,
    rows,
    tagRegistry: coerceTagRegistry(parsed.data.data.tags ?? []),
  };
}
