import "server-only";
import { prisma } from "@/lib/prisma";
import { startOfUtcDay } from "@/lib/date";
import { track } from "@/lib/analytics/track";
import {
  buildRecurringSuggestions,
  SUBSCRIPTION_LOOKBACK_MONTHS,
  type RecurringSuggestionsResult,
  type CandidateRow,
} from "@/lib/recurring-suggest";
import type { RecurringType } from "@/lib/recurring";

/**
 * Derive subscription suggestions for `/recurring` (subscription-detection §8.1).
 * Composition only — one bounded candidate query (§3 contract) plus the user's
 * template names and muted keys, fed to the pure engine. Injectable `now` keeps
 * tests deterministic and gives a future scheduled caller an "as of" seam
 * (mirrors `deriveNotifications`). All Prisma access is `userId`-scoped and
 * behind `server-only`. No `Decimal` crosses the pure boundary: amounts are
 * mapped to `Math.abs(Number(amount))` (magnitude; sign is already in `type`).
 */
export async function getRecurringSuggestions(
  userId: string,
  now: Date = new Date()
): Promise<RecurringSuggestionsResult> {
  const lookbackStart = monthsBefore(startOfUtcDay(now), SUBSCRIPTION_LOOKBACK_MONTHS);

  const [rows, templates, mutes] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        merchant: { not: null },
        type: { in: ["INCOME", "EXPENSE"] },
        isTransferLeg: false,
        recurringTemplateId: null,
        financialAccount: { isArchived: false },
        date: { gte: lookbackStart },
      },
      select: {
        merchant: true,
        amount: true,
        type: true,
        date: true,
        categoryId: true,
        financialAccountId: true,
      },
      orderBy: { date: "asc" },
    }),
    prisma.recurringTemplate.findMany({
      where: { userId },
      select: { name: true },
    }),
    prisma.recurringSuggestionMute.findMany({
      where: { userId },
      select: { merchantKey: true },
    }),
  ]);

  const candidates: CandidateRow[] = rows.map((r) => ({
    merchant: r.merchant ?? "",
    amount: Math.abs(Number(r.amount)),
    type: r.type as RecurringType,
    date: r.date,
    categoryId: r.categoryId,
    financialAccountId: r.financialAccountId,
  }));

  const result = buildRecurringSuggestions({
    rows: candidates,
    templateNames: templates.map((t) => t.name),
    mutedKeys: new Set(mutes.map((m) => m.merchantKey)),
    now,
  });

  // Impression event (§11) — every /recurring load that finds ≥ 1 pattern. The
  // emit lives here so any future caller of the fetcher inherits it. Counts/
  // enums only, no merchant names or amounts.
  if (result.detectedCount > 0) {
    void track("recurring_suggested", {
      detected: result.detectedCount,
      surfaced: result.suggestions.length,
      weekly: result.suggestions.filter((s) => s.cadence === "WEEKLY").length,
      monthly: result.suggestions.filter((s) => s.cadence === "MONTHLY").length,
    });
  }

  return result;
}

/** Subtract whole calendar months from a UTC-midnight date (query lower bound). */
function monthsBefore(date: Date, months: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, date.getUTCDate())
  );
}
