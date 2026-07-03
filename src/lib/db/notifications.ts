import "server-only";
import { getBudgetsData } from "@/lib/db/dashboard";
import { getPendingDrafts } from "@/lib/db/recurring";
import { getGoalsSummary } from "@/lib/db/goals";
import { buildNotificationItems } from "@/lib/notifications";
import type { NotificationsPayload } from "@/types/notifications";

/**
 * Channel-agnostic notification derivation (POST-MVP §9). Composes the existing
 * dashboard fetchers and feeds the pure builder — no new queries, no schema. The
 * Server Action (`getNotifications`) is one delivery channel; the escalation
 * ladder's upper rungs (a rung-2 persistence cron, a rung-3 email digest) would
 * call THIS same function so every channel derives identically. Reusing the
 * dashboard fetchers verbatim keeps the numbers provably identical to the
 * insights strip and the budgets panel (correctness over micro-optimization —
 * this runs off the paint path, §4/§9).
 *
 * `now` is injectable for tests (month-boundary cases) and future scheduled
 * callers ("as of" a cron tick); the default keeps every current call site
 * zero-config. Month/year resolve the same way the dashboard page does.
 */
export async function deriveNotifications(
  userId: string,
  now: Date = new Date()
): Promise<NotificationsPayload> {
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const [{ rows: budgets }, drafts, goals] = await Promise.all([
    getBudgetsData(userId, month, year), // rows carry spent/limit/carriedAmount
    getPendingDrafts(userId), // ownership-scoped; archived/deleted excluded upstream
    getGoalsSummary(userId), // active goals, `overdue` stamped by isGoalOverdue
  ]);

  return buildNotificationItems({
    budgets: budgets.map((b) => ({
      id: b.id,
      name: b.category.name,
      spent: b.spent,
      limit: b.limit,
      carriedAmount: b.carriedAmount,
    })),
    drafts: drafts.map((d) => ({
      id: d.id,
      templateName: d.templateName,
      suggestedDate: d.suggestedDate,
    })),
    goals: goals.map((g) => ({
      id: g.id,
      name: g.name,
      overdue: g.overdue === true,
    })),
  });
}
