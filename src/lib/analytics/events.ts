import { ANALYTICS_STRING_PROP_MAX } from "@/lib/system-constants";

export const COUNT_BUCKETS = [
  "0",
  "1-10",
  "11-100",
  "101-1000",
  "1000+",
] as const;

type PrimitiveProp = "string" | "number" | "boolean";
type EventPropSpec = PrimitiveProp | readonly string[];
type EventSpec = Record<string, EventPropSpec>;
type EventRegistry = Record<string, EventSpec>;

export const ANALYTICS_EVENTS = {
  ai_result: {
    feature: [
      "category_suggest",
      "transaction_parse",
      "monthly_review",
      "budget_suggest",
    ],
    prompt_version: "number",
    outcome: ["ok", "fail"],
    reason: [
      "ok",
      "unauthenticated",
      "not_pro",
      "rate_limited",
      "timeout",
      "ai_error",
      "parse_failed",
      "no_match",
    ],
  },
  ai_category_accepted: {
    feature: ["category_suggest"],
    prompt_version: "number",
  },
  ai_category_overridden: {
    feature: ["category_suggest"],
    prompt_version: "number",
  },
  ai_parse_confirmed: {
    feature: ["transaction_parse"],
    prompt_version: "number",
    edited: "boolean",
    edited_field_count: "number",
    edited_fields: "string", // comma-separated parsed-field codes, never values
  },
  ai_budget_suggest_accepted: {
    feature: ["budget_suggest"],
    prompt_version: "number",
    edited: "boolean",
  },
  ai_budget_suggest_dismissed: {
    feature: ["budget_suggest"],
    prompt_version: "number",
    suggested_count: "number",
    accepted_count: "number",
  },
  ai_numeric_guard: {
    feature: ["monthly_review", "budget_suggest"],
    prompt_version: "number",
    dropped_count: "number",
    kept_count: "number",
  },
  ai_phrasing_degraded: {
    feature: ["budget_suggest"],
    prompt_version: "number",
    reason: ["parse_failed", "timeout", "ai_error"],
  },
  notifications_derived: {
    total: "number",
    "budget-over": "number",
    "budget-risk": "number",
    draft: "number",
    "goal-overdue": "number",
  },
  notification_panel_opened: {
    total: "number",
  },
  notification_item_clicked: {
    kind: ["budget-over", "budget-risk", "draft", "goal-overdue"],
  },
  recurring_suggested: {
    detected: "number",
    surfaced: "number",
    weekly: "number",
    monthly: "number",
  },
  recurring_suggestion_accepted: {
    cadence: ["WEEKLY", "MONTHLY"],
  },
  recurring_suggestion_dismissed: {
    cadence: ["WEEKLY", "MONTHLY"],
  },
  favorite_created: {
    favoriteCount: "number",
  },
  favorite_deleted: {
    favoriteCount: "number",
  },
  favorite_used: {
    hasAmount: "boolean",
  },
  transaction_created: {
    type: ["INCOME", "EXPENSE"],
    isSplit: "boolean",
    tagCount: "number",
  },
  transfer_created: {},
  draft_confirmed: {
    cadence: ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"],
  },
  budget_created: {
    rollover: "boolean",
  },
  goal_created: {},
  export_run: {
    format: ["csv", "json"],
    scoped: "boolean",
  },
  import_committed: {
    format: ["csv", "json"],
    createdBucket: COUNT_BUCKETS,
    skippedBucket: COUNT_BUCKETS,
  },
  upgrade_to_pro_clicked: {
    period: ["monthly", "yearly"],
  },
} as const satisfies EventRegistry;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;
export type AnalyticsProps = Record<string, string | number | boolean>;
// Callers may pass a shape with optional keys (whose values read as `T |
// undefined`); the sink strips undefined during sanitization.
export type AnalyticsPropsInput = Record<
  string,
  string | number | boolean | undefined
>;

/** The four AI features tracked by `ai_result` — the single source of truth. */
export type AiResultFeature =
  (typeof ANALYTICS_EVENTS)["ai_result"]["feature"][number];

type ValueForSpec<T> = T extends "number"
  ? number
  : T extends "boolean"
    ? boolean
    : T extends "string"
      ? string
      : T extends readonly (infer U)[]
        ? U
        : never;

export type AnalyticsEventProps<TName extends AnalyticsEventName> = {
  [K in keyof (typeof ANALYTICS_EVENTS)[TName]]?: ValueForSpec<
    (typeof ANALYTICS_EVENTS)[TName][K]
  >;
};

export type SanitizeResult =
  | { ok: true; props: AnalyticsProps }
  | { ok: false; reason: "unregistered_event" };

// Open string props are still codes, not prose. Commas are allowed only to keep
// the existing `edited_fields` comma-separated code list unchanged.
const STRING_PROP_PATTERN = /^[\w.:+,-]+$/;

function warn(message: string) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(message);
  }
}

function isRegisteredEvent(event: string): event is AnalyticsEventName {
  return Object.prototype.hasOwnProperty.call(ANALYTICS_EVENTS, event);
}

function acceptsValue(
  spec: EventPropSpec,
  value: unknown
): value is string | number | boolean {
  if (Array.isArray(spec)) {
    return typeof value === "string" && spec.includes(value);
  }
  if (spec === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (spec === "boolean") {
    return typeof value === "boolean";
  }
  return (
    typeof value === "string" &&
    value.length <= ANALYTICS_STRING_PROP_MAX &&
    STRING_PROP_PATTERN.test(value)
  );
}

export function sanitizeProps(
  event: string,
  props?: AnalyticsPropsInput
): SanitizeResult {
  if (!isRegisteredEvent(event)) {
    warn(`Analytics event "${event}" is not registered; dropping.`);
    return { ok: false, reason: "unregistered_event" };
  }

  const spec: EventSpec = ANALYTICS_EVENTS[event];
  const sanitized: AnalyticsProps = {};
  const input = props ?? {};

  for (const key of Object.keys(input)) {
    if (!Object.prototype.hasOwnProperty.call(spec, key)) {
      warn(`Analytics prop "${event}.${key}" is not registered; stripping.`);
      continue;
    }

    const value = input[key];
    const propSpec = spec[key];
    if (propSpec && acceptsValue(propSpec, value)) {
      sanitized[key] = value;
    } else {
      warn(`Analytics prop "${event}.${key}" has an invalid value; stripping.`);
    }
  }

  return { ok: true, props: sanitized };
}

export function bucketCount(n: number): (typeof COUNT_BUCKETS)[number] {
  if (n <= 0) return "0";
  if (n <= 10) return "1-10";
  if (n <= 100) return "11-100";
  if (n <= 1000) return "101-1000";
  return "1000+";
}
