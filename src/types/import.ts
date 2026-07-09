/**
 * Types for the Data Import feature (data-import-spec). The pipeline both formats
 * funnel through is: CSV → parseCsv → applyMapping → normalizeCsvRow ─┐
 *                     JSON → parseEnvelope → normalizeJsonRow ─────────┴→
 *                     NormalizedImportRow[] → resolve → dedup → (preview | write)
 */
import type { TransactionTypeValue } from "@/types/transactions";
import type { ImportFieldKey, ImportDateFormat } from "@/lib/constants";

/**
 * Standard Server-Action result wrapper (data-import-spec S1) — never throws, no
 * 401/redirect. Declared here (a pure type module) rather than re-exported from
 * the `"use server"` action file, where a `export type` becomes a runtime binding.
 */
export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/** Source format of an import. */
export type ImportFormat = "csv" | "json";

/** Category-resolution policy for unmatched, non-empty category text (C2). */
export type CategoryResolution = "CREATE" | "UNCATEGORIZED";

/** Decimal separator for CSV amount parsing (`null` → auto-detect). */
export type DecimalSeparator = "." | ",";

/**
 * Distinct structural-failure kinds (D5). Each maps to its own specific message
 * so the UI and tests can branch — a valid-but-empty file is a friendlier story
 * than an unreadable one.
 */
export type ImportStructuralError =
  | "empty" // zero-byte / header-only / transactions: []
  | "unreadable" // no parseable header / invalid JSON syntax
  | "too_large" // over IMPORT_MAX_ROWS
  | "bad_envelope"; // unknown/higher schemaVersion or invalid shape

/** Auto-detected CSV dialect — shown for verification + seeds the mapper (T5). */
export interface CsvDialect {
  delimiter: string; // "," | ";" | "\t"
  decimal: DecimalSeparator;
  dateFormat: ImportDateFormat;
}

/**
 * Column mapping for a CSV: each Spendly field → the 0-based source column index
 * it reads from, or `null` when unmapped. Mapping is by INDEX (never header name)
 * so duplicate headers are unambiguous (§5.2).
 */
export type ImportMapping = Record<ImportFieldKey, number | null>;

/** Options carried through preview/commit (both formats). */
export interface ImportOptions {
  format: ImportFormat;
  /** Target account — verified owned + active server-side (C1). */
  accountId: string;
  /** Unmatched-category policy (C2). */
  categoryResolution: CategoryResolution;
  /** "Skip rows already in this account" (D4); default true. */
  skipDuplicates: boolean;
  /** CSV only: 0-based column index mapping (`null` for JSON). */
  mapping: ImportMapping | null;
  /** CSV only: chosen date format (`null` for JSON). */
  dateFormat: ImportDateFormat | null;
  /** CSV only: decimal separator override (`null` → auto). */
  decimal: DecimalSeparator | null;
}

/** Result of inspecting a CSV — drives the mapping UI (§3.2). */
export interface CsvInspection {
  headers: string[];
  sampleRows: string[][];
  suggestedMapping: ImportMapping;
  dataRowCount: number;
  dialect: CsvDialect;
}

/**
 * The convergence point — one normalized row, identical for CSV and JSON (§3.1).
 * A row with any required field `null` (`date`/`amount`/`type`) is invalid (D5);
 * a `type === "TRANSFER"` row is transfer-skipped (D1).
 */
export interface NormalizedImportRow {
  /** Original 1-based line/element index, for issue reporting. */
  source: number;
  /** "YYYY-MM-DD" (D3) — already normalized; null if unparseable. */
  date: string | null;
  /** Positive magnitude; sign applied at write from `type` (D2). null if unparseable. */
  amount: number | null;
  type: TransactionTypeValue | null;
  /** Raw (trimmed) category text from the file, resolved later (C2). */
  categoryText: string | null;
  merchant: string | null;
  note: string | null;
  /** D9 truncation flags surfaced in the preview ("merchant/note truncated"). */
  merchantTruncated: boolean;
  noteTruncated: boolean;
  /** JSON-only split payload after defensive coercion; CSV rows use []. */
  splits: NormalizedImportSplit[];
  /** JSON-only: true when a present split payload could not yield any readable lines. */
  splitPayloadMalformed: boolean;
  /** JSON-only tag names after defensive coercion; CSV rows use []. */
  tags: string[];
}

export interface NormalizedImportSplit {
  category: string | null;
  categoryId: string | null;
  amount: number;
  note: string | null;
}

/**
 * A surviving row with its category resolved (§7.1). `amount` stays the positive
 * magnitude; the signed stored value is derived from `type` at write + dedup.
 */
export interface ResolvedRow {
  source: number;
  date: string;
  amount: number;
  type: "INCOME" | "EXPENSE";
  merchant: string | null;
  note: string | null;
  /** Existing matched category id, or null (uncategorized / to-be-created). */
  categoryId: string | null;
  /** Display name of a category to create (CREATE policy), else null. */
  createCategoryName: string | null;
  /** Accepted split lines; non-empty means parent categoryId is nulled at write. */
  splits: ResolvedImportSplit[];
  /** Existing tag ids resolved before tag creation. */
  tagIds: string[];
  /** Tag names to create, first-seen casing preserved. */
  createTagNames: string[];
}

export interface ResolvedImportSplit {
  categoryId: string | null;
  createCategoryName: string | null;
  amount: number;
  note: string | null;
}

export interface ImportTagRegistryEntry {
  name: string;
  color: string | null;
}

/** Why a row will not be created. */
export type ImportIssueKind = "invalid" | "transfer" | "split";

export interface ImportIssue {
  source: number; // 1-based row index
  kind: ImportIssueKind;
  message: string;
}

/** A sample row shown in the preview (normalized + resolved category label). */
export interface PreviewRow {
  source: number;
  date: string | null;
  /** Signed for display (EXPENSE negative). */
  amount: number | null;
  type: TransactionTypeValue | null;
  /** Resolved display label, "+ {name}" for a to-be-created category, or null. */
  category: string | null;
  merchant: string | null;
  note: string | null;
  willCreate: boolean;
  /** merchant or note was truncated (D9). */
  truncated: boolean;
  /** Number of transaction tags to link. */
  tagCount: number;
}

/** Dry-run preview (D6) — exactly what commit will do, without writing. */
export interface ImportPreview {
  totalRows: number;
  toCreate: number;
  duplicatesSkipped: number;
  invalidSkipped: number;
  transfersSkipped: number;
  /** Names that would be created under the CREATE policy. */
  newCategories: string[];
  /** Rows that will be created with split children. */
  splitTransactions: number;
  /** Distinct tag names that will be linked. */
  tagsToLink: number;
  /** Tag names that would be created before linking. */
  newTags: string[];
  sample: PreviewRow[];
  issues: ImportIssue[];
  /** Total issue count before UI capping. */
  issueCount: number;
  /** More issues existed than `IMPORT_MAX_ISSUES`. */
  issuesTruncated: boolean;
  /** Skipped share ≥ IMPORT_HIGH_SKIP_RATIO (T5). */
  highSkip: boolean;
  /** Currency notice payload — the target account's currency (D2). */
  currency: string;
  accountName: string;
}

/** Commit result (D6/D7). */
export interface ImportResult {
  created: number;
  categoriesCreated: number;
  tagsCreated: number;
  duplicatesSkipped: number;
  invalidSkipped: number;
  transfersSkipped: number;
  /** Actual created count differed from the preview's `expectedCreate` (D6). */
  divergedFromPreview: boolean;
}
