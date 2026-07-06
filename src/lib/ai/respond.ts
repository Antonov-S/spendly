import "server-only";
import { getOpenAI } from "@/lib/ai/client";
import { AI_MODEL, AI_REASONING_EFFORT } from "@/lib/system-constants";

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiJsonResponse {
  text: string;
  usage?: AiUsage;
  model: string;
}

/**
 * Run one JSON-object Responses-API call and return the raw `output_text` plus
 * additive telemetry metadata for the Pro Value Review COGS clock.
 *
 * CRITICAL (carried from ai-auto-tag-spec §"CRITICAL" — load-bearing for
 * gpt-5-nano):
 *  - Use the Responses API, NOT Chat Completions. gpt-5-nano returns EMPTY
 *    content from `chat.completions.create()`.
 *  - `instructions` is the system prompt; `input` is the user content.
 *  - JSON mode is `text: { format: { type: "json_object" } }` (not
 *    `response_format`).
 *  - `max_tokens` is NOT supported. Do NOT use `zodResponseFormat`/structured
 *    output — it burns tokens with this model; parse manually instead.
 *  - The `json_object` guardrail REQUIRES the literal word "json" to appear in
 *    the `input` (the user message) — "JSON" in `instructions` does NOT satisfy
 *    it. We guarantee it here so every caller's contract holds regardless of how
 *    their prompt is worded (otherwise the API 400s before the model runs).
 */
export async function aiJsonRespond(args: {
  instructions: string;
  input: string;
  signal?: AbortSignal;
}): Promise<AiJsonResponse> {
  const input = /json/i.test(args.input)
    ? args.input
    : `${args.input}\n\nRespond with a single JSON object.`;
  const response = await getOpenAI().responses.create(
    {
      model: AI_MODEL,
      instructions: args.instructions,
      input,
      text: { format: { type: "json_object" } },
      // Shallow extraction/classification — `minimal` keeps latency ~1–2s (vs.
      // ~9–10s at the gpt-5 default `medium`, which breaches AI_TIMEOUT_MS and
      // fails the call open). See AI_REASONING_EFFORT.
      reasoning: { effort: AI_REASONING_EFFORT },
    },
    { signal: args.signal }
  );
  return {
    text: response.output_text,
    usage: response.usage
      ? {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        }
      : undefined,
    model: String(response.model || AI_MODEL),
  };
}
