"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Upload, CheckCircle2 } from "lucide-react";
import {
  CATEGORY_RESOLUTION_OPTIONS,
  type ImportDateFormat,
} from "@/lib/constants";
import { inspectCsv, previewImport, commitImport } from "@/actions/import";
import { ColumnMapper } from "@/components/import/column-mapper";
import { ImportPreview } from "@/components/import/import-preview";
import type {
  CategoryResolution,
  CsvInspection,
  DecimalSeparator,
  ImportFormat,
  ImportMapping,
  ImportOptions,
  ImportPreview as ImportPreviewData,
  ImportResult,
} from "@/types/import";

interface ImportFlowProps {
  accounts: { id: string; name: string }[];
  categoryCount: number;
}

type Step = "upload" | "configure" | "preview" | "done";

const EMPTY_MAPPING: ImportMapping = {
  date: null,
  amount: null,
  type: null,
  category: null,
  merchant: null,
  note: null,
};

const sectionClass = "rounded-xl border border-line bg-surface p-5";
const selectClass =
  "w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] text-ink focus:border-success/60 focus:outline-none";
const primaryBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-success px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-success/90 disabled:opacity-50";
const secondaryBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface-2 px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:border-success/50 disabled:opacity-50";

/**
 * The /import coordinator (data-import-spec §8). Stateless server side: the chosen
 * `File` is held in memory and re-sent on each call (inspect → preview → commit).
 * Flow: format toggle → upload → configure (CSV adds a column mapper) → preview →
 * confirm. Nothing is written until Confirm.
 */
