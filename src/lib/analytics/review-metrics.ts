import type { AiResultFeature } from "@/lib/analytics/events";

export const AI_REVIEW_THRESHOLDS = {
  expand: 0.6,
  iterate: 0.3,
  monthlyReviewExpand: 0.4,
  monthlyReviewIterate: 0.15,
  monthlyReviewRepeatExpand: 0.25,
  minRunDenominator: 20,
  minUserDenominator: 10,
} as const;

export const AI_REVIEW_FEATURES = [
  "category_suggest",
  "transaction_parse",
  "monthly_review",
  "budget_suggest",
] as const satisfies readonly AiResultFeature[];

const AI_FAILURE_REASONS = [
  "unauthenticated",
  "not_pro",
  "rate_limited",
  "timeout",
  "ai_error",
  "parse_failed",
  "no_match",
] as const;

type AiFailureReason = (typeof AI_FAILURE_REASONS)[number];
export type ReviewVerdict = "expand" | "iterate" | "retire" | "insufficient";
export type CostMeasurement =
  | "measured"
  | "partial"
  | "manual-estimate-required";

export interface ReviewEventRow {
  name: string;
  props: Record<string, unknown> | null;
  userId: string;
  createdAt: Date;
}

export interface ReviewUserRow {
  id: string;
  isPro: boolean;
}

export interface ReviewWindow {
  from: Date;
  to: Date;
}

export interface ReviewCoverage {
  activeUsers: number;
  activeProUsers: number;
  requestedWindowDays: number;
  actualSpanDays: number;
  tokenCoverageFrom: Date | null;
  tokenCoverageShare: number;
  costMeasurement: CostMeasurement;
  unpricedModels: string[];
  unpricedTokenShare: number;
  midWindowUpgradeClicks: number;
}

export interface RateMetric {
  numerator: number;
  denominator: number;
  rate: number | null;
  verdict: ReviewVerdict;
  smallN: boolean;
}

export interface ReliabilityMetrics {
  okRuns: number;
  failRuns: number;
  failReasons: Record<AiFailureReason, number>;
}

export interface GuardHealthMetrics {
  dropped: number;
  kept: number;
  dropRate: number | null;
}

export interface CategorySuggestMetrics {
  served: number;
  accepted: number;
  overridden: number;
  abandonment: number;
  acceptance: RateMetric;
  reliability: ReliabilityMetrics;
}

export interface TransactionParseMetrics {
  served: number;
  confirmed: number;
  cleanConfirmed: number;
  heavyEdited: number;
  acceptance: RateMetric;
  reliability: ReliabilityMetrics;
}

export interface MonthlyReviewMetrics {
  generators: number;
  activeProUsers: number;
  engagement: RateMetric;
  repeatGenerators: number;
  repeatRate: RateMetric;
  verdict: ReviewVerdict;
  guardHealth: GuardHealthMetrics;
  reliability: ReliabilityMetrics;
}

export interface BudgetSuggestMetrics {
  runs: number;
  accepts: number;
  editedAccepts: number;
  runUsers: number;
  acceptUsers: number;
  acceptance: RateMetric;
  panelYield: RateMetric;
  phrasingDegraded: number;
  guardHealth: GuardHealthMetrics;
  reliability: ReliabilityMetrics;
}

export interface AiFeatureReports {
  categorySuggest: CategorySuggestMetrics;
  transactionParse: TransactionParseMetrics;
  monthlyReview: MonthlyReviewMetrics;
  budgetSuggest: BudgetSuggestMetrics;
}

export interface CohortMetrics {
  users: number;
  totalActiveDays: number;
  averageActiveDays: number;
  totalActiveWeeks: number;
  averageActiveWeeks: number;
  transactionCreated: number;
  budgetCreated: number;
}

export interface CrossFeatureMetrics {
  activeProAdopters: CohortMetrics;
  activeProNonAdopters: CohortMetrics;
  upgradeClicksEndingPro: number;
}

export interface ModelTokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  priced: boolean;
}

export interface CogsMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  byModel: ModelTokenUsage[];
}

