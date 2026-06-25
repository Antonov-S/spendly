import { Download } from "lucide-react";

interface ExportLinksProps {
  /** The current topbar account scope; when set, the export is scoped to it. */
  accountId?: string;
}

/**
 * "Export CSV" / "Export JSON" download links for the Settings "Data & privacy"
 * section (data-export-spec §8). Plain `<a download>` GETs — a file download
 * can't be a Server Action. The current `?account=` scope is carried so the
 * export matches what the user sees; the server's `Content-Disposition` still
 * wins for the saved filename. Renders regardless of account count (empty export
 * is valid, D7). Host-agnostic: takes only `accountId`.
 *
 * On a wide column the two buttons spread to opposite ends (`sm:justify-between`)
 * so they don't clump at the left; on mobile they sit compact at the start.
 * Solid raised chips (`bg-surface-2` + shadow) so they read as buttons, not text.
 */
export function ExportLinks({ accountId }: ExportLinksProps) {
  const query = accountId ? `?account=${accountId}` : "";

  const linkClass =
    "flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3.5 py-2 text-[13px] font-medium text-ink shadow-sm transition-colors hover:border-success/50 hover:text-success";

  return (
    <div className="flex items-center gap-1.5 sm:justify-between">
      <a href={`/api/export/csv${query}`} download className={linkClass}>
        <Download size={15} />
        Export CSV
      </a>
      <a href={`/api/export/json${query}`} download className={linkClass}>
        <Download size={15} />
        Export JSON
      </a>
    </div>
  );
}
