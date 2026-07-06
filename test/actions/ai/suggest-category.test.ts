import { describe, it, expect, vi, beforeEach } from "vitest";
import { suggestCategory } from "@/actions/ai/suggest-category";
import { runAiFeature } from "@/lib/ai/run";
import { getUserCategories } from "@/lib/db/categories";
import { aiJsonRespond } from "@/lib/ai/respond";
import { AI_INPUT_MAX_CHARS } from "@/lib/system-constants";
import { CATEGORY_PROMPT_VERSION } from "@/lib/ai/prompts/category";

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

describe("suggestCategory validation", () => {
  it("rejects a TRANSFER before touching the model", async () => {
    const res = await suggestCategory({ type: "TRANSFER" as never });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.reason).toBe("ai_error");
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockRespond).not.toHaveBeenCalled();
  });
});

describe("suggestCategory matching", () => {
  it("returns a matched suggestion with the prompt version", async () => {
    runInline();
    mockRespond.mockResolvedValue(
      ai('{ "category": "groceries", "confidence": "high", "merchant": "Amazon" }')
    );

    const res = await suggestCategory({ type: "EXPENSE", merchant: "AMZN MKTP" });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual({
        categoryId: "c1",
        categoryName: "Groceries",
        confidence: "high",
        merchant: "Amazon",
        promptVersion: CATEGORY_PROMPT_VERSION,
      });
    }
  });

  it("degrades to categoryId: null when the name matches nothing", async () => {
    runInline();
    mockRespond.mockResolvedValue(ai('{ "category": "Rent", "confidence": "low" }'));

    const res = await suggestCategory({ type: "EXPENSE", merchant: "Landlord" });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.categoryId).toBeNull();
      expect(res.data.categoryName).toBeNull();
    }
  });
});

describe("suggestCategory token control", () => {
  it("truncates over-long free-text to AI_INPUT_MAX_CHARS before the call", async () => {
    runInline();
    mockRespond.mockResolvedValue(ai('{ "category": "Dining" }'));

    const longMerchant = "x".repeat(AI_INPUT_MAX_CHARS + 500);
    await suggestCategory({ type: "EXPENSE", merchant: longMerchant });

    const sentInput = mockRespond.mock.calls[0][0].input;
    // The merchant must appear truncated, never at its original 2500-char length.
    expect(sentInput).not.toContain("x".repeat(AI_INPUT_MAX_CHARS + 1));
    expect(sentInput).toContain("x".repeat(AI_INPUT_MAX_CHARS));
  });

  it("forwards the candidate category names to the model", async () => {
    runInline();
    mockRespond.mockResolvedValue(ai('{ "category": "Dining" }'));

    await suggestCategory({ type: "EXPENSE", merchant: "Bistro" });
    const sentInput = mockRespond.mock.calls[0][0].input;
    expect(sentInput).toContain("Groceries");
    expect(sentInput).toContain("Dining");
  });
});
