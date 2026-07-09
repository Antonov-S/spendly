import "server-only";
import { prisma } from "@/lib/prisma";
import { deriveBalance } from "@/lib/account";
import { toDateInputValue } from "@/lib/date";
import { EXPORT_MAX_TRANSACTIONS } from "@/lib/system-constants";
import type {
  ExportTransactionRow,
  FullExport,
  ExportAccount,
  ExportCategory,
  ExportBudget,
  ExportGoal,
  ExportRecurringTemplate,
  ExportTag,
} from "@/types/export";

/**
 * The single data layer both export formats consume (data-export-spec §3). The
 * only place the contract's scoping (C1/C2), ownership (D6), and normalization
 * (D1–D5) rules are realized; CSV and JSON are pure transforms over the output.
 * Every `Decimal` becomes a `number` and every `@db.Date`/timestamp a string
 * here — a Prisma `Decimal`/`Date` must never reach a pure helper or the body.
 */

/**
 * User scope + soft-delete + account scoping — the single source for the export
 * transaction WHERE (realizes C1, S2, D1). Identical shape to `reportTxWhere`:
 * no `?account=` → all accounts but **active only**; explicit `?account=<id>` →
 * that account by id, archived allowed; a foreign/unknown id matches nothing
 * (ownership-safe empty). Exported + pure so the security rule is unit-testable.
 */
export function exportTxWhere(userId: string, accountId: string | undefined) {
  return {
    userId,
    deletedAt: null,
    financialAccount: accountId
      ? { id: accountId } // explicit single account (archived OK)
      : { isArchived: false }, // all accounts → active only
  };
}

/**
 * Export membership for every domain entity (realizes D6). "bound" = scoped to
 * `?account=` (§3.2); "global" = always included in full; "never" = excluded
 * (auth/transient). Adding an export entity REQUIRES adding it here first —
 * there is no default, so a new model can't silently leak.
 */
export const EXPORT_ENTITY_CLASS = {
  financialAccount: "bound",
  transaction: "bound",
  recurringTemplate: "bound",
  category: "global", // + isSystem:false filter (D6)
  budget: "global",
  goal: "global", // incl. nested contributions
  tag: "global",
  recurringDraft: "never", // transient (D6)
  user: "never", // credentials/billing (D6)
} as const;

/**
 * Non-deleted transactions for export, normalized per D2–D5, ordered newest
 * first. Joins account + category names. Takes `EXPORT_MAX_TRANSACTIONS + 1` so
 * the route can detect overflow (D8). No `type` filter — INCOME/EXPENSE/TRANSFER
 * all included, transfers as two rows (D4). Feeds both CSV and the JSON
 * `transactions` array.
 */
