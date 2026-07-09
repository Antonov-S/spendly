import "dotenv/config";

import { prisma } from "../src/lib/prisma";
import { AI_REVIEW_WINDOW_DAYS } from "../src/lib/system-constants";
import {
  buildProValueReviewReport,
  type CogsMetrics,
  type ModelTokenUsage,
  type RateMetric,
  type ReviewEventRow,
} from "../src/lib/analytics/review-metrics";
import { looksProduction, parseHost } from "./db-env";

/**
 * Read-only operator report for the Pro Value Review checkpoint.
 *
 *   npx tsx scripts/ai-review-report.ts
 *   npx tsx scripts/ai-review-report.ts --from 2026-07-06 --days 28
 *
 * The script intentionally has no --apply mode. It only reads AnalyticsEvent
 * rows and a minimal User plan snapshot, then prints the pure metrics report.
 */

// Operator-local price table. Keep this small and explicit: unknown models are
// reported as unpriced volume instead of being silently costed at the wrong rate.
const MODEL_PRICE_EUR_PER_1M = {
  "gpt-5-nano": { input: 0.05, output: 0.4 },
} as const;

function argValue(name: string): string | null {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function parseDays(): number {
  const raw = argValue("days");
  if (!raw) return AI_REVIEW_WINDOW_DAYS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("--days must be a positive integer");
  }
  return value;
}

