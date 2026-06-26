import "server-only";

/**
 * No-op telemetry shim. AI features (and later product analytics) emit through
 * this so acceptance rate is measurable from day one; POST-MVP §0 swaps the
 * body for the real sink without touching any call site.
 *
 * Contract: event names + outcome counters ONLY. NO PII, NO financial values.
 * The props record stays open (`string | number | boolean`) so a later feature
 * can add keys (model, latency_ms, …) without a migration or touching existing
 * emit sites — but never repurpose `feature` / `prompt_version` / `reason`,
 * which the acceptance-rate rubric depends on.
 */
export async function track(
  event: string,
  props?: Record<string, string | number | boolean>
): Promise<void> {
  if (process.env.ANALYTICS_DEBUG === "true") {
    console.debug(`[track] ${event}`, props ?? {});
  }
}
