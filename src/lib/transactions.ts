import type { Prisma } from "@/generated/prisma/client";
import { SEMANTIC_COLORS } from "@/lib/system-constants";
import type {
  FeedTransaction,
  TransactionFilters,
  TransactionGroup,
  TransactionLeg,
  TransactionTypeValue,
} from "@/types/transactions";

/**
 * Left-border accent per transaction type. Shared between the dashboard's
 * recent-transactions panel and the full feed so the colors stay in one place.
 */
export const TYPE_BORDER_COLOR: Record<TransactionTypeValue, string> = {
  INCOME: SEMANTIC_COLORS.success,
  EXPENSE: SEMANTIC_COLORS.danger,
  TRANSFER: SEMANTIC_COLORS.neutral,
};

/**
 * Map feed filters to a Prisma `where`. Always scopes to the user and excludes
 * soft-deleted rows. Archived accounts are excluded unless a specific account
 * is selected (its history stays reachable). The category filter is ignored for
 * transfers (they have no category). Search is an OR across merchant, note, and
 * category name.
 */
export function buildTransactionWhere(
  userId: string,
  filters: TransactionFilters
): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = {
    userId,
    deletedAt: null,
  };

  // Account scope vs. archived exclusion are mutually exclusive: selecting an
  // account reveals its transactions even if the account is archived.
  if (filters.accountId) {
    where.financialAccountId = filters.accountId;
  } else {
    where.financialAccount = { isArchived: false };
  }

  if (filters.type) {
    where.type = filters.type;
  }

  if (filters.from || filters.to) {
    where.date = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  // Transfers carry no category, so a category filter would hide all of them.
  if (
    filters.categoryIds &&
    filters.categoryIds.length > 0 &&
    filters.type !== "TRANSFER"
  ) {
    where.categoryId = { in: filters.categoryIds };
  }

  if (filters.q) {
    const contains = { contains: filters.q, mode: "insensitive" as const };
    where.OR = [
      { merchant: contains },
      { note: contains },
      { category: { name: contains } },
    ];
  }

  return where;
}

/** Build the feed `description` for a leg: merchant → category → type label. */
function legDescription(leg: TransactionLeg): string {
  if (leg.merchant) return leg.merchant;
  if (leg.type === "TRANSFER") return "Transfer";
  if (leg.category) return leg.category.name;
  return leg.type === "INCOME" ? "Income" : "Expense";
}

/** Project a non-transfer leg to a feed row. */
function toRow(leg: TransactionLeg): FeedTransaction {
  return {
    id: leg.id,
    type: leg.type,
    description: legDescription(leg),
    category: leg.category,
    date: leg.date,
    currency: leg.currency,
    amount: leg.amount,
    accountName: leg.accountName,
    isTransferLeg: leg.isTransferLeg,
    transferPairId: leg.transferPairId ?? undefined,
  };
}

/** Project a chosen transfer leg + counterparty to a single feed row. */
function toTransferRow(
  primary: TransactionLeg,
  counterparty: TransactionLeg | undefined
): FeedTransaction {
  return {
    id: primary.id,
    type: "TRANSFER",
    description: "Transfer",
    category: null,
    date: primary.date,
    currency: primary.currency,
    amount: primary.amount,
    accountName: primary.accountName,
    counterpartyAccountName: counterparty?.accountName,
    isTransferLeg: true,
    transferPairId: primary.transferPairId ?? undefined,
  };
}

/**
 * Collapse transfer pairs into one row each while passing non-transfers through
 * unchanged. The input may contain both legs of a pair (the second leg is only
 * used to name the counterparty); only the first leg of each pair encountered
 * emits a row, so callers control row position by ordering the canonical leg
 * first.
 *
 * - **All accounts** (no `scopedAccountId`): the outflow (negative) leg is
 *   canonical; the inflow leg names the destination.
 * - **Single account**: the leg belonging to `scopedAccountId` is canonical;
 *   the other leg names the counterparty.
 */
export function collapseTransfers(
  legs: TransactionLeg[],
  scopedAccountId?: string
): FeedTransaction[] {
  const rows: FeedTransaction[] = [];
  const seenPairs = new Set<string>();

  for (const leg of legs) {
    if (!leg.transferPairId) {
      rows.push(toRow(leg));
      continue;
    }

    if (seenPairs.has(leg.transferPairId)) continue;
    seenPairs.add(leg.transferPairId);

    const pair = legs.filter((l) => l.transferPairId === leg.transferPairId);

    if (scopedAccountId) {
      const primary =
        pair.find((l) => l.financialAccountId === scopedAccountId) ?? leg;
      const counterparty = pair.find(
        (l) => l.financialAccountId !== scopedAccountId
      );
      rows.push(toTransferRow(primary, counterparty));
    } else {
      const outflow = pair.find((l) => l.amount < 0) ?? leg;
      const inflow = pair.find((l) => l.amount > 0);
      rows.push(toTransferRow(outflow, inflow));
    }
  }

  return rows;
}

/** Parse a "YYYY-MM-DD" search param into a calendar date at UTC midnight. */
export function parseDateParam(value?: string): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
}

/** Narrow a raw search param to a valid transaction type, or undefined. */
export function parseType(value?: string): TransactionTypeValue | undefined {
  return value === "INCOME" || value === "EXPENSE" || value === "TRANSFER"
    ? value
    : undefined;
}

/** Calendar-date key (UTC components) for comparing `@db.Date` values. */
function dateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

/** UTC-midnight timestamp (ms) for a given instant — strips the time component. */
function utcDayStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Label a soft-deleted row for the trash list, e.g. `"Deleted 3 days ago · Jun 25"`.
 * The relative half (anchored to the request's `nowMs`) gives at-a-glance recency;
 * the absolute half stays useful once the row is old — the year is appended only
 * when it isn't the current year. Both halves are UTC-stable, matching the feed's
 * date formatting.
 */
export function formatDeletedAt(deletedAt: Date, nowMs: number): string {
  const days = Math.round(
    (utcDayStart(nowMs) - utcDayStart(deletedAt.getTime())) / 86_400_000
  );

  let relative: string;
  if (days <= 0) relative = "today";
  else if (days === 1) relative = "1 day ago";
  else relative = `${days} days ago`;

  const sameYear = deletedAt.getUTCFullYear() === new Date(nowMs).getUTCFullYear();
  const absolute = deletedAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });

  return `Deleted ${relative} · ${absolute}`;
}

/**
 * Bucket feed rows into ordered date groups: "Today", "Yesterday", then one
 * group per older calendar date labelled "MMM D, YYYY". `localToday` is supplied
 * by the caller so grouping is anchored to the user's day, not server UTC.
 * Input is assumed already sorted newest-first; group order follows first
 * appearance.
 */
export function groupTransactionsByDate(
  txns: FeedTransaction[],
  localToday: Date
): TransactionGroup[] {
  const todayKey = dateKey(localToday);
  const yesterday = new Date(localToday);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayKey = dateKey(yesterday);

  const groups: TransactionGroup[] = [];
  const byKey = new Map<string, TransactionGroup>();

  for (const txn of txns) {
    const key = dateKey(txn.date);
    let label: string;
    if (key === todayKey) label = "Today";
    else if (key === yesterdayKey) label = "Yesterday";
    else
      label = txn.date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });

    let group = byKey.get(key);
    if (!group) {
      group = { label, items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(txn);
  }

  return groups;
}
