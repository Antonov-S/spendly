import { startOfUtcDay } from "@/lib/date";
import type { RecurringCadence, TransactionType } from "@/generated/prisma/client";

/** Decimal-like value: a number, numeric string, or Prisma Decimal. */
type Numeric = number | string | { toString(): string };

/** Income/expense only — recurring templates never model transfers. */
export type RecurringType = Extract<TransactionType, "INCOME" | "EXPENSE">;

/** A serializable category reference for template/draft cards. */
export interface CategoryRef {
  id: string;
  name: string;
  icon: string;
  color: string;
}

/** Serializable template row for the templates list (no Prisma types). */
export interface TemplateRow {
  id: string;
  name: string;
  type: RecurringType;
  amount: number;
  currency: string;
  cadence: RecurringCadence;
  nextOccurrence: Date;
  isActive: boolean;
  accountName: string;
  category: CategoryRef | null;
}

/** Serializable pending-draft row for the inbox (no Prisma types). */
export interface DraftRow {
  id: string;
  suggestedDate: Date;
  suggestedAmount: number;
  templateId: string;
  templateName: string;
  type: RecurringType;
  currency: string;
  accountName: string;
  category: CategoryRef | null;
}

/**
 * Advance a `@db.Date` calendar date by one cadence unit. Input is a JS `Date`
 * (UTC midnight from Prisma); output is a new `Date` (the input is not mutated).
 * DAILY +1d, WEEKLY +7d, MONTHLY +1 calendar month (day clamped to the last
 * valid day), YEARLY +1 calendar year.
 */
export function advanceNextOccurrence(
  date: Date,
  cadence: RecurringCadence
): Date {
  // Work in UTC to match @db.Date storage (no timezone component).
  const d = new Date(date);
  switch (cadence) {
    case "DAILY":
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case "WEEKLY":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "MONTHLY":
      addMonthsClamped(d, 1);
      break;
    case "YEARLY":
      addMonthsClamped(d, 12);
      break;
  }
  return d;
}

/**
 * Add `months` calendar months in UTC, clamping the day to the last valid day
 * of the target month.
 *
 * JS `setUTCMonth`/`setUTCFullYear` OVERFLOW rather than clamp:
 *   Jan 31 + 1 month   → Mar 3   (not Feb 28)
 *   Feb 29 + 12 months → Mar 1   (not Feb 28)
 * So we set the day to 1 before shifting the month, then pin it to
 * `min(originalDay, lastDayOfTargetMonth)`.
 */
function addMonthsClamped(d: Date, months: number): void {
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  // Day 0 of the *next* month = the last day of the target month.
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
}

/** Human-readable cadence label. */
export function formatCadence(cadence: RecurringCadence): string {
  const MAP: Record<RecurringCadence, string> = {
    DAILY: "Daily",
    WEEKLY: "Weekly",
    MONTHLY: "Monthly",
    YEARLY: "Yearly",
  };
  return MAP[cadence];
}

/**
 * True when a draft's `suggestedDate` is strictly before today (UTC). A draft
 * due today is NOT overdue — today is its due date. `now` is injectable for
 * deterministic tests.
 */
export function isDraftOverdue(suggestedDate: Date, now: Date = new Date()): boolean {
  return suggestedDate < startOfUtcDay(now);
}

/** Template shape (Prisma include result) that `mapTemplateRow` can consume. */
export interface MappableTemplate {
  id: string;
  name: string;
  type: TransactionType;
  amount: Numeric;
  currency: string;
  cadence: RecurringCadence;
  nextOccurrence: Date;
  isActive: boolean;
  financialAccount: { name: string };
  category: CategoryRef | null;
}

/** Map a Prisma template (+account, +category) to a serializable row. */
export function mapTemplateRow(t: MappableTemplate): TemplateRow {
  return {
    id: t.id,
    name: t.name,
    type: t.type as RecurringType,
    amount: Number(t.amount),
    currency: t.currency,
    cadence: t.cadence,
    nextOccurrence: t.nextOccurrence,
    isActive: t.isActive,
    accountName: t.financialAccount.name,
    category: t.category ?? null,
  };
}

/** Draft shape (Prisma include result) that `mapDraftRow` can consume. */
export interface MappableDraft {
  id: string;
  suggestedDate: Date;
  suggestedAmount: Numeric;
  recurringTemplate: {
    id: string;
    name: string;
    type: TransactionType;
    currency: string;
    financialAccount: { name: string };
    category: CategoryRef | null;
  };
}

/** Map a Prisma pending draft (+template) to a serializable row. */
export function mapDraftRow(d: MappableDraft): DraftRow {
  return {
    id: d.id,
    suggestedDate: d.suggestedDate,
    suggestedAmount: Number(d.suggestedAmount),
    templateId: d.recurringTemplate.id,
    templateName: d.recurringTemplate.name,
    type: d.recurringTemplate.type as RecurringType,
    currency: d.recurringTemplate.currency,
    accountName: d.recurringTemplate.financialAccount.name,
    category: d.recurringTemplate.category ?? null,
  };
}
