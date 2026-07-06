import { describe, it, expect } from "vitest";
import {
  AI_REVIEW_THRESHOLDS,
  buildProValueReviewReport,
  verdictForRate,
  type ReviewEventRow,
  type ReviewUserRow,
} from "@/lib/analytics/review-metrics";

const FROM = new Date("2026-07-06T00:00:00.000Z");
const TO = new Date("2026-08-03T00:00:00.000Z");
const WINDOW = { from: FROM, to: TO };

function at(day: number): Date {
  return new Date(FROM.getTime() + day * 24 * 60 * 60 * 1000);
}

function event(
  name: string,
  userId: string,
  day: number,
  props: Record<string, unknown> | null = null
): ReviewEventRow {
  return { name, userId, createdAt: at(day), props };
}

function aiResult(
  feature: string,
  userId: string,
  day: number,
  outcome: "ok" | "fail" = "ok",
  reason = outcome === "ok" ? "ok" : "ai_error",
  extra: Record<string, unknown> = {}
): ReviewEventRow {
  return event("ai_result", userId, day, {
    feature,
    prompt_version: 1,
    outcome,
    reason,
    ...extra,
  });
}

function users(count: number, proCount = count): ReviewUserRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `u${index + 1}`,
    isPro: index < proCount,
  }));
}

describe("Pro Value Review thresholds", () => {
  it("pins the committed D3 thresholds", () => {
    expect(AI_REVIEW_THRESHOLDS.expand).toBe(0.6);
    expect(AI_REVIEW_THRESHOLDS.iterate).toBe(0.3);
    expect(AI_REVIEW_THRESHOLDS.monthlyReviewExpand).toBe(0.4);
    expect(AI_REVIEW_THRESHOLDS.monthlyReviewIterate).toBe(0.15);
    expect(AI_REVIEW_THRESHOLDS.monthlyReviewRepeatExpand).toBe(0.25);
  });

  it("applies expand / iterate / retire / insufficient bands", () => {
    expect(verdictForRate(0.6, 20)).toBe("expand");
    expect(verdictForRate(0.3, 20)).toBe("iterate");
    expect(verdictForRate(0.299, 20)).toBe("retire");
    expect(verdictForRate(0.9, 19)).toBe("insufficient");
    expect(verdictForRate(null, 20)).toBe("insufficient");
  });
});

describe("buildProValueReviewReport feature metrics", () => {
  it("computes the four committed AI feature measures from registered events", () => {
    const rows: ReviewEventRow[] = [];

    for (let i = 0; i < 10; i += 1) {
      rows.push(event("transaction_created", `u${i + 1}`, i % 3));
    }

    for (let i = 0; i < 20; i += 1) {
      rows.push(
        aiResult("category_suggest", `u${(i % 10) + 1}`, i % 5, "ok", "ok", {
          input_tokens: i === 0 ? 100 : undefined,
          output_tokens: i === 0 ? 20 : undefined,
          model: i === 0 ? "gpt-5-nano" : undefined,
        })
      );
    }
    for (let i = 0; i < 12; i += 1) {
      rows.push(event("ai_category_accepted", `u${(i % 10) + 1}`, i % 5));
    }
    for (let i = 0; i < 8; i += 1) {
      rows.push(event("ai_category_overridden", `u${(i % 10) + 1}`, i % 5));
    }

    for (let i = 0; i < 20; i += 1) {
      rows.push(aiResult("transaction_parse", `u${(i % 10) + 1}`, i % 5));
    }
    for (let i = 0; i < 12; i += 1) {
      rows.push(
        event("ai_parse_confirmed", `u${(i % 10) + 1}`, i % 5, {
          feature: "transaction_parse",
          prompt_version: 1,
          edited: i % 2 === 0,
          edited_field_count: i % 2 === 0 ? 1 : 0,
        })
      );
    }
    rows.push(
      event("ai_parse_confirmed", "u1", 1, {
        feature: "transaction_parse",
        prompt_version: 1,
        edited: true,
        edited_field_count: 3,
      })
    );

    rows.push(aiResult("monthly_review", "u1", 0));
    rows.push(aiResult("monthly_review", "u1", 8));
    rows.push(aiResult("monthly_review", "u2", 1));
    rows.push(aiResult("monthly_review", "u3", 2));
    rows.push(aiResult("monthly_review", "u4", 3));
    rows.push(
      event("ai_numeric_guard", "u1", 3, {
        feature: "monthly_review",
        prompt_version: 1,
        dropped_count: 1,
        kept_count: 3,
      })
    );

    for (let i = 0; i < 10; i += 1) {
      rows.push(aiResult("budget_suggest", `u${i + 1}`, i % 5));
    }
    for (let i = 0; i < 6; i += 1) {
      rows.push(
        event("ai_budget_suggest_accepted", `u${i + 1}`, i % 5, {
          feature: "budget_suggest",
          prompt_version: 1,
          edited: i % 2 === 0,
        })
      );
    }
    rows.push(
      event("ai_budget_suggest_dismissed", "u1", 6, {
        feature: "budget_suggest",
        prompt_version: 1,
        suggested_count: 10,
        accepted_count: 5,
      }),
      event("ai_phrasing_degraded", "u1", 6, {
        feature: "budget_suggest",
        prompt_version: 1,
        reason: "ai_error",
      }),
      aiResult("budget_suggest", "u1", 7, "fail", "no_match"),
      aiResult("category_suggest", "u1", 7, "fail", "timeout"),
      event("upgrade_to_pro_clicked", "u11", 7, { period: "monthly" })
    );

    const report = buildProValueReviewReport(rows, users(11, 10), WINDOW, {
      pricedModels: ["gpt-5-nano"],
    });

    expect(report.features.categorySuggest.acceptance.rate).toBe(0.6);
    expect(report.features.categorySuggest.acceptance.verdict).toBe("expand");
    expect(report.features.categorySuggest.abandonment).toBe(0);
    expect(report.features.categorySuggest.reliability.failReasons.timeout).toBe(1);

    expect(report.features.transactionParse.cleanConfirmed).toBe(12);
    expect(report.features.transactionParse.heavyEdited).toBe(1);
    expect(report.features.transactionParse.acceptance.rate).toBe(0.6);

    expect(report.features.monthlyReview.generators).toBe(4);
    expect(report.features.monthlyReview.engagement.rate).toBe(0.4);
    expect(report.features.monthlyReview.repeatRate.rate).toBe(0.25);
    expect(report.features.monthlyReview.verdict).toBe("expand");
    expect(report.features.monthlyReview.guardHealth.dropRate).toBe(0.25);

    expect(report.features.budgetSuggest.acceptance.rate).toBe(0.6);
    expect(report.features.budgetSuggest.acceptance.verdict).toBe("expand");
    expect(report.features.budgetSuggest.panelYield.rate).toBe(0.5);
    expect(report.features.budgetSuggest.phrasingDegraded).toBe(1);
    expect(report.features.budgetSuggest.reliability.failReasons.no_match).toBe(1);

    expect(report.crossFeature.activeProAdopters.users).toBe(10);
    expect(report.crossFeature.activeProNonAdopters.users).toBe(0);
    expect(report.crossFeature.upgradeClicksEndingPro).toBe(0);
  });
});

