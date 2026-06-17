import type { AccountListRow, AccountTypeValue } from "@/types/accounts";

/** Prisma `Decimal`, number, or string — anything `Number()` can coerce losslessly here. */
type Numeric = number | string | { toString(): string };

/**
 * Canonical derived balance: `startingBalance + SUM(transaction amounts)`.
 * A null/undefined sum (account with no transactions) counts as 0. Safe in
 * `number` because every per-account figure is `Decimal(12,2)` — far inside
 * `Number.MAX_SAFE_INTEGER` at 2 fractional digits.
 */
export function deriveBalance(
  startingBalance: Numeric,
  sum: Numeric | null | undefined
): number {
  return Number(startingBalance) + (sum == null ? 0 : Number(sum));
}

/** The Prisma account fields `mapAccountRow` reads (kept loose for serialization). */
export interface MappableAccount {
  id: string;
  name: string;
  type: AccountTypeValue;
  currency: string;
  startingBalance: Numeric;
  color: string | null;
  icon: string | null;
  isArchived: boolean;
}

/**
 * Map a Prisma account + its aggregated transaction sum to a serializable
 * `AccountListRow` (Decimal → number). Icon stays a raw name string, resolved at
 * render time.
 */
export function mapAccountRow(
  account: MappableAccount,
  sum: Numeric | null | undefined
): AccountListRow {
  const startingBalance = Number(account.startingBalance);
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: account.currency,
    balance: deriveBalance(startingBalance, sum),
    startingBalance,
    color: account.color,
    icon: account.icon,
    isArchived: account.isArchived,
  };
}

/**
 * Single source for the "sensible default account" rule (spec §11). Returns the
 * globally-scoped account when the topbar filter is active and matches an
 * account in the list, otherwise the first active account (canonical order),
 * otherwise null. `accounts` must already be the active set in canonical order.
 */
export function getDefaultActiveAccount<T extends { id: string }>(
  accounts: readonly T[],
  scopedId?: string | null
): T | null {
  if (scopedId) {
    const scoped = accounts.find((a) => a.id === scopedId);
    if (scoped) return scoped;
  }
  return accounts[0] ?? null;
}
