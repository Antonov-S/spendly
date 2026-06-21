import { EXPORT_FILENAME_PREFIX } from "@/lib/system-constants";

/** Zero-pad a month/day number to two digits. */
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * The download filename stem + extension: `spendly-export-YYYY-MM-DD.<ext>`
 * (data-export-spec §7.1). The date uses UTC components (D3) so the name is
 * stable regardless of server timezone. Pure; `now` is injectable for tests.
 */
export function exportFilename(kind: "csv" | "json", now: Date = new Date()): string {
  const date = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(
    now.getUTCDate()
  )}`;
  return `${EXPORT_FILENAME_PREFIX}-${date}.${kind}`;
}
