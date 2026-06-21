import { auth } from "@/auth";
import {
  checkRateLimit,
  tooManyRequestsResponse,
} from "@/lib/rate-limit";
import { buildExportEnvelope } from "@/lib/export/json";
import { exportFilename } from "@/lib/export/filename";
import { getFullExport } from "@/lib/db/export";
import { EXPORT_MAX_TRANSACTIONS } from "@/lib/system-constants";
import { downloadHeaders, exportError } from "../shared";

// Prisma + Web streams need Node; never cache a per-user financial download (T1).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/export/json?account=<cuid>
 *
 * Complete structured dump in a versioned envelope (data-export-spec §6). HTTP
 * glue only. NOT incremental: the dump is assembled whole, then enqueued as one
 * pretty-printed string — the ReadableStream is just a uniform response wrapper
 * (T3). Over the size cap → 413 (a partial-but-complete-looking backup is worse
 * than an explicit failure, D8). 401/429/413 are all decided before the first
 * byte via the unified failure contract (§7.1.1). No `requireOnboarded` — a
 * zero-account user gets a valid empty-arrays envelope (D7), not a redirect.
 *
 * JSON scoping is intentionally asymmetric (C2/§3.2): account-bound entities
 * follow `?account=`; budgets/goals/categories are always included in full.
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

  const data = await getFullExport(userId, accountId);

  // The fetcher takes cap+1 transactions; over the cap, fail explicitly (D8).
  if (data.transactions.length > EXPORT_MAX_TRANSACTIONS) {
    return exportError(
      413,
      "Export exceeds the maximum size. Contact support.",
      "too_large"
    );
  }

  const body = JSON.stringify(buildExportEnvelope(data), null, 2);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: downloadHeaders(
      "application/json; charset=utf-8",
      exportFilename("json")
    ),
  });
}
