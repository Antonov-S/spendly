"use client";

import { AlertTriangle, Info } from "lucide-react";
import type { ImportPreview as ImportPreviewData } from "@/types/import";

interface ImportPreviewProps {
  preview: ImportPreviewData;
}

/** Signed money for the sample table (2dp, EUR-only MVP). */
function money(amount: number | null): string {
  if (amount === null) return "—";
  const sign = amount < 0 ? "−" : "";
  return `${sign}€${Math.abs(amount).toFixed(2)}`;
}

interface CountProps {
  label: string;
  value: number;
  tone?: "default" | "good" | "muted";
}

function Count({ label, value, tone = "default" }: CountProps) {
  const valueClass =
    tone === "good"
      ? "text-success"
      : tone === "muted"
        ? "text-ink-2"
        : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
      <p className={`text-[18px] font-medium ${valueClass}`}>{value}</p>
      <p className="text-[11px] text-ink-2">{label}</p>
    </div>
  );
}

/**
 * The import preview (data-import-spec §8). Leads with the high-skip warning (T5)
 * when most rows won't import, then the currency notice (D2), the counts, a sample
 * table, and a capped issues list. Read-only — the write happens on Confirm.
 */
export function ImportPreview({ preview }: ImportPreviewProps) {
  return (
    <div className="flex flex-col gap-4">
      {preview.highSkip && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
          <p className="text-[12px] text-ink">
            Most rows won&apos;t be imported. Check your column mapping and date
            format before confirming.
          </p>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 p-3">
        <Info size={15} className="mt-0.5 shrink-0 text-ink-2" />
        <p className="text-[12px] text-ink-2">
          All imported transactions will use{" "}
          <span className="font-medium text-ink">{preview.accountName}</span>
          &apos;s currency ({preview.currency}); any currency in the file is
          ignored.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Count label="To import" value={preview.toCreate} tone="good" />
        <Count label="Duplicates" value={preview.duplicatesSkipped} tone="muted" />
        <Count label="Invalid" value={preview.invalidSkipped} tone="muted" />
        <Count label="Transfers" value={preview.transfersSkipped} tone="muted" />
        <Count label="New categories" value={preview.newCategories.length} />
      </div>

      {preview.sample.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-surface-2 text-[11px] text-ink-2">
              <tr>
                <th className="px-2.5 py-1.5 font-medium">Date</th>
                <th className="px-2.5 py-1.5 font-medium">Type</th>
                <th className="px-2.5 py-1.5 text-right font-medium">Amount</th>
                <th className="px-2.5 py-1.5 font-medium">Category</th>
                <th className="px-2.5 py-1.5 font-medium">Merchant</th>
              </tr>
            </thead>
            <tbody>
              {preview.sample.map((row) => (
                <tr
                  key={row.source}
                  className={`border-t border-line ${row.willCreate ? "" : "text-ink-3"}`}
                >
                  <td className="px-2.5 py-1.5">{row.date ?? "—"}</td>
                  <td className="px-2.5 py-1.5">{row.type ?? "—"}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">
                    {money(row.amount)}
                  </td>
                  <td className="px-2.5 py-1.5">{row.category ?? "—"}</td>
                  <td className="px-2.5 py-1.5">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate">{row.merchant ?? "—"}</span>
                      {!row.willCreate && (
                        <span className="rounded bg-surface-2 px-1 text-[10px] text-ink-3">
                          skip
                        </span>
                      )}
                      {row.truncated && (
                        <span className="rounded bg-surface-2 px-1 text-[10px] text-ink-3">
                          truncated
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview.issues.length > 0 && (
        <div className="rounded-lg border border-line bg-surface p-3">
          <p className="text-[12px] font-medium text-ink">
            Skipped rows ({preview.invalidSkipped + preview.transfersSkipped})
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {preview.issues.map((issue) => (
              <li key={issue.source} className="text-[11px] text-ink-2">
                Row {issue.source}: {issue.message}
              </li>
            ))}
          </ul>
          {preview.issuesTruncated && (
            <p className="mt-1.5 text-[11px] text-ink-3">
              …and more not shown.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
