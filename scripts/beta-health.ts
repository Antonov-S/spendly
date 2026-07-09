import "dotenv/config";

import { buildBetaHealthReport } from "../src/lib/analytics/beta-health";
import type { ReviewEventRow } from "../src/lib/analytics/review-metrics";
import { prisma } from "../src/lib/prisma";
import {
  ANALYTICS_RETENTION_DAYS,
  BETA_HEALTH_WINDOW_DAYS,
} from "../src/lib/system-constants";
import { looksProduction, parseHost } from "./db-env";

function argValue(name: string): string | null {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function parseDays(): number {
  const raw = argValue("days");
  if (!raw) return BETA_HEALTH_WINDOW_DAYS;
  const value = Number(raw);
  if (
    !Number.isInteger(value) ||
    value <= 0 ||
    value > ANALYTICS_RETENTION_DAYS
  ) {
    throw new Error(
      `--days must be an integer from 1 to ${ANALYTICS_RETENTION_DAYS}`
    );
  }
  return value;
}

function asProps(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function pct(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

async function main() {
  const days = parseDays();
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const host = parseHost(process.env.DATABASE_URL);
  const isProductionLike = looksProduction(host);

  console.log("Beta health report");
  console.log(`Target DB host:  ${host}`);
  console.log(
    `Environment:     ${isProductionLike ? "PRODUCTION (or unknown)" : "development"}`
  );
  console.log("Mode:            read-only");
  console.log(`Window:          ${from.toISOString()} -> ${to.toISOString()}`);
  console.log(`Requested days:  ${days}`);

  const [rows, latestEvent, totalUsers, proUsers, operatorFlagged, optedOut] =
    await Promise.all([
      prisma.analyticsEvent.findMany({
        where: { createdAt: { gte: from, lt: to } },
        select: { name: true, props: true, userId: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.analyticsEvent.findFirst({
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.count(),
      prisma.user.count({ where: { isPro: true } }),
      prisma.user.count({
        where: { isPro: true, stripeSubscriptionId: null },
      }),
      prisma.user.count({ where: { analyticsOptOut: true } }),
    ]);

  const events: ReviewEventRow[] = rows.map((row) => ({
    name: row.name,
    props: asProps(row.props),
    userId: row.userId,
    createdAt: row.createdAt,
  }));
  const report = buildBetaHealthReport(events);

  console.log("\nStream summary");
  console.table([
    {
      "Latest event (all time)":
        latestEvent?.createdAt.toISOString() ?? "none",
      "Latest event (window)":
        report.latestWindowEventAt?.toISOString() ?? "none",
      "Window events": report.totalEvents,
      "Active users": report.activeUsers,
      "Total users": totalUsers,
      "Pro users": proUsers,
      "Operator-flagged Pro": operatorFlagged,
      "Analytics opt-outs": optedOut,
    },
  ]);

  console.log("\nEvent counts by name");
  console.table(report.eventCountsByName);

  console.log("\nAI health");
  console.table([
    {
      Scope: "All AI",
      OK: report.ai.okRuns,
      Fail: report.ai.failRuns,
      Timeout: report.ai.failReasons.timeout,
      "AI error": report.ai.failReasons.ai_error,
      "Parse failed": report.ai.failReasons.parse_failed,
      "No match": report.ai.failReasons.no_match,
      "Rate limited": report.ai.failReasons.rate_limited,
      "Token rows": report.ai.tokenTelemetry.rowsWithTokens,
      "Token coverage": pct(report.ai.tokenTelemetry.share),
      Models: report.ai.tokenTelemetry.models.join(", ") || "none",
    },
    ...report.ai.runsByFeature.map((row) => ({
      Scope: row.feature,
      OK: row.ok,
      Fail: row.fail,
      Timeout: "",
      "AI error": "",
      "Parse failed": "",
      "No match": "",
      "Rate limited": "",
      "Token rows": "",
      "Token coverage": "",
      Models: "",
    })),
  ]);

  if (report.activeUsers === 1) {
    console.log(
      "\nSingle active beta user detected - valid for smoke validation, not cohort-level product conclusions."
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
