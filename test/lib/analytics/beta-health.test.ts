import { describe, expect, it } from "vitest";
import {
  buildBetaHealthReport,
  type BetaHealthReport,
} from "@/lib/analytics/beta-health";
import type { ReviewEventRow } from "@/lib/analytics/review-metrics";

const FROM = new Date("2026-07-10T00:00:00.000Z");

function at(hour: number): Date {
  return new Date(FROM.getTime() + hour * 60 * 60 * 1000);
}

function event(
  name: string,
  userId: string,
  hour: number,
  props: Record<string, unknown> | null = null
): ReviewEventRow {
  return { name, userId, createdAt: at(hour), props };
}

function aiResult(
  feature: string,
  userId: string,
  hour: number,
  outcome: "ok" | "fail" = "ok",
  reason = outcome === "ok" ? "ok" : "ai_error",
  extra: Record<string, unknown> = {}
): ReviewEventRow {
  return event("ai_result", userId, hour, {
    feature,
    prompt_version: 1,
    outcome,
    reason,
    ...extra,
  });
}

function reasonCount(report: BetaHealthReport, reason: string): number {
  return report.ai.failReasons[
    reason as keyof BetaHealthReport["ai"]["failReasons"]
  ];
}

describe("buildBetaHealthReport", () => {
  it("returns a zeroed report for an empty event window", () => {
    const report = buildBetaHealthReport([]);

    expect(report.latestWindowEventAt).toBeNull();
    expect(report.totalEvents).toBe(0);
    expect(report.eventCountsByName).toEqual([]);
    expect(report.activeUsers).toBe(0);
    expect(report.ai.okRuns).toBe(0);
    expect(report.ai.failRuns).toBe(0);
    expect(report.ai.tokenTelemetry.share).toBeNull();
    expect(report.ai.tokenTelemetry.models).toEqual([]);
  });

  it("counts events by name in count-desc/name-asc order", () => {
    const report = buildBetaHealthReport([
      event("transaction_created", "u1", 0),
      event("budget_created", "u1", 1),
      event("ai_result", "u2", 2),
      event("budget_created", "u2", 3),
      event("transaction_created", "u3", 4),
      event("account_created", "u3", 5),
    ]);

    expect(report.latestWindowEventAt).toEqual(at(5));
    expect(report.totalEvents).toBe(6);
    expect(report.activeUsers).toBe(3);
    expect(report.eventCountsByName).toEqual([
      { name: "budget_created", count: 2 },
      { name: "transaction_created", count: 2 },
      { name: "account_created", count: 1 },
      { name: "ai_result", count: 1 },
    ]);
  });

  it("splits AI ok/fail runs and buckets supported failure reasons", () => {
    const report = buildBetaHealthReport([
      aiResult("category_suggest", "u1", 0),
      aiResult("category_suggest", "u1", 1, "fail", "timeout"),
      aiResult("transaction_parse", "u2", 2, "fail", "parse_failed"),
      aiResult("monthly_review", "u3", 3, "fail", "no_match"),
      aiResult("budget_suggest", "u4", 4, "fail", "rate_limited"),
      aiResult("budget_suggest", "u4", 5, "fail", "ai_error"),
      aiResult("budget_suggest", "u5", 6, "fail", "not_pro"),
    ]);

    expect(report.ai.okRuns).toBe(1);
    expect(report.ai.failRuns).toBe(6);
    expect(report.ai.failReasons).toEqual({
      timeout: 1,
      ai_error: 1,
      parse_failed: 1,
      no_match: 1,
      rate_limited: 1,
    });
    expect(reasonCount(report, "not_pro")).toBeUndefined();
  });

  it("groups per-feature ok/fail pairs including fail-only features", () => {
    const report = buildBetaHealthReport([
      aiResult("transaction_parse", "u1", 0),
      aiResult("transaction_parse", "u1", 1, "fail", "ai_error"),
      aiResult("monthly_review", "u2", 2, "fail", "timeout"),
      aiResult("unknown_feature", "u3", 3, "fail", "ai_error"),
    ]);

    expect(report.ai.runsByFeature).toEqual([
      { feature: "monthly_review", ok: 0, fail: 1 },
      { feature: "transaction_parse", ok: 1, fail: 1 },
    ]);
  });

  it("reports token telemetry share and sorted distinct models from ok runs", () => {
    const report = buildBetaHealthReport([
      aiResult("category_suggest", "u1", 0, "ok", "ok", {
        input_tokens: 100,
        output_tokens: 20,
        model: "gpt-5-nano",
      }),
      aiResult("transaction_parse", "u1", 1),
      aiResult("monthly_review", "u2", 2, "ok", "ok", {
        input_tokens: 200,
        output_tokens: 50,
        model: "gpt-5-mini",
      }),
      aiResult("budget_suggest", "u3", 3, "fail", "timeout", {
        input_tokens: 300,
        output_tokens: 70,
        model: "gpt-5-nano",
      }),
    ]);

    expect(report.ai.okRuns).toBe(3);
    expect(report.ai.tokenTelemetry.rowsWithTokens).toBe(2);
    expect(report.ai.tokenTelemetry.share).toBeCloseTo(2 / 3);
    expect(report.ai.tokenTelemetry.models).toEqual([
      "gpt-5-mini",
      "gpt-5-nano",
    ]);
  });

  it("ignores malformed AI props without dropping stream counts", () => {
    const report = buildBetaHealthReport([
      event("ai_result", "u1", 0, null),
      event(
        "ai_result",
        "u1",
        1,
        [] as unknown as Record<string, unknown>
      ),
      event("ai_result", "u2", 2, {
        feature: 123,
        outcome: true,
        reason: "ok",
        input_tokens: "100",
      }),
      event("transaction_created", "u2", 3),
    ]);

    expect(report.totalEvents).toBe(4);
    expect(report.eventCountsByName).toEqual([
      { name: "ai_result", count: 3 },
      { name: "transaction_created", count: 1 },
    ]);
    expect(report.activeUsers).toBe(2);
    expect(report.ai.okRuns).toBe(0);
    expect(report.ai.failRuns).toBe(0);
    expect(report.ai.runsByFeature).toEqual([]);
    expect(report.ai.tokenTelemetry.share).toBeNull();
  });
});
