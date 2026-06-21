import { Download } from "lucide-react";

interface ExportLinksProps {
  /** The current topbar account scope; when set, the export is scoped to it. */
  accountId?: string;
}

/**
 * "Export CSV" / "Export JSON" download links for the Settings "Your data"
 * section (data-export-spec §8). Plain `<a download>` GETs — a file download
 * can't be a Server Action. The current `?account=` scope is carried so the
 * export matches what the user sees; the server's `Content-Disposition` still
 * wins for the saved filename. Renders regardless of account count (empty export
 * is valid, D7). Host-agnostic: takes only `accountId`.
 */
export function ExportLinks({ accountId }: ExportLinksProps) {
  const query = accountId ? `?account=${accountId}` : "";

  return (
    <div className="flex items-center gap-1.5">
      <a
        href={`/api/export/csv${query}`}
        download
        className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface hover:text-ink"
      >
        <Download size={15} />
        Export CSV
      </a>
      <a
        href={`/api/export/json${query}`}
        download
        className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface hover:text-ink"
      >
        <Download size={15} />
        Export JSON
      </a>
    </div>
  );
}