export interface ProValueReviewReport {
  coverage: ReviewCoverage;
  features: AiFeatureReports;
  crossFeature: CrossFeatureMetrics;
  cogs: CogsMetrics;
}

export interface BuildProValueReviewOptions {
  pricedModels?: readonly string[];
}

function emptyFailReasons(): Record<AiFailureReason, number> {
  return {
    unauthenticated: 0,
    not_pro: 0,
    rate_limited: 0,
    timeout: 0,
    ai_error: 0,
    parse_failed: 0,
    no_match: 0,
  };
}

function daysBetween(from: Date, to: Date): number {
  const ms = Math.max(0, to.getTime() - from.getTime());
  return ms / (24 * 60 * 60 * 1000);
}

function distinct<T>(values: Iterable<T>): Set<T> {
  return new Set(values);
}

function propString(row: ReviewEventRow, key: string): string | null {
  const value = row.props?.[key];
  return typeof value === "string" ? value : null;
}

function propNumber(row: ReviewEventRow, key: string): number | null {
  const value = row.props?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function propBoolean(row: ReviewEventRow, key: string): boolean | null {
  const value = row.props?.[key];
  return typeof value === "boolean" ? value : null;
}

function isFeature(value: string | null): value is AiResultFeature {
  return AI_REVIEW_FEATURES.includes(value as AiResultFeature);
}

function featureOf(row: ReviewEventRow): AiResultFeature | null {
  const feature = propString(row, "feature");
  return isFeature(feature) ? feature : null;
}

function isAiResult(row: ReviewEventRow, feature: AiResultFeature): boolean {
  return row.name === "ai_result" && featureOf(row) === feature;
}

function isOkRun(row: ReviewEventRow, feature: AiResultFeature): boolean {
  return (
    isAiResult(row, feature) &&
    propString(row, "outcome") === "ok" &&
    propString(row, "reason") === "ok"
  );
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function verdictForRate(
  value: number | null,
  n: number
): ReviewVerdict {
  if (value === null || n < AI_REVIEW_THRESHOLDS.minRunDenominator) {
    return "insufficient";
  }
  if (value >= AI_REVIEW_THRESHOLDS.expand) return "expand";
  if (value >= AI_REVIEW_THRESHOLDS.iterate) return "iterate";
  return "retire";
}

function userVerdictForRate(value: number | null, n: number): ReviewVerdict {
  if (value === null || n < AI_REVIEW_THRESHOLDS.minUserDenominator) {
    return "insufficient";
  }
  if (value >= AI_REVIEW_THRESHOLDS.expand) return "expand";
  if (value >= AI_REVIEW_THRESHOLDS.iterate) return "iterate";
  return "retire";
}

function rateMetric(
  numerator: number,
  denominator: number,
  sample: "run" | "user"
): RateMetric {
  const value = rate(numerator, denominator);
  const min =
    sample === "user"
      ? AI_REVIEW_THRESHOLDS.minUserDenominator
      : AI_REVIEW_THRESHOLDS.minRunDenominator;
  return {
    numerator,
    denominator,
    rate: value,
    verdict:
      sample === "user"
        ? userVerdictForRate(value, denominator)
        : verdictForRate(value, denominator),
    smallN: denominator < min,
  };
}

function reliabilityFor(
  events: ReviewEventRow[],
  feature: AiResultFeature
): ReliabilityMetrics {
  const failReasons = emptyFailReasons();
  let okRuns = 0;
  let failRuns = 0;

  for (const event of events) {
    if (!isAiResult(event, feature)) continue;
    if (propString(event, "outcome") === "ok") {
      okRuns += 1;
      continue;
    }
    failRuns += 1;
    const reason = propString(event, "reason");
    if (AI_FAILURE_REASONS.includes(reason as AiFailureReason)) {
      failReasons[reason as AiFailureReason] += 1;
    }
  }

  return { okRuns, failRuns, failReasons };
}

function guardHealthFor(
  events: ReviewEventRow[],
  feature: "monthly_review" | "budget_suggest"
): GuardHealthMetrics {
  let dropped = 0;
  let kept = 0;
  for (const event of events) {
    if (event.name !== "ai_numeric_guard" || featureOf(event) !== feature) {
      continue;
    }
    dropped += propNumber(event, "dropped_count") ?? 0;
    kept += propNumber(event, "kept_count") ?? 0;
  }
  return { dropped, kept, dropRate: rate(dropped, dropped + kept) };
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoWeekKey(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function buildCategorySuggest(
  events: ReviewEventRow[]
): CategorySuggestMetrics {
  const served = events.filter((event) => isOkRun(event, "category_suggest")).length;
  const accepted = events.filter(
    (event) => event.name === "ai_category_accepted"
  ).length;
  const overridden = events.filter(
    (event) => event.name === "ai_category_overridden"
  ).length;
  return {
    served,
    accepted,
    overridden,
    abandonment: Math.max(0, served - accepted - overridden),
    acceptance: rateMetric(accepted, accepted + overridden, "run"),
    reliability: reliabilityFor(events, "category_suggest"),
  };
}

function buildTransactionParse(
  events: ReviewEventRow[]
): TransactionParseMetrics {
  const served = events.filter((event) => isOkRun(event, "transaction_parse")).length;
  const confirmations = events.filter((event) => event.name === "ai_parse_confirmed");
  const cleanConfirmed = confirmations.filter((event) => {
    const edited = propBoolean(event, "edited");
    const editedFieldCount = propNumber(event, "edited_field_count") ?? 0;
    return edited === false || editedFieldCount <= 1;
  }).length;

  return {
    served,
    confirmed: confirmations.length,
    cleanConfirmed,
    heavyEdited: confirmations.length - cleanConfirmed,
    acceptance: rateMetric(cleanConfirmed, served, "run"),
    reliability: reliabilityFor(events, "transaction_parse"),
  };
}

function monthlyReviewVerdict(
  engagement: RateMetric,
  repeat: RateMetric
): ReviewVerdict {
  if (engagement.smallN || engagement.rate === null) return "insufficient";
  if (
    engagement.rate >= AI_REVIEW_THRESHOLDS.monthlyReviewExpand &&
    repeat.rate !== null &&
    repeat.rate >= AI_REVIEW_THRESHOLDS.monthlyReviewRepeatExpand
  ) {
    return "expand";
  }
  if (engagement.rate >= AI_REVIEW_THRESHOLDS.monthlyReviewIterate) {
    return "iterate";
  }
  return "retire";
}

function buildMonthlyReview(
  events: ReviewEventRow[],
  activeProUserIds: Set<string>
): MonthlyReviewMetrics {
  const okRuns = events.filter((event) => isOkRun(event, "monthly_review"));
  const generatorIds = distinct(okRuns.map((event) => event.userId));
  const weeksByUser = new Map<string, Set<string>>();
  for (const event of okRuns) {
    const weeks = weeksByUser.get(event.userId) ?? new Set<string>();
    weeks.add(isoWeekKey(event.createdAt));
    weeksByUser.set(event.userId, weeks);
  }
  const repeatGenerators = [...weeksByUser.values()].filter(
    (weeks) => weeks.size >= 2
  ).length;
  const engagement = rateMetric(
    generatorIds.size,
    activeProUserIds.size,
    "user"
  );
  const repeatRate = rateMetric(repeatGenerators, generatorIds.size, "user");

  return {
    generators: generatorIds.size,
    activeProUsers: activeProUserIds.size,
    engagement,
    repeatGenerators,
    repeatRate,
    verdict: monthlyReviewVerdict(engagement, repeatRate),
    guardHealth: guardHealthFor(events, "monthly_review"),
    reliability: reliabilityFor(events, "monthly_review"),
  };
}

function buildBudgetSuggest(events: ReviewEventRow[]): BudgetSuggestMetrics {
  const okRuns = events.filter((event) => isOkRun(event, "budget_suggest"));
  const acceptedEvents = events.filter(
    (event) => event.name === "ai_budget_suggest_accepted"
  );
  const dismissedEvents = events.filter(
    (event) => event.name === "ai_budget_suggest_dismissed"
  );
  const acceptUsers = distinct(acceptedEvents.map((event) => event.userId));
  const runUsers = distinct(okRuns.map((event) => event.userId));
  const suggestedFromDismissals = dismissedEvents.reduce(
    (sum, event) => sum + (propNumber(event, "suggested_count") ?? 0),
    0
  );
  const acceptedFromDismissals = dismissedEvents.reduce(
    (sum, event) => sum + (propNumber(event, "accepted_count") ?? 0),
    0
  );

  return {
    runs: okRuns.length,
    accepts: acceptedEvents.length,
    editedAccepts: acceptedEvents.filter(
      (event) => propBoolean(event, "edited") === true
    ).length,
    runUsers: runUsers.size,
    acceptUsers: acceptUsers.size,
    acceptance: rateMetric(acceptUsers.size, runUsers.size, "user"),
    panelYield: rateMetric(acceptedFromDismissals, suggestedFromDismissals, "run"),
    phrasingDegraded: events.filter(
      (event) => event.name === "ai_phrasing_degraded"
    ).length,
    guardHealth: guardHealthFor(events, "budget_suggest"),
    reliability: reliabilityFor(events, "budget_suggest"),
  };
}

function cohortFor(events: ReviewEventRow[], userIds: Set<string>): CohortMetrics {
  const activeDaysByUser = new Map<string, Set<string>>();
  const activeWeeksByUser = new Map<string, Set<string>>();
  let transactionCreated = 0;
  let budgetCreated = 0;

  for (const event of events) {
    if (!userIds.has(event.userId)) continue;
    const days = activeDaysByUser.get(event.userId) ?? new Set<string>();
    days.add(dateKey(event.createdAt));
    activeDaysByUser.set(event.userId, days);

    const weeks = activeWeeksByUser.get(event.userId) ?? new Set<string>();
    weeks.add(isoWeekKey(event.createdAt));
    activeWeeksByUser.set(event.userId, weeks);

    if (event.name === "transaction_created") transactionCreated += 1;
    if (event.name === "budget_created") budgetCreated += 1;
  }

  const totalActiveDays = [...activeDaysByUser.values()].reduce(
    (sum, days) => sum + days.size,
    0
  );
  const totalActiveWeeks = [...activeWeeksByUser.values()].reduce(
    (sum, weeks) => sum + weeks.size,
    0
  );
  const users = userIds.size;

  return {
    users,
    totalActiveDays,
    averageActiveDays: users > 0 ? totalActiveDays / users : 0,
    totalActiveWeeks,
    averageActiveWeeks: users > 0 ? totalActiveWeeks / users : 0,
    transactionCreated,
    budgetCreated,
  };
}

function buildCrossFeature(
  events: ReviewEventRow[],
  activeProUserIds: Set<string>,
  usersById: Map<string, ReviewUserRow>
): CrossFeatureMetrics {
  const adopterIds = distinct(
    events
      .filter(
        (event) =>
          event.name === "ai_result" &&
          propString(event, "outcome") === "ok" &&
          isFeature(propString(event, "feature"))
      )
      .map((event) => event.userId)
      .filter((userId) => activeProUserIds.has(userId))
  );
  const nonAdopterIds = new Set(
    [...activeProUserIds].filter((userId) => !adopterIds.has(userId))
  );
  const upgradeClicksEndingPro = distinct(
    events
      .filter((event) => event.name === "upgrade_to_pro_clicked")
      .map((event) => event.userId)
      .filter((userId) => usersById.get(userId)?.isPro === true)
  ).size;

  return {
    activeProAdopters: cohortFor(events, adopterIds),
    activeProNonAdopters: cohortFor(events, nonAdopterIds),
    upgradeClicksEndingPro,
  };
}

function tokenRows(events: ReviewEventRow[]): ReviewEventRow[] {
  return events.filter(
    (event) =>
      event.name === "ai_result" &&
      propNumber(event, "input_tokens") !== null &&
      propNumber(event, "output_tokens") !== null &&
      propString(event, "model") !== null
  );
}

function buildCogs(
  events: ReviewEventRow[],
  pricedModels: Set<string>
): CogsMetrics {
  const byModel = new Map<string, ModelTokenUsage>();
  for (const event of tokenRows(events)) {
    const model = propString(event, "model");
    const inputTokens = propNumber(event, "input_tokens");
    const outputTokens = propNumber(event, "output_tokens");
    if (!model || inputTokens === null || outputTokens === null) continue;

    const current =
      byModel.get(model) ??
      ({
        model,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        priced: pricedModels.has(model),
      } satisfies ModelTokenUsage);
    current.inputTokens += inputTokens;
    current.outputTokens += outputTokens;
    current.totalTokens += inputTokens + outputTokens;
    byModel.set(model, current);
  }

  const rows = [...byModel.values()].sort((a, b) =>
    a.model.localeCompare(b.model)
  );
  const inputTokens = rows.reduce((sum, row) => sum + row.inputTokens, 0);
  const outputTokens = rows.reduce((sum, row) => sum + row.outputTokens, 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    byModel: rows,
  };
}

function buildCoverage(
  events: ReviewEventRow[],
  usersById: Map<string, ReviewUserRow>,
  window: ReviewWindow,
  cogs: CogsMetrics
): ReviewCoverage {
  const activeUserIds = distinct(events.map((event) => event.userId));
  const activeProUserIds = distinct(
    [...activeUserIds].filter((userId) => usersById.get(userId)?.isPro === true)
  );
  const sortedEvents = [...events].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );
  const first = sortedEvents[0]?.createdAt ?? null;
  const last = sortedEvents.at(-1)?.createdAt ?? null;
  const tokens = tokenRows(events).sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );
  const tokenCoverageFrom = tokens[0]?.createdAt ?? null;
  const requestedWindowDays = daysBetween(window.from, window.to);
  const tokenCoverageShare =
    tokenCoverageFrom && requestedWindowDays > 0
      ? Math.min(1, daysBetween(tokenCoverageFrom, window.to) / requestedWindowDays)
      : 0;
  const unpricedTokenTotal = cogs.byModel
    .filter((row) => !row.priced)
    .reduce((sum, row) => sum + row.totalTokens, 0);
  const unpricedTokenShare =
    cogs.totalTokens > 0 ? unpricedTokenTotal / cogs.totalTokens : 0;
  const unpricedModels = cogs.byModel
    .filter((row) => !row.priced)
    .map((row) => row.model);
  const costMeasurement: CostMeasurement =
    tokenCoverageShare === 0 || unpricedTokenShare === 1
      ? "manual-estimate-required"
      : tokenCoverageShare < 1 || unpricedTokenShare > 0
        ? "partial"
        : "measured";

  return {
    activeUsers: activeUserIds.size,
    activeProUsers: activeProUserIds.size,
    requestedWindowDays,
    actualSpanDays: first && last ? daysBetween(first, last) : 0,
    tokenCoverageFrom,
    tokenCoverageShare,
    costMeasurement,
    unpricedModels,
    unpricedTokenShare,
    midWindowUpgradeClicks: distinct(
      events
        .filter((event) => event.name === "upgrade_to_pro_clicked")
        .map((event) => event.userId)
    ).size,
  };
}

export function buildProValueReviewReport(
  events: ReviewEventRow[],
  users: ReviewUserRow[],
  window: ReviewWindow,
  options: BuildProValueReviewOptions = {}
): ProValueReviewReport {
  const pricedModels = new Set(options.pricedModels ?? []);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const activeProUserIds = distinct(
    events
      .map((event) => event.userId)
      .filter((userId) => usersById.get(userId)?.isPro === true)
  );
  const cogs = buildCogs(events, pricedModels);

  return {
    coverage: buildCoverage(events, usersById, window, cogs),
    features: {
      categorySuggest: buildCategorySuggest(events),
      transactionParse: buildTransactionParse(events),
      monthlyReview: buildMonthlyReview(events, activeProUserIds),
      budgetSuggest: buildBudgetSuggest(events),
    },
    crossFeature: buildCrossFeature(events, activeProUserIds, usersById),
    cogs,
  };
}