describe("buildProValueReviewReport coverage and COGS", () => {
  it("handles an empty report window without inventing activity", () => {
    const report = buildProValueReviewReport([], [], WINDOW, {
      pricedModels: ["gpt-5-nano"],
    });

    expect(report.coverage.activeUsers).toBe(0);
    expect(report.coverage.activeProUsers).toBe(0);
    expect(report.coverage.actualSpanDays).toBe(0);
    expect(report.coverage.tokenCoverageShare).toBe(0);
    expect(report.coverage.costMeasurement).toBe("manual-estimate-required");
    expect(report.features.categorySuggest.acceptance.verdict).toBe(
      "insufficient"
    );
    expect(report.features.monthlyReview.verdict).toBe("insufficient");
    expect(report.cogs.totalTokens).toBe(0);
  });

  it("marks full priced token coverage as measured", () => {
    const report = buildProValueReviewReport(
      [
        aiResult("category_suggest", "u1", 0, "ok", "ok", {
          input_tokens: 100,
          output_tokens: 50,
          model: "gpt-5-nano",
        }),
        event("transaction_created", "u1", 28),
      ],
      users(1),
      WINDOW,
      { pricedModels: ["gpt-5-nano"] }
    );

    expect(report.coverage.costMeasurement).toBe("measured");
    expect(report.coverage.tokenCoverageShare).toBe(1);
    expect(report.coverage.unpricedModels).toEqual([]);
    expect(report.cogs.totalTokens).toBe(150);
  });

  it("marks partial time coverage as partial", () => {
    const report = buildProValueReviewReport(
      [
        aiResult("category_suggest", "u1", 14, "ok", "ok", {
          input_tokens: 100,
          output_tokens: 50,
          model: "gpt-5-nano",
        }),
      ],
      users(1),
      WINDOW,
      { pricedModels: ["gpt-5-nano"] }
    );

    expect(report.coverage.costMeasurement).toBe("partial");
    expect(report.coverage.tokenCoverageShare).toBe(0.5);
  });

  it("separates unpriced model volume from measured token volume", () => {
    const report = buildProValueReviewReport(
      [
        aiResult("category_suggest", "u1", 0, "ok", "ok", {
          input_tokens: 100,
          output_tokens: 100,
          model: "gpt-5-nano",
        }),
        aiResult("transaction_parse", "u1", 0, "ok", "ok", {
          input_tokens: 50,
          output_tokens: 50,
          model: "unknown-model",
        }),
      ],
      users(1),
      WINDOW,
      { pricedModels: ["gpt-5-nano"] }
    );

    expect(report.coverage.costMeasurement).toBe("partial");
    expect(report.coverage.unpricedModels).toEqual(["unknown-model"]);
    expect(report.coverage.unpricedTokenShare).toBeCloseTo(1 / 3);
  });

  it("requires manual estimate when all measured token volume is unpriced", () => {
    const report = buildProValueReviewReport(
      [
        aiResult("transaction_parse", "u1", 0, "ok", "ok", {
          input_tokens: 50,
          output_tokens: 50,
          model: "unknown-model",
        }),
      ],
      users(1),
      WINDOW,
      { pricedModels: ["gpt-5-nano"] }
    );

    expect(report.coverage.costMeasurement).toBe("manual-estimate-required");
    expect(report.coverage.unpricedModels).toEqual(["unknown-model"]);
    expect(report.coverage.unpricedTokenShare).toBe(1);
    expect(report.cogs.totalTokens).toBe(100);
  });

  it("requires manual estimate when there are no token rows", () => {
    const report = buildProValueReviewReport(
      [aiResult("category_suggest", "u1", 0)],
      users(1),
      WINDOW,
      { pricedModels: ["gpt-5-nano"] }
    );

    expect(report.coverage.costMeasurement).toBe("manual-estimate-required");
    expect(report.coverage.tokenCoverageFrom).toBeNull();
  });
});