export async function getTransactionsForExport(
  userId: string,
  accountId: string | undefined
): Promise<ExportTransactionRow[]> {
  const rows = await prisma.transaction.findMany({
    where: exportTxWhere(userId, accountId),
    select: {
      id: true,
      date: true,
      amount: true,
      type: true,
      merchant: true,
      note: true,
      isTransferLeg: true,
      transferPairId: true,
      financialAccountId: true,
      categoryId: true,
      recurringTemplateId: true,
      createdAt: true,
      financialAccount: { select: { name: true } },
      category: { select: { name: true } },
      splits: {
        select: {
          categoryId: true,
          category: { select: { name: true } },
          amount: true,
          note: true,
        },
        orderBy: { amount: "desc" },
      },
      tags: {
        select: { tag: { select: { name: true } } },
        orderBy: { tag: { name: "asc" } },
      },
    },
    orderBy: { date: "desc" },
    take: EXPORT_MAX_TRANSACTIONS + 1,
  });

  return rows.map((r) => ({
    id: r.id,
    date: toDateInputValue(r.date),
    amount: Number(r.amount),
    type: r.type,
    category: r.category?.name ?? null,
    account: r.financialAccount.name,
    merchant: r.merchant,
    note: r.note,
    isTransferLeg: r.isTransferLeg,
    transferPairId: r.transferPairId,
    financialAccountId: r.financialAccountId,
    categoryId: r.categoryId,
    recurringTemplateId: r.recurringTemplateId,
    // Derived convenience field (schemaVersion 2); `splits` is the source of truth.
    isSplit: r.splits.length > 0,
    splits: r.splits.map((s) => ({
      categoryId: s.categoryId,
      category: s.category?.name ?? null,
      amount: Number(s.amount),
      note: s.note,
    })),
    tags: r.tags.map((t) => t.tag.name),
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * The complete structured dump (the JSON `data` payload), normalized per D2–D6.
 *
 * Scoping is INTENTIONALLY ASYMMETRIC (C2/§3.2) — do not "normalize" it:
 *   - account-bound (accounts, recurring templates, transactions) → scoped to
 *     `?account=`, mirroring `exportTxWhere`'s active-vs-explicit rule;
 *   - global (user categories, budgets, goals + contributions) → always full,
 *     by `userId` only. Clamping a per-category budget or a virtual goal "to an
 *     account" is meaningless, so they are included whole.
 * Categories are user-owned only (`isSystem: false`, D6).
 */
export async function getFullExport(
  userId: string,
  accountId: string | undefined
): Promise<FullExport> {
  // Account-bound: mirror exportTxWhere's account clause (active-only when no id).
  const accountWhere = accountId
    ? { userId, id: accountId } // explicit (archived honored)
    : { userId, isArchived: false }; // all active
  const recurringAccountScope = accountId
    ? { financialAccountId: accountId }
    : { financialAccount: { isArchived: false } };

  const [accounts, balanceSums, categories, budgets, goals, templates, transactions, tags] =
    await Promise.all([
      prisma.financialAccount.findMany({
        where: accountWhere,
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          type: true,
          currency: true,
          startingBalance: true,
          color: true,
          icon: true,
          isArchived: true,
          createdAt: true,
        },
      }),
      // Balance is startingBalance + SUM(all non-deleted tx) — independent of the
      // export window/scope, so summed over every account the user owns.
      prisma.transaction.groupBy({
        by: ["financialAccountId"],
        where: { userId, deletedAt: null },
        _sum: { amount: true },
      }),
      prisma.category.findMany({
        where: { userId, isSystem: false },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, icon: true, color: true, createdAt: true },
      }),
      prisma.budget.findMany({
        where: { userId },
        orderBy: [{ year: "asc" }, { month: "asc" }],
        select: {
          id: true,
          amount: true,
          currency: true,
          month: true,
          year: true,
          isArchived: true,
          categoryId: true,
          createdAt: true,
        },
      }),
      prisma.goal.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          targetAmount: true,
          currentAmount: true,
          currency: true,
          targetDate: true,
          isCompleted: true,
          createdAt: true,
          contributions: {
            orderBy: { date: "desc" },
            select: {
              id: true,
              amount: true,
              date: true,
              note: true,
              createdAt: true,
            },
          },
        },
      }),
      prisma.recurringTemplate.findMany({
        where: { userId, ...recurringAccountScope },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          type: true,
          amount: true,
          currency: true,
          cadence: true,
          nextOccurrence: true,
          isActive: true,
          financialAccountId: true,
          categoryId: true,
          createdAt: true,
        },
      }),
      getTransactionsForExport(userId, accountId),
      prisma.tag.findMany({
        where: { userId },
        orderBy: { name: "asc" },
        select: { id: true, name: true, color: true, createdAt: true },
      }),
    ]);

  const sumByAccount = new Map(
    balanceSums.map((s) => [s.financialAccountId, s._sum.amount])
  );

  const exportAccounts: ExportAccount[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    currency: a.currency,
    startingBalance: Number(a.startingBalance),
    balance: deriveBalance(a.startingBalance, sumByAccount.get(a.id) ?? null),
    color: a.color,
    icon: a.icon,
    isArchived: a.isArchived,
    createdAt: a.createdAt.toISOString(),
  }));

  const exportCategories: ExportCategory[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.icon,
    color: c.color,
    createdAt: c.createdAt.toISOString(),
  }));

  const exportBudgets: ExportBudget[] = budgets.map((b) => ({
    id: b.id,
    amount: Number(b.amount),
    currency: b.currency,
    month: b.month,
    year: b.year,
    isArchived: b.isArchived,
    categoryId: b.categoryId,
    createdAt: b.createdAt.toISOString(),
  }));

  const exportGoals: ExportGoal[] = goals.map((g) => ({
    id: g.id,
    name: g.name,
    targetAmount: Number(g.targetAmount),
    currentAmount: Number(g.currentAmount),
    currency: g.currency,
    targetDate: g.targetDate ? toDateInputValue(g.targetDate) : null,
    isCompleted: g.isCompleted,
    createdAt: g.createdAt.toISOString(),
    contributions: g.contributions.map((c) => ({
      id: c.id,
      amount: Number(c.amount),
      date: toDateInputValue(c.date),
      note: c.note,
      createdAt: c.createdAt.toISOString(),
    })),
  }));

  const exportTemplates: ExportRecurringTemplate[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    type: t.type,
    amount: Number(t.amount),
    currency: t.currency,
    cadence: t.cadence,
    nextOccurrence: toDateInputValue(t.nextOccurrence),
    isActive: t.isActive,
    financialAccountId: t.financialAccountId,
    categoryId: t.categoryId,
    createdAt: t.createdAt.toISOString(),
  }));

  const exportTags: ExportTag[] = tags.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    createdAt: t.createdAt.toISOString(),
  }));

  return {
    accounts: exportAccounts,
    categories: exportCategories,
    budgets: exportBudgets,
    goals: exportGoals,
    recurringTemplates: exportTemplates,
    transactions,
    tags: exportTags,
  };
}
