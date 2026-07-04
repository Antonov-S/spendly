import "server-only";
import { prisma } from "@/lib/prisma";
import type { RecurringType } from "@/lib/recurring";
import type { RecurringCadence } from "@/generated/prisma/client";

/**
 * Scheduled-item reader for the dashboard cash-flow forecast
 * (cash-flow-forecast spec §6). Composition only — no business logic, no
 * balance query: the fold happens in-process on the page with the already-
 * fetched `summary.totalBalance` (spec D6), so this fetcher stays
 * balance-agnostic and can never drift from the hero number.
 *
 * All access is `userId`-scoped and select-only. No `Decimal` crosses the pure
 * boundary: amounts are mapped to `Number(...)` positive magnitudes; sign is
 * derived from `type` inside the engine, exactly as `confirmDraft` derives it
 * at write time.
 */

/** Active template input shape for `buildCashflowForecast`. */
export interface ForecastTemplate {
  type: RecurringType;
  amount: number; // positive magnitude
  cadence: RecurringCadence;
  nextOccurrence: Date;
  hasPendingDraft: boolean;
}

/** Pending-draft input shape for `buildCashflowForecast`. */
export interface ForecastDraft {
  type: RecurringType;
  amount: number; // positive magnitude
  suggestedDate: Date;
}

export interface ScheduledItems {
  templates: ForecastTemplate[];
  drafts: ForecastDraft[];
}

export async function getScheduledItems(
  userId: string
): Promise<ScheduledItems> {
  const [templates, drafts] = await Promise.all([
    // Active templates on non-archived accounts. `hasPendingDraft` derives from
    // a `take: 1` PENDING sub-read (the `generatePendingDrafts` pattern) — it
    // drives the engine's skip rule so a template with an outstanding draft
    // doesn't double-count the occurrence the draft already represents.
    prisma.recurringTemplate.findMany({
      where: {
        userId,
        isActive: true,
        financialAccount: { isArchived: false },
      },
      select: {
        type: true,
        amount: true,
        cadence: true,
        nextOccurrence: true,
        drafts: {
          where: { status: "PENDING" },
          select: { id: true },
          take: 1,
        },
      },
    }),
    // Pending drafts belonging to this user's templates on non-archived
    // accounts. Type comes from the parent template (drafts have no own type).
    prisma.recurringDraft.findMany({
      where: {
        status: "PENDING",
        recurringTemplate: {
          userId,
          financialAccount: { isArchived: false },
        },
      },
      select: {
        suggestedDate: true,
        suggestedAmount: true,
        recurringTemplate: { select: { type: true } },
      },
    }),
  ]);

  return {
    templates: templates.map((t) => ({
      type: t.type as RecurringType,
      amount: Math.abs(Number(t.amount)),
      cadence: t.cadence,
      nextOccurrence: t.nextOccurrence,
      hasPendingDraft: t.drafts.length > 0,
    })),
    drafts: drafts.map((d) => ({
      type: d.recurringTemplate.type as RecurringType,
      amount: Math.abs(Number(d.suggestedAmount)),
      suggestedDate: d.suggestedDate,
    })),
  };
}
