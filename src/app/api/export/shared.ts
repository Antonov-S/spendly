import { NextResponse } from "next/server";
import { EXPORT_MAX_TRANSACTIONS } from "@/lib/system-constants";

/**
 * HTTP glue shared by both export routes (data-export-spec §7.0). No Prisma, no
 * business logic — just the unified failure contract and small response shapers.
 */

/** The three pre-stream failure codes (§7.1.1). `rate_limited` is emitted by
 * `tooManyRequestsResponse`; the other two by `exportError`. */
export type ExportErrorCode = "unauthorized" | "rate_limited" | "too_large";

/**
 * The single structured-error surface for both routes (§7.1.1): `{ error, code }`
 * JSON, decided BEFORE any stream byte, so a half-written file can never carry an
 * error. Success bodies remain the raw file (CSV text / JSON envelope).
 */
export function exportError(
  status: number,
  error: string,
  code: ExportErrorCode
): NextResponse {
  return NextResponse.json(
    { error, code },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * The in-band CSV truncation notice (D8 / §7.2). A leading `#` keeps it out of
 * the data grid; the file stays a valid `200`, not an error.
 */
export const CSV_TRUNCATION_MARKER = `# Export truncated at ${EXPORT_MAX_TRANSACTIONS} transactions. Contact support for a full archive.\r\n`;

/** Response headers for a successful download stream (T2). */
export function downloadHeaders(
  contentType: string,
  filename: string
): HeadersInit {
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  };
}
