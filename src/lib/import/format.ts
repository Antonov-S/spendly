import type { ImportFormat } from "@/types/import";

/**
 * Detect the import format from a filename's extension. Case-insensitive,
 * extension-only (the dropped/picked File always carries a name). Returns
 * null for anything that is not a recognized .csv / .json file so the caller
 * can reject it rather than guess.
 */
export function detectImportFormat(filename: string): ImportFormat | null {
  const lower = filename.toLowerCase().trim();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".json")) return "json";
  return null;
}
