import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAiFeature } from "@/lib/ai/run";
import { AiParseError, AiNoMatchError } from "@/lib/ai/errors";
import { auth } from "@/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAiProfile } from "@/lib/db/ai";
import { track } from "@/lib/analytics/track";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/db/ai", () => ({ getAiProfile: vi.fn() }));
vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));

const mockAuth = vi.mocked(auth);
const mockRate = vi.mocked(checkRateLimit);
const mockProfile = vi.mocked(getAiProfile);
const mockTrack = vi.mocked(track);

const ALLOW = { success: true } as never;
const DENY = { success: false } as never;

function baseArgs<T>(run: () => Promise<T>) {
  return {
    feature: "category_suggest",
    promptVersion: 1,
    burstLimit: "aiSuggest" as const,
    failOpenMessage: "fail open",
    run,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
  mockProfile.mockResolvedValue({ isPro: true });
  mockRate.mockResolvedValue(ALLOW);
});

describe("runAiFeature gating", () => {
  it("rejects an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null as never);
    const res = await runAiFeature(baseArgs(async () => "x"));
    expect(res).toMatchObject({ success: false, reason: "unauthenticated" });
  });

  it("rejects a non-Pro user", async () => {
    mockProfile.mockResolvedValue({ isPro: false });
    const res = await runAiFeature(baseArgs(async () => "x"));
    expect(res).toMatchObject({ success: false, reason: "not_pro" });
  });

  it("rejects when the global monthly cap is exhausted", async () => {
    mockRate.mockResolvedValueOnce(DENY); // aiMonthly checked first
    const run = vi.fn(async () => "x");
    const res = await runAiFeature(baseArgs(run));
    expect(res).toMatchObject({ success: false, reason: "rate_limited" });
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects when the per-feature burst cap is exhausted", async () => {
    mockRate
      .mockResolvedValueOnce(ALLOW) // aiMonthly
      .mockResolvedValueOnce(DENY); // aiSuggest burst
    const res = await runAiFeature(baseArgs(async () => "x"));
    expect(res).toMatchObject({ success: false, reason: "rate_limited" });
  });

  it("passes the burst budget the per-feature composite key", async () => {
    await runAiFeature(baseArgs(async () => "x"));
    expect(mockRate).toHaveBeenNthCalledWith(1, "aiMonthly", "u1");
    expect(mockRate).toHaveBeenNthCalledWith(2, "aiSuggest", "category_suggest:u1");
  });
});

describe("runAiFeature outcomes + telemetry", () => {
  it("returns the data on success and emits one ok event", async () => {
    const res = await runAiFeature(baseArgs(async () => ({ v: 1 })));
    expect(res).toEqual({ success: true, data: { v: 1 } });
    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith("ai_result", {
      feature: "category_suggest",
      prompt_version: 1,
      outcome: "ok",
      reason: "ok",
    });
  });

  it("maps AiParseError -> parse_failed", async () => {
    const res = await runAiFeature(
      baseArgs(async () => {
        throw new AiParseError();
      })
    );
    expect(res).toMatchObject({ success: false, reason: "parse_failed" });
  });

  it("maps AiNoMatchError -> no_match", async () => {
    const res = await runAiFeature(
      baseArgs(async () => {
        throw new AiNoMatchError();
      })
    );
    expect(res).toMatchObject({ success: false, reason: "no_match" });
  });

  it("maps an AbortError -> timeout", async () => {
    const res = await runAiFeature(
      baseArgs(async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      })
    );
    expect(res).toMatchObject({ success: false, reason: "timeout" });
  });

  it("maps any other throw -> ai_error and never throws to the caller", async () => {
    const res = await runAiFeature(
      baseArgs(async () => {
        throw new Error("boom");
      })
    );
    expect(res).toMatchObject({ success: false, reason: "ai_error" });
  });

  it("emits exactly one ai_result event with the failure reason", async () => {
    await runAiFeature(
      baseArgs(async () => {
        throw new AiParseError();
      })
    );
    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith("ai_result", {
      feature: "category_suggest",
      prompt_version: 1,
      outcome: "fail",
      reason: "parse_failed",
    });
  });
});