export function ImportFlow({ accounts, categoryCount }: ImportFlowProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [format, setFormat] = useState<ImportFormat>("csv");
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>("upload");
  const [error, setError] = useState<string | null>(null);

  const [inspection, setInspection] = useState<CsvInspection | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>(EMPTY_MAPPING);
  const [dateFormat, setDateFormat] = useState<ImportDateFormat>("YYYY-MM-DD");
  const [decimal, setDecimal] = useState<DecimalSeparator | null>(null);

  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [categoryResolution, setCategoryResolution] =
    useState<CategoryResolution>("CREATE");
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  const [preview, setPreview] = useState<ImportPreviewData | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  function reset(nextFormat: ImportFormat = format) {
    setFormat(nextFormat);
    setFile(null);
    setStep("upload");
    setError(null);
    setInspection(null);
    setMapping(EMPTY_MAPPING);
    setDateFormat("YYYY-MM-DD");
    setDecimal(null);
    setCategoryResolution("CREATE");
    setSkipDuplicates(true);
    setPreview(null);
    setResult(null);
  }

  function formDataFor(f: File): FormData {
    const fd = new FormData();
    fd.append("file", f);
    return fd;
  }

  function buildOpts(): ImportOptions {
    return {
      format,
      accountId,
      categoryResolution,
      skipDuplicates,
      mapping: format === "csv" ? mapping : null,
      dateFormat: format === "csv" ? dateFormat : null,
      decimal: format === "csv" ? decimal : null,
    };
  }

  function handleFile(selected: File | null) {
    setError(null);
    setFile(selected);
    setPreview(null);
    setResult(null);
    if (!selected) {
      setStep("upload");
      return;
    }
    if (format === "json") {
      setStep("configure");
      return;
    }
    // CSV → inspect to seed the mapper.
    startTransition(async () => {
      const res = await inspectCsv(formDataFor(selected));
      if (res.success) {
        setInspection(res.data);
        setMapping(res.data.suggestedMapping);
        setDateFormat(res.data.dialect.dateFormat);
        setDecimal(res.data.dialect.decimal);
        setStep("configure");
      } else {
        setError(res.error);
      }
    });
  }

  function handlePreview() {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      const res = await previewImport(formDataFor(file), buildOpts());
      if (res.success) {
        setPreview(res.data);
        setStep("preview");
      } else {
        setError(res.error);
      }
    });
  }

  function handleConfirm() {
    if (!file || !preview) return;
    setError(null);
    startTransition(async () => {
      const res = await commitImport(
        formDataFor(file),
        buildOpts(),
        preview.toCreate
      );
      if (res.success) {
        setResult(res.data);
        setStep("done");
        toast.success(`Imported ${res.data.created} transactions`);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Format toggle */}
      <div className="flex gap-1.5">
        {(["csv", "json"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => reset(f)}
            className={`rounded-lg border px-3.5 py-1.5 text-[12px] font-medium transition-colors ${
              format === f
                ? "border-success/50 bg-success/10 text-success"
                : "border-line bg-surface-2 text-ink-2 hover:text-ink"
            }`}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Upload */}
      <section className={sectionClass}>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-surface-2 px-4 py-8 text-center transition-colors hover:border-success/50">
          <Upload size={20} className="text-ink-2" />
          <span className="text-[13px] font-medium text-ink">
            {file ? file.name : `Choose a ${format.toUpperCase()} file`}
          </span>
          <span className="text-[11px] text-ink-3">
            Up to 10 MB · {format === "csv" ? "any column layout" : "Spendly JSON export"}
          </span>
          <input
            type="file"
            accept={format === "csv" ? ".csv,text/csv" : ".json,application/json"}
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {error && step === "upload" && (
          <p className="mt-3 text-[12px] text-danger">{error}</p>
        )}
      </section>

      {/* Configure */}
      {step !== "upload" && step !== "done" && (
        <section className={`${sectionClass} flex flex-col gap-4`}>
          {format === "csv" && inspection && (
            <ColumnMapper
              headers={inspection.headers}
              mapping={mapping}
              onMappingChange={setMapping}
              dateFormat={dateFormat}
              onDateFormatChange={setDateFormat}
              decimal={decimal}
              onDecimalChange={setDecimal}
              dialect={inspection.dialect}
            />
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-2">Import into</span>
              <select
                className={selectClass}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-2">Unmatched categories</span>
              <select
                className={selectClass}
                value={categoryResolution}
                onChange={(e) =>
                  setCategoryResolution(e.target.value as CategoryResolution)
                }
              >
                {CATEGORY_RESOLUTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex items-center gap-2 text-[12px] text-ink">
            <input
              type="checkbox"
              checked={skipDuplicates}
              onChange={(e) => setSkipDuplicates(e.target.checked)}
              className="h-3.5 w-3.5 accent-success"
            />
            Skip rows already in this account
          </label>

          <p className="text-[11px] text-ink-3">
            {categoryCount} categories available for matching.
          </p>

          {error && (
            <p className="text-[12px] text-danger">{error}</p>
          )}

          {step === "configure" && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handlePreview}
                disabled={isPending || !accountId}
                className={primaryBtn}
              >
                {isPending ? "Reading…" : "Preview import"}
              </button>
            </div>
          )}
        </section>
      )}

      {/* Preview */}
      {step === "preview" && preview && (
        <section className={`${sectionClass} flex flex-col gap-4`}>
          <ImportPreview preview={preview} />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setStep("configure")}
              disabled={isPending}
              className={secondaryBtn}
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isPending || preview.toCreate === 0}
              className={primaryBtn}
            >
              {isPending
                ? "Importing…"
                : `Import ${preview.toCreate} transactions`}
            </button>
          </div>
        </section>
      )}

      {/* Done */}
      {step === "done" && result && (
        <section className={`${sectionClass} flex flex-col items-center gap-3 text-center`}>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
            <CheckCircle2 size={24} />
          </div>
          <div>
            <p className="text-[14px] font-medium text-ink">
              Imported {result.created} transaction
              {result.created === 1 ? "" : "s"}
            </p>
            <p className="mt-1 text-[12px] text-ink-2">
              {result.categoriesCreated > 0 &&
                `${result.categoriesCreated} new categories · `}
              {result.duplicatesSkipped} duplicates · {result.invalidSkipped}{" "}
              invalid · {result.transfersSkipped} transfers skipped
            </p>
            {result.divergedFromPreview && (
              <p className="mt-1 text-[11px] text-ink-3">
                The count differs from the preview — the account changed since you
                previewed.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => reset()} className={secondaryBtn}>
              Import another
            </button>
            <Link href="/transactions" className={primaryBtn}>
              View transactions
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
