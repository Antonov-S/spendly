import { EXPORT_CSV_COLUMNS } from "@/lib/constants";
import type { ExportTransactionRow } from "@/types/export";

/**
 * Pure CSV helpers for the data-export slice (data-export-spec §5). No Prisma, no
 * HTTP, no streams — string transforms only, so they're byte-for-byte testable.
 * The UTF-8 BOM is added by the route stream, not here (§5.1): `transactionsToCsv`
 * returns clean text.
 *
 * `escapeCsvField` / `escapeCsvTextField` / `csvRow` are generic — only
 * `transactionsToCsv` knows about transactions. Promote them to `src/lib/csv.ts`
 * unchanged if a second CSV surface ever appears (§5.2).
 */

/** The header line: the column names joined with commas (no terminator). */
export const EXPORT_CSV_HEADER = EXPORT_CSV_COLUMNS.join(",");

const RECORD_SEPARATOR = "\r\n";

/** Leading characters a spreadsheet may interpret as a formula (§5.2). */
const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

/** True when a field needs RFC-4180 quoting (contains comma, quote, CR, or LF). */
function needsQuoting(value: string): boolean {
  return (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\r") ||
    value.includes("\n")
  );
}

/** Wrap in double quotes with embedded quotes doubled, only when required. */
function rfc4180(value: string): string {
  if (!needsQuoting(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * RFC-4180 escaping ONLY (data-export-spec §5.1). Null/undefined/empty → empty
 * field (never the string "null"); numbers → their string form. Deliberately
 * does NOT formula-neutralize: the controlled columns (Date, Amount, Type) use
 * this, and `Amount` relies on a leading `-` surviving.
 */
export function escapeCsvField(
  value: string | number | null | undefined
): string {
  if (value === null || value === undefined) return "";
  return rfc4180(String(value));
}

/**
 * Formula-injection neutralization THEN RFC-4180 quoting (§5.2). When the first
 * character is one of `= + - @ \t \r`, a single quote is prefixed so Excel/Sheets
 * treat the cell as text. Used for the free-text columns (Category, Account,
 * Merchant, Note) — the only attacker-influenced fields.
 */
export function escapeCsvTextField(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const neutralized = FORMULA_TRIGGERS.includes(value[0]) ? `'${value}` : value;
  return rfc4180(neutralized);
}

/**
 * Join already-escaped values into a CSV record, comma-separated, terminated
 * with `\r\n`. The caller is responsible for escaping each value with the
 * appropriate helper.
 */
export function csvRow(values: string[]): string {
  return values.join(",") + RECORD_SEPARATOR;
}

/**
 * Render one transaction as a CSV record (escaped fields + CRLF). The single
 * authority for the per-column escaper pairing (§5.2): Date/Amount/Type use
 * `escapeCsvField`; the four free-text columns use `escapeCsvTextField`. Both
 * `transactionsToCsv` and the route's incremental stream go through here so the
 * mapping can never drift.
 */
export function transactionToCsvRow(row: ExportTransactionRow): string {
  return csvRow([
    escapeCsvField(row.date),
    escapeCsvField(row.amount),
    escapeCsvField(row.type),
    escapeCsvTextField(row.category),
    escapeCsvTextField(row.account),
    escapeCsvTextField(row.merchant),
    escapeCsvTextField(row.note),
  ]);
}

/**
 * Render the transaction rows as CSV text (header + one record per row). No BOM
 * (the route prepends it).
 */
export function transactionsToCsv(rows: ExportTransactionRow[]): string {
  let out = EXPORT_CSV_HEADER + RECORD_SEPARATOR;
  for (const row of rows) {
    out += transactionToCsvRow(row);
  }
  return out;
}
