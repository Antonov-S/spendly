import "server-only";
import { auth } from "@/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAiProfile } from "@/lib/db/ai";
import { track } from "@/lib/analytics/track";
import type { AiResultFeature } from "@/lib/analytics/events";
import { AiNoMatchError, AiParseError } from "@/lib/ai/errors";
import { AI_TIMEOUT_MS, type RateLimitName } from "@/lib/system-constants";
import type { AiJsonResponse } from "@/lib/ai/respond";

/** Precise outcome of an AI call — tagged into telemetry and the result. */
export type AiFailureReason =
  | "unauthenticated"
  | "not_pro"
  | "rate_limited"
  | "timeout"
  | "ai_error" // SDK threw / network / unknown
  | "parse_failed" // model output unparseable
  | "no_match"; // parsed, but matched nothing usable

export type AiResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; reason: AiFailureReason };

export interface AiTelemetry {
  usage?: AiJsonResponse["usage"];
  model?: string;
}

const AI_RUN_OUTPUT_MARKER = "__aiRunOutput";

interface AiRunOutput<T> {
  readonly [AI_RUN_OUTPUT_MARKER]: true;
  data: T;
  telemetry?: AiTelemetry;
}

export interface RunAiFeatureArgs<T> {
  /** Stable feature id — telemetry tag + per-feature burst-limit key prefix. */
  feature: AiResultFeature;
  /** Prompt version emitted in telemetry so iterations are measurable (§9). */
  promptVersion: number;
  /** Per-feature burst budget, keyed `${feature}:${userId}`. */
  burstLimit: RateLimitName;
  /** Friendly message shown to the user when this feature fails open. */
  failOpenMessage: string;
  /** Feature-specific work. Receives the authed userId + an AbortSignal. */
  run: (ctx: {
    userId: string;
    signal: AbortSignal;
  }) => Promise<T | AiRunOutput<T>>;
}

export function withAiTelemetry<T>(
  data: T,
  response: AiJsonResponse
): AiRunOutput<T> {
  return {
    [AI_RUN_OUTPUT_MARKER]: true,
    data,
    telemetry: {
      usage: response.usage,
      model: response.model,
    },
  };
}

function isAiRunOutput<T>(value: T | AiRunOutput<T>): value is AiRunOutput<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    AI_RUN_OUTPUT_MARKER in value &&
    value[AI_RUN_OUTPUT_MARKER] === true
  );
}

/** Maps a thrown error from `run()` to its telemetry `reason`. */
function reasonForThrow(error: unknown): AiFailureReason {
  if (error instanceof AiParseError) return "parse_failed";
  if (error instanceof AiNoMatchError) return "no_match";
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return "ai_error";
}

/**
 * The single cross-cutting spine every AI feature shares: authenticate → gate
 * on Pro (DB, never the JWT) → consume the GLOBAL monthly cost cap + a
 * per-feature burst cap → run under a timeout → emit exactly one telemetry
 * event → fail open. Feature actions supply only a prompt + parse step in
 * `run`; the policy lives here once and can't drift (see ai spec §3.4 / D6).
 *
 * Never throws to the caller — every path returns an `AiResult`.
 */
export async function runAiFeature<T>(
  args: RunAiFeatureArgs<T>
): Promise<AiResult<T>> {
  const fail = async (
    reason: AiFailureReason,
    error: string
  ): Promise<AiResult<T>> => {
    await track("ai_result", {
      feature: args.feature,
      prompt_version: args.promptVersion,
      outcome: "fail",
      reason,
    });
    return { success: false, error, reason };
  };

  // 1. auth
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return fail("unauthenticated", "You must be signed in.");
  }

  // 2. Pro gate (fresh DB read)
  const { isPro } = await getAiProfile(userId);
  if (!isPro) {
    return fail("not_pro", "AI suggestions are a Pro feature.");
  }

  // 3a. GLOBAL monthly cost ceiling — keyed by userId ONLY, shared across all
  //     AI features (the COGS rail). 3b. per-feature burst cap.
  const monthly = await checkRateLimit("aiMonthly", userId);
  if (!monthly.success) {
    return fail("rate_limited", args.failOpenMessage);
  }
  const burst = await checkRateLimit(
    args.burstLimit,
    `${args.feature}:${userId}`
  );
  if (!burst.success) {
    return fail("rate_limited", args.failOpenMessage);
  }

  // 4. run() under an AbortSignal timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const runOutput = await args.run({ userId, signal: controller.signal });
    const data = isAiRunOutput(runOutput) ? runOutput.data : runOutput;
    const telemetry = isAiRunOutput(runOutput)
      ? runOutput.telemetry
      : undefined;
    await track("ai_result", {
      feature: args.feature,
      prompt_version: args.promptVersion,
      outcome: "ok",
      reason: "ok",
      input_tokens: telemetry?.usage?.inputTokens,
      output_tokens: telemetry?.usage?.outputTokens,
      model: telemetry?.model,
    });
    return { success: true, data };
  } catch (error) {
    // 5. map the throw → reason. Logged once; capture is never blocked.
    console.error(`runAiFeature(${args.feature}) failed`, error);
    return fail(reasonForThrow(error), args.failOpenMessage);
  } finally {
    clearTimeout(timer);
  }
}
