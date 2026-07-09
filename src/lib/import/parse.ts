import {
  MERCHANT_MAX,
  NOTE_MAX,
  CATEGORY_NAME_MAX,
  SPLIT_NOTE_MAX,
  TAG_MAX_PER_TRANSACTION,
  TAG_NAME_MAX,
} from "@/lib/system-constants";
import { normalizeLabelKey } from "@/lib/text";
import type { ImportFieldKey, ImportDateFormat } from "@/lib/constants";
import { applyMapping } from "@/lib/import/mapping";
import type {
  DecimalSeparator,
  ImportMapping,
  NormalizedImportRow,
} from "@/types/import";
import type { TransactionTypeValue } from "@/types/transactions";

/**
 * Pure value parsers + the two row normalizers (data-import-spec §3.3, §5.3–§5.5).
 * Everything here is string/shape transforms — no Prisma, no auth. The CSV and
 * JSON fronts both converge on `NormalizedImportRow`.
 */

const pad = (n: number): string => String(n).padStart(2, "0");

/** A parsed amount: a positive magnitude plus whether the source read negative. */
interface ParsedAmount {
  magnitude: number;
  negative: boolean;
}

/**
 * Normalize a whitelisted date string to `YYYY-MM-DD`, or `null` if it doesn't
 * match `format` or isn't a real calendar date (rejects 02/30). No timezone math
 * — the result is fed to `dateInputToUtc` at write (D3).
 */
