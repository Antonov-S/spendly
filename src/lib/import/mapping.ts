import { IMPORT_FIELDS, type ImportFieldKey } from "@/lib/constants";
import type { ImportMapping } from "@/types/import";

/**
 * CSV column mapping (data-import-spec §5.2). Mapping is by **0-based column
 * index**, never header name, so duplicate headers stay unambiguous. Pure: no
 * Prisma, no HTTP.
 */

/** Header synonyms → Spendly field. First matching header (by index) wins. */
const FIELD_SYNONYMS: Record<ImportFieldKey, string[]> = {
  date: ["date", "transaction date", "posted", "day"],
  amount: ["amount", "value", "sum", "total"],
  type: ["type", "kind", "direction"],
  category: ["category", "cat"],
  merchant: ["merchant", "payee", "description", "name", "vendor"],
  note: ["note", "notes", "memo", "comment"],
};

const normalizeHeader = (h: string): string => h.trim().toLowerCase();

/**
 * Pre-select a mapping by case-insensitive header matching so a Spendly-exported
 * CSV maps with zero clicks. When two headers tie on a synonym, the **first** is
 * chosen and the rest are left for the user to disambiguate. Unmatched fields →
 * `null` (the user maps them manually; `date`/`amount` are required downstream).
 */
export function suggestMapping(headers: string[]): ImportMapping {
  const normalized = headers.map(normalizeHeader);
  const taken = new Set<number>();
  const mapping = {} as ImportMapping;

  for (const field of IMPORT_FIELDS) {
    const synonyms = FIELD_SYNONYMS[field];
    let chosen: number | null = null;
    for (const syn of synonyms) {
      const idx = normalized.findIndex((h, i) => h === syn && !taken.has(i));
      if (idx !== -1) {
        chosen = idx;
        break;
      }
    }
    if (chosen !== null) taken.add(chosen);
    mapping[field] = chosen;
  }
  return mapping;
}

/**
 * Read each mapped Spendly field's raw cell from a row, by column index. An
 * unmapped field or an out-of-range index → `null` (an absent cell, which the
 * normalizer treats as missing → invalid for required fields).
 */
export function applyMapping(
  row: string[],
  mapping: ImportMapping
): Record<ImportFieldKey, string | null> {
  const out = {} as Record<ImportFieldKey, string | null>;
  for (const field of IMPORT_FIELDS) {
    const idx = mapping[field];
    out[field] = idx === null || idx < 0 || idx >= row.length ? null : row[idx];
  }
  return out;
}
