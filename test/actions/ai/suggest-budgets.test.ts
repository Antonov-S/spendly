import { describe, it, expect, vi, beforeEach } from "vitest";
import { suggestBudgets } from "@/actions/ai/suggest-budgets";
import { runAiFeature } from "@/lib/ai/run";
import { aiJsonRespond } from "@/lib/ai/respond";
import { getBudgetSuggestInputs } from "@/lib/db/budget-suggest";
import { track } from "@/lib/analytics/track";
import { BUDGET_SUGGEST_PROMPT_VERSION } from "@/lib/ai/prompts/budget-suggest";
import type { BudgetSuggestInputs } from "@/lib/budget-suggest";

vi.mock("@/lib/db/budget-suggest", () => ({ getBudgetSuggestInputs: vi.fn() }));
vi.mock("@/lib/ai/respond", () => ({ aiJsonRespond: vi.fn() }));
vi.mock("@/lib/ai/run", () => ({ runAiFeature: vi.fn() }));
vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));

const mockRun = vi.mocked(runAiFeature);
const mockRespond = vi.mocked(aiJsonRespond);
const mockInputs = vi.mocked(getBudgetSuggestInputs);
const mockTrack = vi.mocked(track);

/** Three months of Groceries + Dining spend — both clear the floors. */
const SIGNAL_INPUTS: BudgetSuggestInputs = {
  periodLabel: "July 2026",
  monthlySpend: [
    new Map([
      ["cat-groceries", 180],
      ["cat-dining", 40],
    ]),
    new Map([
      ["cat-groceries", 240],
      ["cat-dining", 50],
    ]),
    new Map([
      ["cat-groceries", 210],
      ["cat-dining", 60],
    ]),
  ],
  budgetedCategoryIds: new Set(),
  categories: new Map([
    ["cat-groceries", { name: "Groceries", icon: "ShoppingCart", color: "#EF9F27" }],
    ["cat-dining", { name: "Dining", icon: "UtensilsCrossed", color: "#D85A30" }],
  ]),
};

/** No history clears the floors. */
const SPARSE_INPUTS: BudgetSuggestInputs = {
  periodLabel: "July 2026",
  monthlySpend: [new Map(), new Map(), new Map()],
  budgetedCategoryIds: new Set(),
  categories: new Map(),
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

/** Run `run` and map a throw → reason: "no_match" (as the spine does for AiNoMatchError). */
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

describe("suggestBudgets config", () => {
  it("invokes runAiFeature with the right feature, burst limit and prompt version", async () => {
    runInline();
    mockInputs.mockResolvedValue(SIGNAL_INPUTS);
    mockRespond.mockResolvedValue(
      '{ "notes": [{ "categoryId": "cat-groceries", "note": "Steady at €210." }] }'
    );

    await suggestBudgets({ month: 7, year: 2026 });
    const args = mockRun.mock.calls[0][0];
    expect(args.feature).toBe("budget_suggest");
    expect(args.burstLimit).toBe("aiSuggest");
    expect(args.promptVersion).toBe(BUDGET_SUGGEST_PROMPT_VERSION);
  });

  it("passes the built facts (as JSON) to aiJsonRespond", async () => {
    runInline();
    mockInputs.mockResolvedValue(SIGNAL_INPUTS);
    mockRespond.mockResolvedValue('{ "notes": [] }');

    await suggestBudgets({ month: 7, year: 2026 });
    const facts = JSON.parse(mockRespond.mock.calls[0][0].input);
    expect(facts.periodLabel).toBe("July 2026");
    expect(facts.lookbackMonths).toBe(3);
    // Groceries (avg 210) ranks ahead of Dining (avg 50).
    expect(facts.suggestions[0].name).toBe("Groceries");
    expect(facts.suggestions[0].suggestedAmount).toBe(210);
  });
});

describe("suggestBudgets happy path", () => {
  it("merges guarded notes and marks aiNotes true", async () => {
    runInline();
    mockInputs.mockResolvedValue(SIGNAL_INPUTS);
    mockRespond.mockResolvedValue(
      '{ "notes": [{ "categoryId": "cat-groceries", "note": "You spent €180, €240 and €210 — €210 covers it." }] }'
    );

    const res = await suggestBudgets({ month: 7, year: 2026 });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.aiNotes).toBe(true);
      expect(res.data.periodLabel).toBe("July 2026");
      const groceries = res.data.suggestions.find(
        (s) => s.categoryId === "cat-groceries"
      );
      expect(groceries?.note).toBe(
        "You spent €180, €240 and €210 — €210 covers it."
      );
      // Dining had no model note → deterministic fallback.
      const dining = res.data.suggestions.find(
        (s) => s.categoryId === "cat-dining"
      );
      expect(dining?.note).toBe("Median of your last 3 months of Dining spending.");
    }
    expect(mockTrack).not.toHaveBeenCalled(); // clean pass → no guard/degrade events
  });
});

describe("suggestBudgets numeric guard telemetry", () => {
  it("emits ai_numeric_guard when a misquoted note is dropped", async () => {
    runInline();
    mockInputs.mockResolvedValue(SIGNAL_INPUTS);
    mockRespond.mockResolvedValue(
      '{ "notes": [{ "categoryId": "cat-groceries", "note": "You spent €999 last month." }] }'
    );

    const res = await suggestBudgets({ month: 7, year: 2026 });
    expect(res.success).toBe(true);
    if (res.success) {
      // Dropped note → fallback copy, aiNotes false.
      expect(res.data.aiNotes).toBe(false);
    }
    expect(mockTrack).toHaveBeenCalledWith("ai_numeric_guard", {
      feature: "budget_suggest",
      prompt_version: BUDGET_SUGGEST_PROMPT_VERSION,
      dropped_count: 1,
      kept_count: 0,
    });
  });
});

describe("suggestBudgets D5 phrasing degradation", () => {
  it("returns success with fallback notes and emits ai_phrasing_degraded when the model call throws", async () => {
    runInline();
    mockInputs.mockResolvedValue(SIGNAL_INPUTS);
    mockRespond.mockRejectedValue(new Error("upstream 500"));

    const res = await suggestBudgets({ month: 7, year: 2026 });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.aiNotes).toBe(false);
      // The deterministic suggestions still stand.
      expect(res.data.suggestions.length).toBeGreaterThan(0);
      expect(res.data.suggestions[0].note).toContain("Median of your last 3 months");
    }
    expect(mockTrack).toHaveBeenCalledWith("ai_phrasing_degraded", {
      feature: "budget_suggest",
      prompt_version: BUDGET_SUGGEST_PROMPT_VERSION,
      reason: "ai_error",
    });
  });
});

describe("suggestBudgets sparse history", () => {
  it("maps no eligible suggestions to reason: no_match without calling the model", async () => {
    runInlineFailOpen();
    mockInputs.mockResolvedValue(SPARSE_INPUTS);

    const res = await suggestBudgets({ month: 7, year: 2026 });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.reason).toBe("no_match");
    expect(mockRespond).not.toHaveBeenCalled();
  });
});

describe("suggestBudgets invalid input", () => {
  it("returns an ai_error failure without invoking runAiFeature", async () => {
    const res = await suggestBudgets({ month: 13, year: 2026 });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.reason).toBe("ai_error");
    expect(mockRun).not.toHaveBeenCalled();
  });
});
