import { auth } from "@/auth";
import {
  checkRateLimit,
  tooManyRequestsResponse,
} from "@/lib/rate-limit";
import {
  EXPORT_CSV_HEADER,
  transactionToCsvRow,
} from "@/lib/export/csv";
import { exportFilename } from "@/lib/export/filename";
import { getTransactionsForExport } from "@/lib/db/export";
import { EXPORT_CSV_EXCEL_HINT } from "@/lib/constants";
import { EXPORT_MAX_TRANSACTIONS } from "@/lib/system-constants";
import {
  CSV_TRUNCATION_MARKER,
  downloadHeaders,
  exportError,
} from "../shared";

// Prisma + Web streams need Node; never cache a per-user financial download (T1).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// UTF-8 BOM so Excel detects UTF-8 (€, accented merchants) — §5.1.
const BOM = String.fromCharCode(0xfeff);

/**
 * GET /api/export/csv?account=<cuid>
 *
 * Flat transaction ledger (data-export-spec §5). HTTP/stream glue only — auth,
 * rate-limit, scope, then feed the pure helpers into a ReadableStream. Streams
 * incrementally (T3): BOM → Excel `sep=,` hint → header → one record per row.
 * The `sep=,` line makes Excel split columns on double-click (otherwise
 * European-locale Excel uses `;` and shows one cell). Over the size cap the
 * stream still returns 200 with a `#` marker row (D8); 401/429 are decided
 * before the first byte (§7.1.1). No `requireOnboarded` — a zero-account user
 * gets a valid empty file (D7), not a redirect.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return exportError(401, "Unauthorized", "unauthorized");
  }
  const userId = session.user.id;

  const { success, retryAfterSeconds } = await checkRateLimit("export", userId);
  if (!success) {
    return tooManyRequestsResponse(retryAfterSeconds);
  }

  const accountId =
    new URL(request.url).searchParams.get("account") || undefined;

  // Fetcher takes cap+1 so overflow is detectable (D8).
  const rows = await getTransactionsForExport(userId, accountId);
  const truncated = rows.length > EXPORT_MAX_TRANSACTIONS;
  const dataRows = truncated ? rows.slice(0, EXPORT_MAX_TRANSACTIONS) : rows;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          BOM + EXPORT_CSV_EXCEL_HINT + "\r\n" + EXPORT_CSV_HEADER + "\r\n"
        )
      );
      for (const row of dataRows) {
        controller.enqueue(encoder.encode(transactionToCsvRow(row)));
      }
      if (truncated) {
        controller.enqueue(encoder.encode(CSV_TRUNCATION_MARKER));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: downloadHeaders("text/csv; charset=utf-8", exportFilename("csv")),
  });
}