function parseWindow(): { from: Date; to: Date; days: number } {
  const days = parseDays();
  const fromArg = argValue("from");
  if (fromArg) {
    const from = new Date(`${fromArg}T00:00:00.000Z`);
    if (Number.isNaN(from.getTime())) {
      throw new Error("--from must be YYYY-MM-DD");
    }
    return {
      from,
      to: new Date(from.getTime() + days * 24 * 60 * 60 * 1000),
      days,
    };
  }

  const to = new Date();
  return {
    from: new Date(to.getTime() - days * 24 * 60 * 60 * 1000),
    to,
    days,
  };
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

function countPair(numerator: number, denominator: number): string {
  return denominator === 0 ? "n/a" : `${numerator}/${denominator}`;
}

function verdict(metric: RateMetric): string {
  return metric.smallN ? `insufficient (n=${metric.denominator})` : metric.verdict;
}

function priceFor(model: string): { input: number; output: number } | null {
  return Object.prototype.hasOwnProperty.call(MODEL_PRICE_EUR_PER_1M, model)
    ? MODEL_PRICE_EUR_PER_1M[model as keyof typeof MODEL_PRICE_EUR_PER_1M]
    : null;
}

function modelCost(row: ModelTokenUsage): number | null {
  const price = priceFor(row.model);
  if (!price) return null;
  return (
    (row.inputTokens / 1_000_000) * price.input +
    (row.outputTokens / 1_000_000) * price.output
  );
}

function totalCost(cogs: CogsMetrics): number {
  return cogs.byModel.reduce((sum, row) => sum + (modelCost(row) ?? 0), 0);
}

async function main() {
  const { from, to, days } = parseWindow();
  const host = parseHost(process.env.DATABASE_URL);
  const isProductionLike = looksProduction(host);

  console.log("Pro Value Review report");
  console.log(`Target DB host:  ${host}`);
  console.log(
    `Environment:     ${isProductionLike ? "PRODUCTION (or unknown)" : "development"}`
  );
  console.log(`Mode:            read-only`);
  console.log(`Window:          ${from.toISOString()} -> ${to.toISOString()}`);
  console.log(`Requested days:  ${days}`);

  const rows = await prisma.analyticsEvent.findMany({
    where: { createdAt: { gte: from, lt: to } },
    select: { name: true, props: true, userId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const userIds = [...new Set(rows.map((row) => row.userId))];
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, isPro: true },
        })
      : [];
  const events: ReviewEventRow[] = rows.map((row) => ({
    name: row.name,
    props: asProps(row.props),
    userId: row.userId,
    createdAt: row.createdAt,
  }));

  const report = buildProValueReviewReport(events, users, { from, to }, {
    pricedModels: Object.keys(MODEL_PRICE_EUR_PER_1M),
  });

  console.log("\nData coverage");
  console.table([
    {
      "Active users": report.coverage.activeUsers,
      "Active Pro users": report.coverage.activeProUsers,
      "Actual span days": report.coverage.actualSpanDays.toFixed(2),
      "Token coverage from":
        report.coverage.tokenCoverageFrom?.toISOString() ?? "none",
      "Token coverage": pct(report.coverage.tokenCoverageShare),
      "Cost measurement": report.coverage.costMeasurement,
      "Mid-window upgrade clicks": report.coverage.midWindowUpgradeClicks,
    },
  ]);
  if (report.coverage.actualSpanDays < report.coverage.requestedWindowDays) {
    console.warn(
      `WARNING: data span (${report.coverage.actualSpanDays.toFixed(
        2
      )}d) is shorter than requested window (${report.coverage.requestedWindowDays.toFixed(
        2
      )}d). Do not treat this as the final checkpoint.`
    );
  }

  console.log("\nFeature verdicts");
  console.table([
    {
      Feature: "Auto-Categorization",
      Measure: "accepted / (accepted + overridden)",
      Value: pct(report.features.categorySuggest.acceptance.rate),
      Numerator: report.features.categorySuggest.acceptance.numerator,
      Denominator: report.features.categorySuggest.acceptance.denominator,
      Verdict: verdict(report.features.categorySuggest.acceptance),
    },
    {
      Feature: "NL Quick Capture",
      Measure: "clean confirms / served",
      Value: pct(report.features.transactionParse.acceptance.rate),
      Numerator: report.features.transactionParse.acceptance.numerator,
      Denominator: report.features.transactionParse.acceptance.denominator,
      Verdict: verdict(report.features.transactionParse.acceptance),
    },
    {
      Feature: "Monthly Review",
      Measure: "generators / active Pro users",
      Value: pct(report.features.monthlyReview.engagement.rate),
      Numerator: report.features.monthlyReview.engagement.numerator,
      Denominator: report.features.monthlyReview.engagement.denominator,
      Verdict: report.features.monthlyReview.verdict,
    },
    {
      Feature: "Budget Suggestions",
      Measure: "users with accept / users with ok run",
      Value: pct(report.features.budgetSuggest.acceptance.rate),
      Numerator: report.features.budgetSuggest.acceptance.numerator,
      Denominator: report.features.budgetSuggest.acceptance.denominator,
      Verdict: verdict(report.features.budgetSuggest.acceptance),
    },
  ]);

  console.log("\nFeature context");
  console.table([
    {
      Feature: "Monthly Review",
      Context: "repeat usage + numeric guard",
      Rate: pct(report.features.monthlyReview.repeatRate.rate),
      Count: countPair(
        report.features.monthlyReview.repeatRate.numerator,
        report.features.monthlyReview.repeatRate.denominator
      ),
      "Guard drop": pct(report.features.monthlyReview.guardHealth.dropRate),
      "Guard dropped/kept": countPair(
        report.features.monthlyReview.guardHealth.dropped,
        report.features.monthlyReview.guardHealth.dropped +
          report.features.monthlyReview.guardHealth.kept
      ),
      "Phrasing degraded": "n/a",
    },
    {
      Feature: "Budget Suggestions",
      Context: "panel yield + numeric guard + phrasing fallback",
      Rate: pct(report.features.budgetSuggest.panelYield.rate),
      Count: countPair(
        report.features.budgetSuggest.panelYield.numerator,
        report.features.budgetSuggest.panelYield.denominator
      ),
      "Guard drop": pct(report.features.budgetSuggest.guardHealth.dropRate),
      "Guard dropped/kept": countPair(
        report.features.budgetSuggest.guardHealth.dropped,
        report.features.budgetSuggest.guardHealth.dropped +
          report.features.budgetSuggest.guardHealth.kept
      ),
      "Phrasing degraded": report.features.budgetSuggest.phrasingDegraded,
    },
  ]);

  console.log("\nReliability");
  console.table(
    Object.entries({
      "Auto-Categorization": report.features.categorySuggest.reliability,
      "NL Quick Capture": report.features.transactionParse.reliability,
      "Monthly Review": report.features.monthlyReview.reliability,
      "Budget Suggestions": report.features.budgetSuggest.reliability,
    }).map(([feature, reliability]) => ({
      Feature: feature,
      OK: reliability.okRuns,
      Fail: reliability.failRuns,
      Timeout: reliability.failReasons.timeout,
      "AI error": reliability.failReasons.ai_error,
      "Parse failed": reliability.failReasons.parse_failed,
      "No match": reliability.failReasons.no_match,
      "Rate limited": reliability.failReasons.rate_limited,
    }))
  );

  console.log("\nPro signal");
  console.table([
    {
      Cohort: "Active Pro adopters",
      Users: report.crossFeature.activeProAdopters.users,
      "Avg active days":
        report.crossFeature.activeProAdopters.averageActiveDays.toFixed(2),
      "Avg active weeks":
        report.crossFeature.activeProAdopters.averageActiveWeeks.toFixed(2),
      Transactions: report.crossFeature.activeProAdopters.transactionCreated,
      Budgets: report.crossFeature.activeProAdopters.budgetCreated,
    },
    {
      Cohort: "Active Pro non-adopters",
      Users: report.crossFeature.activeProNonAdopters.users,
      "Avg active days":
        report.crossFeature.activeProNonAdopters.averageActiveDays.toFixed(2),
      "Avg active weeks":
        report.crossFeature.activeProNonAdopters.averageActiveWeeks.toFixed(2),
      Transactions: report.crossFeature.activeProNonAdopters.transactionCreated,
      Budgets: report.crossFeature.activeProNonAdopters.budgetCreated,
    },
  ]);
  console.log(
    `Upgrade-click users who are Pro at report time: ${report.crossFeature.upgradeClicksEndingPro}`
  );

  console.log("\nCOGS");
  console.table(
    report.cogs.byModel.map((row) => ({
      Model: row.model,
      "Input tokens": row.inputTokens,
      "Output tokens": row.outputTokens,
      "Total tokens": row.totalTokens,
      Priced: row.priced,
      "Estimated EUR": modelCost(row)?.toFixed(6) ?? "unpriced",
    }))
  );
  console.log(`Estimated measured EUR: ${totalCost(report.cogs).toFixed(6)}`);
  if (report.coverage.unpricedModels.length > 0) {
    console.warn(
      `Unpriced models: ${report.coverage.unpricedModels.join(", ")} (${pct(
        report.coverage.unpricedTokenShare
      )} of measured token volume)`
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
