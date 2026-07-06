import "server-only";

import { auth } from "@/auth";
import {
  ANALYTICS_ENABLED,
  ANALYTICS_PROPS_MAX_BYTES,
} from "@/lib/system-constants";
import { getAnalyticsOptOut, persistEvent } from "@/lib/db/analytics";
import {
  sanitizeProps,
  type AnalyticsEventName,
  type AnalyticsEventProps,
  type AnalyticsProps,
  type AnalyticsPropsInput,
} from "@/lib/analytics/events";

/**
 * Product telemetry funnel. AI features and product actions emit through this so
 * acceptance and engagement rates are measurable without touching call sites.
 *
 * Contract: event names + outcome counters ONLY. NO PII, NO financial values.
 * The props record stays open (`string | number | boolean`) so a later feature
 * can add keys (model, latency_ms, …) without a migration or touching existing
 * emit sites — but never repurpose `feature` / `prompt_version` / `reason`,
 * which the acceptance-rate rubric depends on.
 */
export async function track<TName extends AnalyticsEventName>(
  event: TName,
  props?: AnalyticsEventProps<TName>
): Promise<void>;
// Open overload — preserves the zero-call-site-changes contract for callers
// that pass a plain props object; runtime enforcement still applies.
export async function track(
  event: string,
  props?: AnalyticsProps
): Promise<void>;
// Implementation signature: `unknown` props so both overloads (including the
// generic mapped type, which is not assignable to a Record) are compatible.
// Narrowed back at the sanitize boundary.
export async function track(event: string, props?: unknown): Promise<void> {
  if (
    process.env.ANALYTICS_DEBUG === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    console.debug(`[track] ${event}`, props ?? {});
  }

  try {
    if (!ANALYTICS_ENABLED) return;

    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return;

    const optedOut = await getAnalyticsOptOut(userId);
    if (optedOut !== false) return;

    const sanitized = sanitizeProps(
      event,
      props as AnalyticsPropsInput | undefined
    );
    if (!sanitized.ok) return;

    const finalProps =
      JSON.stringify(sanitized.props).length > ANALYTICS_PROPS_MAX_BYTES
        ? { _truncated: true }
        : sanitized.props;

    await persistEvent(userId, event, finalProps);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("track failed", error);
    }
  }
}
