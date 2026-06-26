/**
 * Sentinel error classes for the AI layer. Kept free of the OpenAI SDK import
 * so they're importable anywhere (pure helpers, tests) and so `runAiFeature`
 * can map them to a precise telemetry `reason` without pulling in the client.
 */

/** Thrown when the model's output cannot be parsed into a usable shape. */
export class AiParseError extends Error {
  constructor(message = "AI output could not be parsed.") {
    super(message);
    this.name = "AiParseError";
  }
}

/**
 * Thrown when a parsed result matched nothing usable AND an empty result is
 * genuinely useless for the feature. (Auto-categorization does NOT throw this —
 * it degrades to `categoryId: null`; reserve it for features like NL-parse
 * where no parseable value means there's nothing to suggest.)
 */
export class AiNoMatchError extends Error {
  constructor(message = "AI produced no usable match.") {
    super(message);
    this.name = "AiNoMatchError";
  }
}
