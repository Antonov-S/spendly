import { budgetProgressWithCarry } from "@/lib/budget";
import { budgetRiskLevel } from "@/lib/insights";
import { NOTIFICATION_GROUP_MAX } from "@/lib/constants";
import type {
  NotificationItem,
  NotificationKind,
  NotificationTone,
  NotificationsPayload,
} from "@/types/notifications";

/**
 * Pure notification builder (POST-MVP §9). Turns the three already-mapped,
 * number-typed signal sources into the ordered, per-kind-capped item list the
 * topbar bell renders. No I/O, no `Decimal`, no persistence — every figure comes
 * in pre-derived (the same rows the dashboard consumes). The at-risk threshold
 * rule is NOT re-implemented here: budget severity routes through
 * `budgetRiskLevel` (`src/lib/insights.ts`) so the panel and the strip agree.
 *
 * Ordering is owned here and never re-sorted by the component: budget-over
 * (worst first) → budget-risk (percent desc) → draft (date asc) → goal-overdue
 * (name asc). Severity, then urgency, then alphabet.
 */

/** Link target per kind — drives both real rows and the "+N more" overflow row. */
const KIND_HREF: Record<NotificationKind, string> = {
  "budget-over": "/budgets",
  "budget-risk": "/budgets",
  draft: "/recurring",
  "goal-overdue": "/goals",
};

/** Semantic tone per kind — the overflow row inherits its group's tone. */
const KIND_TONE: Record<NotificationKind, NotificationTone> = {
  "budget-over": "danger",
  "budget-risk": "warning",
  draft: "info",
  "goal-overdue": "warning",
};

// ─── Structural input shapes (narrow — the builder never imports DB row types) ──

interface BudgetInput {
  id: string;
  name: string;
  spent: number;
  limit: number;
  carriedAmount: number;
}

interface DraftInput {
  id: string;
  templateName: string;
  suggestedDate: Date;
}

interface GoalInput {
  id: string;
  name: string;
  overdue: boolean;
}

// ─── Label helpers (module-private, pure `(row) → string`) ──────────────────
// Copy lives here alone — the future i18n seam. Ordering/capping never touch it.

function budgetOverLabel(row: BudgetInput): string {
  // A blown ceiling is binary — no percent; the exact overshoot lives on /budgets.
  return `${row.name} budget is over the limit`;
}

function budgetRiskLabel(row: BudgetInput, percent: number): string {
  return `${row.name} budget at ${Math.round(percent)}%`;
}

function draftLabel(row: DraftInput): string {
  return `${row.templateName} — draft pending`;
}

function overdueGoalLabel(row: GoalInput): string {
  return `${row.name} goal is past its target date`;
}

/** "Jun 28" — the draft's suggested date as secondary detail (UTC, en-US). */
function formatDraftDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Uncapped over-ness magnitude for stable "worst first" budget ordering. The
 * carry-aware percent is clamped to 100, so all over-budget rows would tie —
 * this uses the raw ratio (a 200%-over row sorts before a 110%-over one); a
 * carried-away budget with effective limit <= 0 is maximally over (Infinity).
 */
function budgetMagnitude(row: BudgetInput): number {
  const { effectiveLimit } = budgetProgressWithCarry(
    row.spent,
    row.limit,
    row.carriedAmount
  );
  if (effectiveLimit <= 0) return Number.POSITIVE_INFINITY;
  return (row.spent / effectiveLimit) * 100;
}

/**
 * Apply the per-kind cap: at most `NOTIFICATION_GROUP_MAX` real rows, then a
 * synthetic "+N more" overflow row (flagged `isOverflowRow`, id suffixed `:more`
 * purely for React-key uniqueness — consumers branch on the flag, not the id).
 */
function capGroup(rows: NotificationItem[], kind: NotificationKind): NotificationItem[] {
  if (rows.length <= NOTIFICATION_GROUP_MAX) return rows;
  const remainder = rows.length - NOTIFICATION_GROUP_MAX;
  return [
    ...rows.slice(0, NOTIFICATION_GROUP_MAX),
    {
      id: `${kind}:more`,
      kind,
      tone: KIND_TONE[kind],
      label: `+${remainder} more`,
      isOverflowRow: true,
      href: KIND_HREF[kind],
    },
  ];
}

export function buildNotificationItems(input: {
  budgets: ReadonlyArray<BudgetInput>;
  drafts: ReadonlyArray<DraftInput>;
  goals: ReadonlyArray<GoalInput>;
}): NotificationsPayload {
  const overRows: NotificationItem[] = [];
  const riskRows: NotificationItem[] = [];

  // Classify budgets once; keep the sort magnitude alongside each item.
  const overMag = new Map<string, number>();
  const riskMag = new Map<string, number>();

  for (const b of input.budgets) {
    const level = budgetRiskLevel(b);
    if (level === null) continue;
    const magnitude = budgetMagnitude(b);
    if (level === "over") {
      const id = `budget-over:${b.id}`;
      overMag.set(id, magnitude);
      overRows.push({
        id,
        kind: "budget-over",
        tone: KIND_TONE["budget-over"],
        label: budgetOverLabel(b),
        href: KIND_HREF["budget-over"],
      });
    } else {
      const id = `budget-risk:${b.id}`;
      riskMag.set(id, magnitude);
      riskRows.push({
        id,
        kind: "budget-risk",
        tone: KIND_TONE["budget-risk"],
        label: budgetRiskLabel(b, magnitude),
        href: KIND_HREF["budget-risk"],
      });
    }
  }

  // Worst first within each budget group (magnitude desc).
  overRows.sort((a, b) => (overMag.get(b.id) ?? 0) - (overMag.get(a.id) ?? 0));
  riskRows.sort((a, b) => (riskMag.get(b.id) ?? 0) - (riskMag.get(a.id) ?? 0));

  // Drafts: oldest / most-overdue first (suggestedDate asc). Input order is not
  // trusted — the builder owns ordering.
  const draftRows: NotificationItem[] = [...input.drafts]
    .sort((a, b) => a.suggestedDate.getTime() - b.suggestedDate.getTime())
    .map((d) => ({
      id: `draft:${d.id}`,
      kind: "draft" as const,
      tone: KIND_TONE.draft,
      label: draftLabel(d),
      detail: formatDraftDate(d.suggestedDate),
      href: KIND_HREF.draft,
    }));

  // Overdue goals only, name asc.
  const goalRows: NotificationItem[] = input.goals
    .filter((g) => g.overdue)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((g) => ({
      id: `goal-overdue:${g.id}`,
      kind: "goal-overdue" as const,
      tone: KIND_TONE["goal-overdue"],
      label: overdueGoalLabel(g),
      href: KIND_HREF["goal-overdue"],
    }));

  const counts: Record<NotificationKind, number> = {
    "budget-over": overRows.length,
    "budget-risk": riskRows.length,
    draft: draftRows.length,
    "goal-overdue": goalRows.length,
  };

  const items = [
    ...capGroup(overRows, "budget-over"),
    ...capGroup(riskRows, "budget-risk"),
    ...capGroup(draftRows, "draft"),
    ...capGroup(goalRows, "goal-overdue"),
  ];

  const totalCount =
    counts["budget-over"] +
    counts["budget-risk"] +
    counts.draft +
    counts["goal-overdue"];

  return { items, counts, totalCount };
}
