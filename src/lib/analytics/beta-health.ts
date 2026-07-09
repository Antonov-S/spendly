import {
  AI_REVIEW_FEATURES,
  type ReviewEventRow,
} from "@/lib/analytics/review-metrics";

const AI_FAIL_REASONS = [
  "timeout",
  "ai_error",
  "parse_failed",
  "no_match",
  "rate_limited",
] as const;

type AiFailReason = (typeof AI_FAIL_REASONS)[number];

export interface BetaHealthReport {
  latestWindowEventAt: Date | null;
  totalEvents: number;
  eventCountsByName: { name: string; count: number }[];
  activeUsers: number;
  ai: {
    okRuns: number;
    failRuns: number;
    failReasons: Record<AiFailReason, number>;
    runsByFeature: { feature: string; ok: number; fail: number }[];
    tokenTelemetry: {
      rowsWithTokens: number;
      share: number | null;
      models: string[];
    };
  };
}

function emptyFailReasons(): Record<AiFailReason, number> {
  return {
    timeout: 0,
    ai_error: 0,
    parse_failed: 0,
    no_match: 0,
    rate_limited: 0,
  };
}

function propString(row: ReviewEventRow, key: string): string | null {
  const value = row.props?.[key];
  return typeof value === "string" ? value : null;
}

function propNumber(row: ReviewEventRow, key: string): number | null {
  const value = row.props?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isAiFeature(value: string | null): value is string {
  return AI_REVIEW_FEATURES.includes(
    value as (typeof AI_REVIEW_FEATURES)[number]
  );
}

function isOkAiRun(row: ReviewEventRow): boolean {
  return propString(row, "outcome") === "ok" && propString(row, "reason") === "ok";
}

function isFailAiRun(row: ReviewEventRow): boolean {
  return propString(row, "outcome") === "fail";
}

function hasTokenTelemetry(row: ReviewEventRow): boolean {
  return (
    propNumber(row, "input_tokens") !== null &&
    propNumber(row, "output_tokens") !== null &&
    propString(row, "model") !== null
  );
}

function eventCountsByName(
  events: ReviewEventRow[]
): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.name, (counts.get(event.name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function buildBetaHealthReport(
  events: ReviewEventRow[]
): BetaHealthReport {
  const latestWindowEventAt =
    events.length > 0
      ? new Date(
          Math.max(...events.map((event) => event.createdAt.getTime()))
        )
      : null;
  const activeUsers = new Set(events.map((event) => event.userId)).size;
  const failReasons = emptyFailReasons();
  const featureRuns = new Map<string, { feature: string; ok: number; fail: number }>();
  const models = new Set<string>();
  let okRuns = 0;
  let failRuns = 0;
  let rowsWithTokens = 0;

  for (const event of events) {
    if (event.name !== "ai_result") continue;

    const feature = propString(event, "feature");
    const ok = isOkAiRun(event);
    const fail = isFailAiRun(event);
    if (!ok && !fail) continue;

    if (ok) {
      okRuns += 1;
      if (hasTokenTelemetry(event)) {
        rowsWithTokens += 1;
        const model = propString(event, "model");
        if (model) models.add(model);
      }
    } else {
      failRuns += 1;
      const reason = propString(event, "reason");
      if (AI_FAIL_REASONS.includes(reason as AiFailReason)) {
        failReasons[reason as AiFailReason] += 1;
      }
    }

    if (!isAiFeature(feature)) continue;
    const current = featureRuns.get(feature) ?? { feature, ok: 0, fail: 0 };
    if (ok) current.ok += 1;
    if (fail) current.fail += 1;
    featureRuns.set(feature, current);
  }

  return {
    latestWindowEventAt,
    totalEvents: events.length,
    eventCountsByName: eventCountsByName(events),
    activeUsers,
    ai: {
      okRuns,
      failRuns,
      failReasons,
      runsByFeature: [...featureRuns.values()].sort((a, b) =>
        a.feature.localeCompare(b.feature)
      ),
      tokenTelemetry: {
        rowsWithTokens,
        share: okRuns > 0 ? rowsWithTokens / okRuns : null,
        models: [...models].sort(),
      },
    },
  };
}
