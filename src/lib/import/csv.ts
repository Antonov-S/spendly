import { IMPORT_MAX_CELL_CHARS } from "@/lib/system-constants";
import { IMPORT_DATE_FORMATS, type ImportDateFormat } from "@/lib/constants";
import type { CsvDialect, DecimalSeparator } from "@/types/import";

/**
 * Pure, dependency-free CSV parsing for the import slice (data-import-spec §5.1) —
 * the inverse of `src/lib/export/csv.ts`. String transforms only: no Prisma, no
 * HTTP, fully unit-testable. A single-pass RFC-4180 state machine plus dialect
 * heuristics (delimiter / decimal separator / date format) for the inspection step.
 */

const BOM = "﻿";

/** Candidate delimiters, most-common first; used for auto-detection. */
const DELIMITERS = [",", ";", "\t"] as const;

/**
 * Strip a leading UTF-8 BOM and an optional `sep=,` / `sep=;` hint line (the
 * export writes one) so the first surviving line is the real header. Idempotent.
 */
export function stripBomAndSepHint(text: string): string {
  let out = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  // A `sep=X` hint occupies the whole first line; drop it (and its line ending).
  const sepMatch = /^sep=.\r?\n/i.exec(out);
  if (sepMatch) out = out.slice(sepMatch[0].length);
  return out;
}

/**
 * Detect the delimiter from the header line by counting unquoted candidate
 * characters. Defaults to comma (the export's own) on a tie or no signal.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = new Map<string, number>();
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (DELIMITERS as readonly string[]).includes(ch)) {
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
  }
  let best = ",";
  let bestCount = 0;
  for (const d of DELIMITERS) {
    const c = counts.get(d) ?? 0;
    if (c > bestCount) {
      best = d;
      bestCount = c;
    }
  }
  return best;
}

/**
 * RFC-4180 state machine → rows of string cells. Handles quoted fields (embedded
 * delimiter / CR / LF / `""` escape), `\r\n` and `\n` endings, and a trailing
 * newline without emitting a phantom row. Each field is hard-truncated at
 * `maxCellChars` as it accumulates — counting embedded newlines of a quoted
 * multi-line field — so a never-closed quote can't grow an unbounded cell (S7).
 * Ragged rows are preserved (never silently shifted); blank lines are dropped.
 */
export function parseCsv(
  text: string,
  delimiter: string = ",",
  maxCellChars: number = IMPORT_MAX_CELL_CHARS
): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false; // distinguishes "" cell from no cell yet

  const appendChar = (ch: string) => {
    fieldStarted = true;
    if (field.length < maxCellChars) field += ch;
  };
  const endField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    // Drop a wholly-blank physical line (a single empty cell, no real content).
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          appendChar('"');
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      appendChar(c);
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      fieldStarted = true;
      i++;
      continue;
    }
    if (c === delimiter) {
      endField();
      i++;
      continue;
    }
    if (c === "\r") {
      endRow();
      i += text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (c === "\n") {
      endRow();
      i++;
      continue;
    }
    appendChar(c);
    i++;
  }
  // Flush a final unterminated field/row (file not ending in a newline).
  if (fieldStarted || field !== "" || row.length > 0) {
    endRow();
  }
  return rows;
}

/**
 * Column-level decimal-separator guess from sampled amount cells: the separator
 * that appears *last* in each value is its decimal point. Majority wins; defaults
 * to `.` on no signal (data-import-spec §5.4).
 */
export function detectDecimal(samples: string[]): DecimalSeparator {
  let dot = 0;
  let comma = 0;
  for (const raw of samples) {
    const s = raw ?? "";
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastComma > lastDot) comma++;
    else if (lastDot > lastComma) dot++;
  }
  return comma > dot ? "," : ".";
}

/**
 * Column-level date-format guess from sampled date cells (data-import-spec §5.3).
 * **Majority vote**, not all-or-nothing: each sample is classified as ISO, dotted,
 * or slashed, and the most common wins — so a single junk/blank cell can't poison
 * detection (mirrors the tolerant decimal vote). Slashed resolves to `DD/MM/YYYY`
 * when any slashed value's first component is > 12, else `MM/DD/YYYY`. Defaults to
 * ISO on no signal; the user can always override in the mapper.
 */
export function detectDateFormat(samples: string[]): ImportDateFormat {
  const values = samples.map((s) => (s ?? "").trim()).filter(Boolean);
  let iso = 0;
  let dotted = 0;
  let slashed = 0;
  let forcesDayFirst = false;

  for (const v of values) {
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(v)) {
      iso++;
    } else if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(v)) {
      dotted++;
    } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) {
      slashed++;
      if (Number(v.split("/")[0]) > 12) forcesDayFirst = true;
    }
  }

  if (iso === 0 && dotted === 0 && slashed === 0) return "YYYY-MM-DD";
  if (dotted >= iso && dotted >= slashed) return "DD.MM.YYYY";
  if (slashed >= iso && slashed >= dotted) {
    return forcesDayFirst ? "DD/MM/YYYY" : "MM/DD/YYYY";
  }
  return "YYYY-MM-DD";
}

/** Pull column `index` from each data row (missing → "") for dialect sampling. */
function sampleColumn(rows: string[][], index: number | null): string[] {
  if (index === null || index < 0) return [];
  return rows.map((r) => r[index] ?? "");
}

/**
 * Build the auto-detected dialect from the parsed grid and the suggested mapping
 * (T5). Delimiter is supplied (it was needed to parse); decimal + date format are
 * sampled from the mapped amount / date columns.
 */
export function detectDialect(
  dataRows: string[][],
  delimiter: string,
  amountIndex: number | null,
  dateIndex: number | null
): CsvDialect {
  const dateFormat = detectDateFormat(sampleColumn(dataRows, dateIndex));
  const decimal = detectDecimal(sampleColumn(dataRows, amountIndex));
  // Keep the date format inside the whitelist (defensive — detect* already do).
  const safeFormat: ImportDateFormat = (
    IMPORT_DATE_FORMATS as readonly string[]
  ).includes(dateFormat)
    ? dateFormat
    : "YYYY-MM-DD";
  return { delimiter, decimal, dateFormat: safeFormat };
}
