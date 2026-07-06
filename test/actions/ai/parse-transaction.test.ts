import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseTransaction } from "@/actions/ai/parse-transaction";
import { runAiFeature } from "@/lib/ai/run";
import { getUserCategories } from "@/lib/db/categories";
import { aiJsonRespond } from "@/lib/ai/respond";
import { AI_INPUT_MAX_CHARS } from "@/lib/system-constants";
import { TRANSACTION_PARSE_PROMPT_VERSION } from "@/lib/ai/prompts/transaction";

vi.mock("@/lib/db/categories", () => ({ getUserCategories: vi.fn() }));
vi.mock("@/lib/ai/respond", () => ({ aiJsonRespond: vi.fn() }));
vi.mock("@/lib/ai/run", () => ({
  runAiFeature: vi.fn(),
  withAiTelemetry: (data: unknown) => data,
}));

const mockRun = vi.mocked(runAiFeature);
const mockCategories = vi.mocked(getUserCategories);
const mockRespond = vi.mocked(aiJsonRespond);

const CANDIDATES = [
  { id: "c1", name: "Groceries", color: "#000", icon: "ShoppingCart" },
  { id: "c2", name: "Dining", color: "#000", icon: "UtensilsCrossed" },
];

function ai(text: string) {
  return { text, model: "gpt-5-nano" };
}

/** Invoke the real `run` callback with a fake ctx, mirroring runAiFeature's success path. */
function runInline() {
  mockRun.mockImplementation(async (args) => {
    const data = await args.run({
      userId: "u1",
      signal: new AbortController().signal,
    });
    return { success: true, data };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCategories.mockResolvedValue(CANDIDATES);
});

describe("parseTransaction validation", () => {
  it("rejects empty input before touching the model", async () => {
    const res = await parseTransaction({ text: "" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.reason).toBe("ai_error");
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockRespond).not.toHaveBeenCalled();
  });
});

describe("parseTransaction config", () => {
  it("invokes runAiFeature with the right feature, burst limit and prompt version", async () => {
    runInline();
    mockRespond.mockResolvedValue(ai('{ "amount": 12 }'));

    await parseTransaction({ text: "12 lunch" });
    const args = mockRun.mock.calls[0][0];
    expect(args.feature).toBe("transaction_parse");
    expect(args.burstLimit).toBe("aiSuggest");
    expect(args.promptVersion).toBe(TRANSACTION_PARSE_PROMPT_VERSION);
  });
});

describe("parseTransaction matching", () => {
  it("returns a matched draft with the prompt version", async () => {
    runInline();
    mockRespond.mockResolvedValue(
      ai(
        '{ "type": "EXPENSE", "amount": 12.5, "date": "2026-06-26", "category": "dining", "merchant": "Pret", "note": "lunch", "confidence": "high" }'
      )
    );

    const res = await parseTransaction({ text: "12.50 lunch at Pret" });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual({
        type: "EXPENSE",
        amount: 12.5,
        date: "2026-06-26",
        categoryId: "c2", // Dining → c2
        categoryName: "Dining",
        merchant: "Pret",
        note: "lunch",
        confidence: "high",
        promptVersion: TRANSACTION_PARSE_PROMPT_VERSION,
      });
    }
  });

  it("degrades to categoryId: null when the name matches nothing (still success)", async () => {
    runInline();
    mockRespond.mockResolvedValue(
      ai('{ "amount": 1200, "category": "Rent", "confidence": "low" }')
    );

    const res = await parseTransaction({ text: "rent 1200" });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.categoryId).toBeNull();
      expect(res.data.categoryName).toBeNull();
      expect(res.data.amount).toBe(1200);
    }
  });
});

describe("parseTransaction amount requirement", () => {
  it("maps a missing amount to reason: no_match (AiNoMatchError)", async () => {
    // Mirror runAiFeature's mapping of a thrown AiNoMatchError → no_match.
    mockRun.mockImplementation(async (args) => {
      try {
        const data = await args.run({
          userId: "u1",
          signal: new AbortController().signal,
        });
        return { success: true, data };
      } catch {
        return {
          success: false,
          error: args.failOpenMessage,
          reason: "no_match",
        };
      }
    });
    mockRespond.mockResolvedValue(ai('{ "category": "groceries" }')); // no amount

    const res = await parseTransaction({ text: "groceries amazon" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.reason).toBe("no_match");
  });
});

describe("parseTransaction token control", () => {
  it("truncates over-long text to AI_INPUT_MAX_CHARS before the call", async () => {
    runInline();
    mockRespond.mockResolvedValue(ai('{ "amount": 1 }'));

    const longText = "x".repeat(AI_INPUT_MAX_CHARS + 500);
    await parseTransaction({ text: longText });

    const sentInput = mockRespond.mock.calls[0][0].input;
    expect(sentInput).not.toContain("x".repeat(AI_INPUT_MAX_CHARS + 1));
    expect(sentInput).toContain("x".repeat(AI_INPUT_MAX_CHARS));
  });

  it("forwards the candidate category names and today to the model", async () => {
    runInline();
    mockRespond.mockResolvedValue(ai('{ "amount": 1 }'));

    await parseTransaction({ text: "coffee 3" });
    const sentInput = mockRespond.mock.calls[0][0].input;
    expect(sentInput).toContain("Groceries");
    expect(sentInput).toContain("Dining");
    expect(sentInput).toContain("today");
  });
});