export function parseDateFlexible(
  value: string | null | undefined,
  format: ImportDateFormat
): string | null {
  if (value == null) return null;
  const s = value.trim();
  if (s === "") return null;

  let y: number;
  let m: number;
  let d: number;
  switch (format) {
    case "YYYY-MM-DD": {
      const mt = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
      if (!mt) return null;
      [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
      break;
    }
    case "MM/DD/YYYY": {
      const mt = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
      if (!mt) return null;
      [m, d, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
      break;
    }
    case "DD/MM/YYYY": {
      const mt = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
      if (!mt) return null;
      [d, m, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
      break;
    }
    case "DD.MM.YYYY": {
      const mt = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
      if (!mt) return null;
      [d, m, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
      break;
    }
    default:
      return null;
  }

  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Per-value decimal guess when no column override: the last separator is decimal. */
function decimalForValue(s: string): DecimalSeparator {
  return s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
}

/**
 * Parse a messy amount into a positive magnitude + sign flag (data-import-spec
 * §5.4). Strips currency symbols / spaces; honors a decimal-separator override
 * (`.`/`,`) for European files; leading `-` or `(123)` → negative. Non-numeric →
 * `null`.
 */
export function parseAmount(
  value: string | null | undefined,
  decimal: DecimalSeparator | null
): ParsedAmount | null {
  if (value == null) return null;
  let s = value.trim();
  if (s === "") return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  // Strip currency symbols and all whitespace.
  s = s.replace(/[€$£\s]/g, "");
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (s === "") return null;

  const dec = decimal ?? decimalForValue(s);
  if (dec === ",") {
    s = s.replace(/\./g, ""); // dots are thousands
    s = s.replace(",", "."); // comma is the decimal
  } else {
    s = s.replace(/,/g, ""); // commas are thousands
  }

  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const num = Number(s);
  if (!Number.isFinite(num)) return null;
  return { magnitude: Math.abs(num), negative };
}

/**
 * Resolve the transaction type (data-import-spec §5.5). A mapped type cell maps
 * case-insensitively to the enum (unknown token → `null` → invalid). With no type
 * cell, derive from the amount sign: negative → EXPENSE, positive → INCOME.
 * TRANSFER is preserved here and skipped downstream (D1).
 */
export function resolveType(
  typeText: string | null | undefined,
  negative: boolean
): TransactionTypeValue | null {
  if (typeText != null && typeText.trim() !== "") {
    const t = typeText.trim().toUpperCase();
    if (t === "INCOME") return "INCOME";
    if (t === "EXPENSE") return "EXPENSE";
    if (t === "TRANSFER") return "TRANSFER";
    return null;
  }
  return negative ? "EXPENSE" : "INCOME";
}

/** A normalized text field plus whether it was truncated to its cap (D9). */
interface NormalizedText {
  value: string | null;
  truncated: boolean;
}

/**
 * D9 text rule: trim; empty/whitespace-only → null. When `truncate`, an
 * over-`max` value is cut to `max` and flagged; when not (category text), an
 * over-`max` value falls back to null (never a truncated category name).
 */
function normalizeText(
  raw: string | null | undefined,
  max: number,
  truncate: boolean
): NormalizedText {
  if (raw == null) return { value: null, truncated: false };
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null, truncated: false };
  if (trimmed.length <= max) return { value: trimmed, truncated: false };
  return truncate
    ? { value: trimmed.slice(0, max), truncated: true }
    : { value: null, truncated: false };
}

/** Normalize a CSV row's mapped cells into the shared `NormalizedImportRow` (§3.3). */
export function normalizeCsvRow(
  rawCols: string[],
  mapping: ImportMapping,
  dateFormat: ImportDateFormat,
  decimal: DecimalSeparator | null,
  source: number
): NormalizedImportRow {
  const cells: Record<ImportFieldKey, string | null> = applyMapping(
    rawCols,
    mapping
  );
  const amt = parseAmount(cells.amount, decimal);
  const type = resolveType(cells.type, amt?.negative ?? false);
  const merchant = normalizeText(cells.merchant, MERCHANT_MAX, true);
  const note = normalizeText(cells.note, NOTE_MAX, true);
  const category = normalizeText(cells.category, CATEGORY_NAME_MAX, false);

  return {
    source,
    date: parseDateFlexible(cells.date, dateFormat),
    amount: amt ? amt.magnitude : null,
    type,
    categoryText: category.value,
    merchant: merchant.value,
    note: note.value,
    merchantTruncated: merchant.truncated,
    noteTruncated: note.truncated,
    splits: [],
    splitPayloadMalformed: false,
    tags: [],
  };
}

/**
 * A JSON export transaction object (the subset import reads). Fields are `unknown`
 * because the envelope is validated leniently (T3 forward-compat) and each row is
 * coerced defensively here, so a malformed field nulls out → invalid row (D5)
 * rather than throwing.
 */
export interface JsonImportTransaction {
  date?: unknown;
  amount?: unknown;
  type?: unknown;
  category?: unknown;
  merchant?: unknown;
  note?: unknown;
  splits?: unknown;
  tags?: unknown;
}

const asText = (v: unknown): string | null => (typeof v === "string" ? v : null);
const asTrimmedText = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
};

function normalizeSplitEntries(
  raw: unknown,
  hasPayload: boolean
): Pick<NormalizedImportRow, "splits" | "splitPayloadMalformed"> {
  if (!Array.isArray(raw)) {
    return {
      splits: [],
      splitPayloadMalformed: hasPayload && raw !== undefined,
    };
  }
  const splits: NormalizedImportRow["splits"] = [];

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const obj = entry as Record<string, unknown>;
    if (typeof obj.amount !== "number" || !Number.isFinite(obj.amount)) continue;
    if (obj.amount <= 0) continue;

    const category = normalizeText(asText(obj.category), CATEGORY_NAME_MAX, false);
    const note = normalizeText(asText(obj.note), SPLIT_NOTE_MAX, true);
    splits.push({
      category: category.value,
      categoryId: asTrimmedText(obj.categoryId),
      amount: obj.amount,
      note: note.value,
    });
  }

  return {
    splits,
    splitPayloadMalformed: raw.length > 0 && splits.length === 0,
  };
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const value of raw) {
    if (typeof value !== "string") continue;
    const display = value.trim();
    if (display === "" || display.length > TAG_NAME_MAX) continue;
    const key = normalizeLabelKey(display);
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(display);
    if (tags.length >= TAG_MAX_PER_TRANSACTION) break;
  }

  return tags;
}

/**
 * Map a Spendly-JSON export row straight through the same D9 text pass (§3.3).
 * `date` is already `YYYY-MM-DD`; `amount` is signed → magnitude + keep `type`;
 * `account` and `transferPairId` are ignored (C1, D1).
 */
export function normalizeJsonRow(
  row: JsonImportTransaction,
  source: number
): NormalizedImportRow {
  const merchant = normalizeText(asText(row.merchant), MERCHANT_MAX, true);
  const note = normalizeText(asText(row.note), NOTE_MAX, true);
  const category = normalizeText(asText(row.category), CATEGORY_NAME_MAX, false);
  const splitPayload = normalizeSplitEntries(
    row.splits,
    Object.prototype.hasOwnProperty.call(row, "splits")
  );

  const magnitude =
    typeof row.amount === "number" && Number.isFinite(row.amount)
      ? Math.abs(row.amount)
      : null;
  const t = typeof row.type === "string" ? row.type.trim().toUpperCase() : "";
  const type: TransactionTypeValue | null =
    t === "INCOME" || t === "EXPENSE" || t === "TRANSFER" ? t : null;
  const dateText = asText(row.date)?.trim() ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? dateText : null;

  return {
    source,
    date,
    amount: magnitude,
    type,
    categoryText: category.value,
    merchant: merchant.value,
    note: note.value,
    merchantTruncated: merchant.truncated,
    noteTruncated: note.truncated,
    splits: splitPayload.splits,
    splitPayloadMalformed: splitPayload.splitPayloadMalformed,
    tags: normalizeTags(row.tags),
  };
}
