import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateMonthlyReview } from "@/actions/ai/monthly-review";
import { runAiFeature } from "@/lib/ai/run";
import { aiJsonRespond } from "@/lib/ai/respond";
import { getMonthlyReviewInputs } from "@/lib/db/monthly-review";
import { track } from "@/lib/analytics/track";
import { MONTHLY_REVIEW_PROMPT_VERSION } from "@/lib/ai/prompts/review";
import type { ReviewInputs } from "@/lib/reports-review";

vi.mock("@/lib/db/monthly-review", () => ({ getMonthlyReviewInputs: vi.fn() }));
vi.mock("@/lib/ai/respond", () => ({ aiJsonRespond: vi.fn() }));
vi.mock("@/lib/ai/run", () => ({ runAiFeature: vi.fn() }));
vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));

const mockRun = vi.mocked(runAiFeature);
const mockRespond = vi.mocked(aiJsonRespond);
const mockInputs = vi.mocked(getMonthlyReviewInputs);
const mockTrack = vi.mocked(track);

/** Inputs that yield a real signal: Dining up 300 vs 200 and over its €250 budget. */
const SIGNAL_INPUTS: ReviewInputs = {
  currentSpend: new Map([["c1", 300]]),
  priorSpend: new Map([["c1", 200]]),
  currentTotals: { income: 1000, expenses: 400 },
  priorTotals: { income: 1000, expenses: 300 },
  budgets: [
    {
      id: "b1",
      category: { name: "Dining", color: "#000", icon: "Tag" },
      spent: 300,
      limit: 250,
      rollover: false,
      carriedAmount: 0,
    },
  ],
  categoryNames: new Map([["c1", "Dining"]]),
  periodLabel: "July 2026",
};

const SPARSE_INPUTS: ReviewInputs = {
  currentSpend: new Map(),
  priorSpend: new Map(),
  currentTotals: { income: 0, expenses: 0 },
  priorTotals: { income: 0, expenses: 0 },
  budgets: [],
  categoryNames: new Map(),
  periodLabel: "July 2026",
};

/** Run the real `run` callback via runAiFeature's success path. */
function runInline() {
  mockRun.mockImplementation(async (args) => {
    const data = await args.run({
      userId: "u1",
      signal: new AbortController().signal,
    });
    return { success: true, data };
  });
}

/** Run `run` and map a thrown AiNoMatchError → reason: "no_match" (as the spine does). */
function runInlineFailOpen() {
  mockRun.mockImplementation(async (args) => {
    try {
      const data = await args.run({
        userId: "u1",
        signal: new AbortController().signal,
      });
      return { success: true, data };
    } catch {
      return { success: false, error: args.failOpenMessage, reason: "no_match" };
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateMonthlyReview config", () => {
  it("invokes runAiFeature with the right feature, burst limit and prompt version", async () => {
    runInline();
    mockInputs.mockResolvedValue(SIGNAL_INPUTS);
    mockRespond.mockResolvedValue('{ "summary": ["Net cashflow is €600."] }');

    await generateMonthlyReview({ accountId: null });
    const args = mockRun.mock.calls[0][0];
    expect(args.feature).toBe("monthly_review");
    expect(args.burstLimit).toBe("aiSuggest");
    expect(args.promptVersion).toBe(MONTHLY_REVIEW_PROMPT_VERSION);
  });

  it("passes the built facts (as JSON) to aiJsonRespond", async () => {
    runInline();
    mockInputs.mockResolvedValue(SIGNAL_INPUTS);
    mockRespond.mockResolvedValue('{ "summary": ["Net cashflow is €600."] }');

    await generateMonthlyReview({ accountId: null });
    const payload = mockRespond.mock.calls[0][0].input;
    const facts = JSON.parse(payload);
    expect(facts.periodLabel).toBe("July 2026");
    expect(facts.netCashflow).toBe(600);
    expect(facts.movers[0].name).toBe("Dining");
  });
});

describe("generateMonthlyReview happy path", () => {
  it("returns a narrative with the period label and prompt version", async () => {
    runInline();
    mockInputs.mockResolvedValue(SIGNAL_INPUTS);
    mockRespond.mockResolvedValue(
      '{ "summary": ["Dining is €50 over budget.", "Net cashflow is €600."] }'
    );

    const res = await generateMonthlyReview({ accountId: null });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.summary).toEqual([
        "Dining is €50 over budget.",
        "Net cashflow is €600.",
      ]);
      expect(res.data.periodLabel).toBe("July 2026");
      expect(res.data.promptVersion).toBe(MONTHLY_REVIEW_PROMPT_VERSION);
    }
    expect(mockTrack).not.toHaveBeenCalled(); // clean pass → no numeric-guard event
  });
});

describe("generateMonthlyReview numeric guard telemetry", () => {
  it("emits ai_numeric_guard with the drop counts when a line is misquoted", async () => {
    runInline();
    mockInputs.mockResolvedValue(SIGNAL_INPUTS);
    mockRespond.mockResolvedValue(
      '{ "summary": ["Dining is €50 over budget.", "Groceries rose 38%.", "Net cashflow is €600."] }'
    );

    const res = await generateMonthlyReview({ accountId: null });
    expect(res.success).toBe(true);
    if (res.success) {
      // The misquoted 38% line is dropped; the two faithful lines survive.
      expect(res.data.summary).toEqual([
        "Dining is €50 over budget.",
        "Net cashflow is €600.",
      ]);
    }
    expect(mockTrack).toHaveBeenCalledWith("ai_numeric_guard", {
      feature: "monthly_review",
      prompt_version: MONTHLY_REVIEW_PROMPT_VERSION,
      dropped_count: 1,
      kept_count: 2,
    });
  });
});

describe("generateMonthlyReview sparse month", () => {
  it("maps a no-signal month to reason: no_match", async () => {
    runInlineFailOpen();
    mockInputs.mockResolvedValue(SPARSE_INPUTS);

    const res = await generateMonthlyReview({ accountId: null });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.reason).toBe("no_match");
    expect(mockRespond).not.toHaveBeenCalled(); // never reaches the model
  });
});
