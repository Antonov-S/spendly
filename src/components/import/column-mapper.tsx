"use client";

import {
  IMPORT_FIELDS,
  IMPORT_DATE_FORMATS,
  type ImportFieldKey,
  type ImportDateFormat,
} from "@/lib/constants";
import type {
  CsvDialect,
  DecimalSeparator,
  ImportMapping,
} from "@/types/import";

interface ColumnMapperProps {
  headers: string[];
  mapping: ImportMapping;
  onMappingChange: (mapping: ImportMapping) => void;
  dateFormat: ImportDateFormat;
  onDateFormatChange: (format: ImportDateFormat) => void;
  decimal: DecimalSeparator | null;
  onDecimalChange: (decimal: DecimalSeparator | null) => void;
  dialect: CsvDialect;
}

const FIELD_LABELS: Record<ImportFieldKey, string> = {
  date: "Date",
  amount: "Amount",
  type: "Type",
  category: "Category",
  merchant: "Merchant",
  note: "Note",
};

const REQUIRED: ImportFieldKey[] = ["date", "amount"];

const delimiterLabel = (d: string) =>
  d === "\t" ? "Tab" : d === ";" ? "Semicolon" : "Comma";

const selectClass =
  "w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] text-ink focus:border-success/60 focus:outline-none";

/**
 * CSV column mapper (data-import-spec §5.2 / T5). Each Spendly field maps to a
 * source column **by index** (so duplicate headers stay distinct: shown as
 * "Header (col N)"). Date format + decimal separator are seeded from the detected
 * dialect and overridable; the detected dialect is shown so the user can verify
 * auto-detection before previewing.
 */
export function ColumnMapper({
  headers,
  mapping,
  onMappingChange,
  dateFormat,
  onDateFormatChange,
  decimal,
  onDecimalChange,
  dialect,
}: ColumnMapperProps) {
  const setField = (field: ImportFieldKey, value: number | null) => {
    onMappingChange({ ...mapping, [field]: value });
  };

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-[12px] font-medium text-ink">Map your columns</p>
      <p className="mt-0.5 text-[11px] text-ink-3">
        Detected: {delimiterLabel(dialect.delimiter)} delimiter ·{" "}
        {dialect.decimal === "," ? "comma" : "dot"} decimal · {dialect.dateFormat}{" "}
        dates
      </p>

      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {IMPORT_FIELDS.map((field) => (
          <label key={field} className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-2">
              {FIELD_LABELS[field]}
              {REQUIRED.includes(field) && (
                <span className="text-danger"> *</span>
              )}
            </span>
            <select
              className={selectClass}
              value={mapping[field] ?? -1}
              onChange={(e) => {
                const v = Number(e.target.value);
                setField(field, v < 0 ? null : v);
              }}
            >
              <option value={-1}>— Not mapped —</option>
              {headers.map((h, i) => (
                <option key={i} value={i}>
                  {h || "(blank)"} (col {i + 1})
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2.5 border-t border-line pt-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-2">Date format</span>
          <select
            className={selectClass}
            value={dateFormat}
            onChange={(e) =>
              onDateFormatChange(e.target.value as ImportDateFormat)
            }
          >
            {IMPORT_DATE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-2">Decimal separator</span>
          <select
            className={selectClass}
            value={decimal ?? "auto"}
            onChange={(e) => {
              const v = e.target.value;
              onDecimalChange(v === "auto" ? null : (v as DecimalSeparator));
            }}
          >
            <option value="auto">Auto-detect</option>
            <option value=".">Dot (1,234.56)</option>
            <option value=",">Comma (1.234,56)</option>
          </select>
        </label>
      </div>
    </div>
  );
}
