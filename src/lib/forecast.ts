import { advanceNextOccurrence, type RecurringType } from "@/lib/recurring";
import { startOfUtcDay } from "@/lib/date";
import { round2 } from "@/lib/money";
import { FORECAST_HORIZON_DAYS } from "@/lib/system-constants";
import type { RecurringCadence } from "@/generated/prisma/client";

/**
 * Cash-flow forecast engine (cash-flow-forecast spec §4).
 *
 * Pure and deterministic: identical input → identical output, no I/O, no
 * randomness, injectable `now`. Folds pending recurring drafts + future
 * template occurrences over a fixed horizon into a daily end-of-day balance
 * series, anchored on the caller-supplied current balance (the hero number).
 *
 * The engine never touches the database or derives a balance itself — the
 * anchor `startBalance` is passed in so the forecast can never disagree with
 * the hero balance beside it (spec D6).
 */

const MS_PER_DAY = 86_400_000;

export interface ForecastPoint {
  date: Date; // UTC midnight
  balance: number; // round2
}

export interface ForecastResult {
  points: ForecastPoint[]; // length = horizonDays + 1
  low: ForecastPoint; // min balance; earliest day wins a tie
  end: ForecastPoint; // points[points.length - 1]
  /** Scheduled events inside the window — 0 means "nothing to project" (§8 hides the card). */
  eventCount: number;
}

interface TemplateInput {
  type: RecurringType;
  amount: number; // positive magnitude
  cadence: RecurringCadence;
  nextOccurrence: Date;
  hasPendingDraft: boolean;
}

interface DraftInput {
  type: RecurringType;
  amount: number; // positive magnitude
  suggestedDate: Date;
}

/** A signed event bucketed onto a day index within the window. */
interface DayEvent {
  dayIndex: number; // 0..horizonDays
  amount: number; // signed
}

/** Derive the ledger sign from the recurring type (mirrors `confirmDraft`). */
function signedAmount(type: RecurringType, amount: number): number {
  return type === "EXPENSE" ? -amount : amount;
}

/** Whole-day difference between two UTC-midnight dates (`later - earlier`). */
function dayDiff(earlier: Date, later: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / MS_PER_DAY);
}

/**
 * Expand one active template into its signed events inside `[today, end]`.
 *
 * - Start from `nextOccurrence`, unless a PENDING draft already represents the
 *   head of the series — then start one step past it. This skip rule is
 *   load-bearing: while a draft is PENDING the template's `nextOccurrence` is
 *   *not yet advanced*, so projecting it would double-count the occurrence the
 *   draft already contributes (§4.1.2).
 * - Occurrences before `today` (an overdue template that hasn't minted a draft)
 *   clamp to day 0 — they're due now and the projection assumes scheduled items
 *   happen. Stepping continues from the *unclamped* date so the rhythm holds.
 * - The real terminator is `cursor <= horizonEnd`: for a template due today or
 *   later, at most horizonDays + 1 occurrences fit; a deeply-overdue template
 *   steps through its whole backlog (all clamped to day 0) before reaching the
 *   window, which is finite and fast (every cadence advances ≥ 1 day). The
 *   MAX_ITERATIONS cap and the non-advancement break are pure infinite-loop
 *   backstops that a correct `advanceNextOccurrence` never triggers.
 */
function expandTemplateEvents(
  template: TemplateInput,
  today: Date,
  horizonEnd: Date
): DayEvent[] {
  const events: DayEvent[] = [];
  const amount = signedAmount(template.type, template.amount);

  let cursor = startOfUtcDay(template.nextOccurrence);
  if (template.hasPendingDraft) {
    cursor = startOfUtcDay(advanceNextOccurrence(cursor, template.cadence));
  }

  // ~273 years of daily stepping — unreachable for real data; the horizon check
  // is the true bound. Guards only against a pathological non-advancing cadence.
  const MAX_ITERATIONS = 100_000;
  let prev = -Infinity;
  let guard = 0;

  while (cursor <= horizonEnd && guard < MAX_ITERATIONS) {
    const t = cursor.getTime();
    if (t <= prev) break; // cadence failed to advance (never expected)
    prev = t;
    guard += 1;
    const dayIndex = cursor < today ? 0 : dayDiff(today, cursor);
    events.push({ dayIndex, amount });
    cursor = startOfUtcDay(advanceNextOccurrence(cursor, template.cadence));
  }

  return events;
}

/**
 * Build the daily projected-balance series from the anchor balance + scheduled
 * items (pending drafts + active templates) over `[today, today + horizonDays]`.
 */
export function buildCashflowForecast(input: {
  startBalance: number;
  templates: ReadonlyArray<TemplateInput>;
  drafts: ReadonlyArray<DraftInput>;
  now?: Date;
  horizonDays?: number;
}): ForecastResult {
  const { startBalance, templates, drafts } = input;
  const horizonDays = input.horizonDays ?? FORECAST_HORIZON_DAYS;
  const today = startOfUtcDay(input.now ?? new Date());
  const horizonEnd = new Date(today.getTime() + horizonDays * MS_PER_DAY);

  // Per-day signed deltas, indexed 0..horizonDays.
  const deltas = new Array<number>(horizonDays + 1).fill(0);
  let eventCount = 0;

  // Pending drafts: one event each, clamped forward to today if overdue (§4.1.1).
  for (const draft of drafts) {
    const due = startOfUtcDay(draft.suggestedDate);
    const dayIndex = due < today ? 0 : dayDiff(today, due);
    if (dayIndex > horizonDays) continue; // a draft dated past the horizon
    deltas[dayIndex] += signedAmount(draft.type, draft.amount);
    eventCount += 1;
  }

  // Active templates: expand occurrences, applying the skip + clamp rules.
  for (const template of templates) {
    for (const event of expandTemplateEvents(template, today, horizonEnd)) {
      deltas[event.dayIndex] += event.amount;
      eventCount += 1;
    }
  }

  // Fold into end-of-day running balances.
  const points: ForecastPoint[] = [];
  let running = startBalance;
  let low: ForecastPoint | null = null;

  for (let d = 0; d <= horizonDays; d += 1) {
    running = round2(running + deltas[d]);
    const point: ForecastPoint = {
      date: new Date(today.getTime() + d * MS_PER_DAY),
      balance: running,
    };
    points.push(point);
    // Strict `<` so the EARLIEST day wins a tie (§4.2, low.earliest-wins).
    if (low === null || point.balance < low.balance) {
      low = point;
    }
  }

  return {
    points,
    low: low as ForecastPoint,
    end: points[points.length - 1],
    eventCount,
  };
}
