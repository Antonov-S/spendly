import { NextResponse } from "next/server";
import { CSP_REPORT_MAX_BYTES } from "@/lib/system-constants";

// A browser posts violation reports without credentials; never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/csp-report
 *
 * Log-only sink for CSP violation reports (security-headers-spec §2). A
 * browser-initiated report can't be a Server Action, so this is one of the
 * render-cycle API exceptions — but it does no reads, no writes, and no auth
 * (browsers post reports uncredentialed).
 *
 * Contract: always return 204. Cap the body size, and tolerate a malformed or
 * empty body silently (a bad report must never 500 — that would just spam the
 * logs and tell an attacker the endpoint parses input).
 */
export async function POST(request: Request) {
  try {
    const body = await request.text();

    // Drop oversized bodies rather than parse them (unauthenticated abuse bound).
    if (body.length > 0 && body.length <= CSP_REPORT_MAX_BYTES) {
      logReport(body);
    }
  } catch {
    // Reading/parsing failed — swallow it; the response is 204 regardless.
  }

  return new NextResponse(null, { status: 204 });
}

/**
 * Parse the report envelope and log a compact one-line summary. The interesting
 * fields live under `csp-report` (the `application/csp-report` format); newer
 * `application/reports+json` batches are an array of `{ type, body }`. We handle
 * both shapes best-effort and log nothing beyond what the browser sent.
 */
function logReport(rawBody: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return; // Malformed JSON — nothing to log, no error.
  }

  for (const report of extractReports(parsed)) {
    // Kebab-case keys are the classic `application/csp-report` shape; camelCase
    // are the newer `reports+json` shape. Read either.
    console.warn(
      `[csp-report] ${JSON.stringify({
        blockedUri: report["blocked-uri"] ?? report["blockedURL"] ?? null,
        violatedDirective:
          report["violated-directive"] ??
          report["effective-directive"] ??
          report["effectiveDirective"] ??
          null,
        documentUri: report["document-uri"] ?? report["documentURL"] ?? null,
      })}`
    );
  }
}

type CspReportBody = Record<string, string | undefined>;

/** Normalize the two report envelopes to a flat list of report bodies. */
function extractReports(parsed: unknown): CspReportBody[] {
  if (!parsed || typeof parsed !== "object") return [];

  // application/csp-report: { "csp-report": { ... } }
  const single = (parsed as Record<string, unknown>)["csp-report"];
  if (single && typeof single === "object") {
    return [single as CspReportBody];
  }

  // application/reports+json: [{ type: "csp-violation", body: { ... } }, ...]
  if (Array.isArray(parsed)) {
    return parsed
      .map((entry) =>
        entry && typeof entry === "object"
          ? ((entry as Record<string, unknown>).body as CspReportBody | undefined)
          : undefined
      )
      .filter((body): body is CspReportBody => !!body);
  }

  return [];
}
