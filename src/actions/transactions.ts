"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getTransactions } from "@/lib/db/transactions";
import { getUserAccounts } from "@/lib/db/accounts";
import { getUserCategories } from "@/lib/db/categories";
import { dateInputToUtc, toDateInputValue } from "@/lib/date";
import {
  createTransactionSchema,
  updateTransactionSchema,
  transferSchema,
  type CreateTransactionInput,
  type UpdateTransactionInput,
  type TransferInput,
} from "@/lib/validations/transaction";
import type {
  DrawerFormData,
  EditableTransaction,
  TransactionFilters,
  TransactionPage,
} from "@/types/transactions";

/** Result of a "load more" request, following the action result convention. */
export interface LoadMoreResult {
  success: boolean;
  data?: TransactionPage;
  error?: string;
}

/** Standard mutation result for the write actions. */
export interface MutationResult {
  success: boolean;
  error?: string;
}

const NOT_AUTHED: MutationResult = {
  success: false,
  error: "You must be signed in.",
};

/** Revalidate every surface that renders transactions or derived balances. */
function revalidateTransactionViews() {
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  // Spend consumed by a budget is derived from transactions — keep /budgets fresh.
  revalidatePath("/budgets");
}

/** Round a money magnitude to the 2 decimals the Decimal(12,2) column stores. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Read-only pagination for the transactions feed: returns the next cursor page
 * for the signed-in user.
 */
export async function loadMoreTransactions(
  filters: TransactionFilters,
  cursor: string
): Promise<LoadMoreResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated." };
  }

  try {
    const data = await getTransactions(session.user.id, filters, cursor);
    return { success: true, data };
  } catch (error) {
    console.error("loadMoreTransactions failed", error);
    return { success: false, error: "Could not load more transactions." };
  }
}

/** Accounts + categories for the drawer selectors (active accounts only). */
export async function getDrawerFormData(): Promise<{
  success: boolean;
  data?: DrawerFormData;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: NOT_AUTHED.error };

  try {
    const [accounts, categories] = await Promise.all([
      getUserAccounts(session.user.id),
      getUserCategories(session.user.id),
    ]);
    return { success: true, data: { accounts, categories } };
  } catch (error) {
    console.error("getDrawerFormData failed", error);
    return { success: false, error: "Could not load the form." };
  }
}

/** Fetch the editable shape for pre-filling the drawer on a row click. */
export async function getTransactionForEdit(id: string): Promise<{
  success: boolean;
  data?: EditableTransaction;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: NOT_AUTHED.error };
  const userId = session.user.id;

  try {
    const tx = await prisma.transaction.findFirst({
      where: { id, userId, deletedAt: null },
      select: {
        id: true,
        type: true,
        amount: true,
        date: true,
        merchant: true,
        note: true,
        isTransferLeg: true,
        transferPairId: true,
        financialAccountId: true,
        categoryId: true,
      },
    });
    if (!tx) return { success: false, error: "Transaction not found." };

    if (!tx.isTransferLeg) {
      return {
        success: true,
        data: {
          id: tx.id,
          type: tx.type,
          amount: Math.abs(Number(tx.amount)),
          date: toDateInputValue(tx.date),
          merchant: tx.merchant,
          note: tx.note,
          financialAccountId: tx.financialAccountId,
          categoryId: tx.categoryId,
        },
      };
    }

    // Transfer: resolve both legs to recover the from/to accounts.
    const legs = await prisma.transaction.findMany({
      where: { transferPairId: tx.transferPairId ?? "", userId, deletedAt: null },
      select: { amount: true, financialAccountId: true },
    });
    const fromLeg = legs.find((l) => Number(l.amount) < 0);
    const toLeg = legs.find((l) => Number(l.amount) > 0);

    return {
      success: true,
      data: {
        id: tx.id,
        type: "TRANSFER",
        amount: Math.abs(Number(tx.amount)),
        date: toDateInputValue(tx.date),
        merchant: tx.merchant,
        note: tx.note,
        transferPairId: tx.transferPairId ?? undefined,
        fromAccountId: fromLeg?.financialAccountId,
        toAccountId: toLeg?.financialAccountId,
      },
    };
  } catch (error) {
    console.error("getTransactionForEdit failed", error);
    return { success: false, error: "Could not load the transaction." };
  }
}

/** Create an income or expense. The stored sign is derived from `type`. */
export async function createTransaction(
  input: CreateTransactionInput
): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  const parsed = createTransactionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { type, amount, date, financialAccountId, categoryId, merchant, note } =
    parsed.data;

  try {
    const account = await prisma.financialAccount.findFirst({
      where: { id: financialAccountId, userId, isArchived: false },
      select: { currency: true },
    });
    if (!account) return { success: false, error: "Account not found." };

    if (categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: categoryId, OR: [{ userId }, { userId: null }] },
        select: { id: true },
      });
      if (!category) return { success: false, error: "Category not found." };
    }

    const magnitude = round2(amount);
    await prisma.transaction.create({
      data: {
        userId,
        type,
        amount: type === "EXPENSE" ? -magnitude : magnitude,
        currency: account.currency,
        date: dateInputToUtc(date),
        financialAccountId,
        categoryId: categoryId ?? null,
        merchant,
        note,
      },
    });

    revalidateTransactionViews();
    return { success: true };
  } catch (error) {
    console.error("createTransaction failed", error);
    return { success: false, error: "Could not create the transaction." };
  }
}

/** Update an existing income/expense in place (transfers are rejected). */
export async function updateTransaction(
  id: string,
  input: UpdateTransactionInput
): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  const parsed = updateTransactionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { type, amount, date, financialAccountId, categoryId, merchant, note } =
    parsed.data;

  try {
    const existing = await prisma.transaction.findFirst({
      where: { id, userId, deletedAt: null },
      select: { id: true, isTransferLeg: true },
    });
    if (!existing) return { success: false, error: "Transaction not found." };
    if (existing.isTransferLeg) {
      return { success: false, error: "Edit transfers from the transfer form." };
    }

    const account = await prisma.financialAccount.findFirst({
      where: { id: financialAccountId, userId, isArchived: false },
      select: { currency: true },
    });
    if (!account) return { success: false, error: "Account not found." };

    if (categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: categoryId, OR: [{ userId }, { userId: null }] },
        select: { id: true },
      });
      if (!category) return { success: false, error: "Category not found." };
    }

    const magnitude = round2(amount);
    await prisma.transaction.update({
      where: { id },
      data: {
        type,
        amount: type === "EXPENSE" ? -magnitude : magnitude,
        currency: account.currency,
        date: dateInputToUtc(date),
        financialAccountId,
        categoryId: categoryId ?? null,
        merchant,
        note,
      },
    });

    revalidateTransactionViews();
    return { success: true };
  } catch (error) {
    console.error("updateTransaction failed", error);
    return { success: false, error: "Could not update the transaction." };
  }
}

/** Resolve and validate the two accounts for a transfer; returns currencies. */
async function resolveTransferAccounts(
  userId: string,
  fromAccountId: string,
  toAccountId: string
): Promise<
  | { ok: true; fromCurrency: string; toCurrency: string }
  | { ok: false; error: string }
> {
  const accounts = await prisma.financialAccount.findMany({
    where: { id: { in: [fromAccountId, toAccountId] }, userId, isArchived: false },
    select: { id: true, currency: true },
  });
  const from = accounts.find((a) => a.id === fromAccountId);
  const to = accounts.find((a) => a.id === toAccountId);
  if (!from || !to) return { ok: false, error: "Account not found." };
  return { ok: true, fromCurrency: from.currency, toCurrency: to.currency };
}

/** Build the two `createMany` rows for a transfer pair. */
function transferLegs(
  userId: string,
  pairId: string,
  date: Date,
  magnitude: number,
  fromAccountId: string,
  toAccountId: string,
  fromCurrency: string,
  toCurrency: string,
  merchant: string | null,
  note: string | null
) {
  const shared = {
    userId,
    type: "TRANSFER" as const,
    date,
    isTransferLeg: true,
    transferPairId: pairId,
    merchant,
    note,
  };
  return [
    {
      ...shared,
      amount: -magnitude,
      currency: fromCurrency,
      financialAccountId: fromAccountId,
    },
    {
      ...shared,
      amount: magnitude,
      currency: toCurrency,
      financialAccountId: toAccountId,
    },
  ];
}

/** Create a transfer: two linked legs sharing a new `transferPairId`. */
export async function createTransfer(
  input: TransferInput
): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { amount, date, fromAccountId, toAccountId, merchant, note } =
    parsed.data;

  try {
    const resolved = await resolveTransferAccounts(
      userId,
      fromAccountId,
      toAccountId
    );
    if (!resolved.ok) return { success: false, error: resolved.error };

    await prisma.transaction.createMany({
      data: transferLegs(
        userId,
        crypto.randomUUID(),
        dateInputToUtc(date),
        round2(amount),
        fromAccountId,
        toAccountId,
        resolved.fromCurrency,
        resolved.toCurrency,
        merchant,
        note
      ),
    });

    revalidateTransactionViews();
    return { success: true };
  } catch (error) {
    console.error("createTransfer failed", error);
    return { success: false, error: "Could not create the transfer." };
  }
}

/**
 * Edit a transfer via delete-and-recreate. Atomically soft-deletes both old
 * legs and inserts a fresh pair (new `transferPairId`) with the updated values.
 */
export async function updateTransfer(
  pairId: string,
  input: TransferInput
): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { amount, date, fromAccountId, toAccountId, merchant, note } =
    parsed.data;

  try {
    const legs = await prisma.transaction.findMany({
      where: { transferPairId: pairId, userId, deletedAt: null },
      select: { id: true },
    });
    if (legs.length === 0) {
      return { success: false, error: "Transfer not found." };
    }

    const resolved = await resolveTransferAccounts(
      userId,
      fromAccountId,
      toAccountId
    );
    if (!resolved.ok) return { success: false, error: resolved.error };

    await prisma.$transaction([
      prisma.transaction.updateMany({
        where: { transferPairId: pairId, userId, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
      prisma.transaction.createMany({
        data: transferLegs(
          userId,
          crypto.randomUUID(),
          dateInputToUtc(date),
          round2(amount),
          fromAccountId,
          toAccountId,
          resolved.fromCurrency,
          resolved.toCurrency,
          merchant,
          note
        ),
      }),
    ]);

    revalidateTransactionViews();
    return { success: true };
  } catch (error) {
    console.error("updateTransfer failed", error);
    return { success: false, error: "Could not update the transfer." };
  }
}

/** Soft-delete a transaction. For a transfer, both legs are deleted together. */
export async function deleteTransaction(id: string): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  try {
    const existing = await prisma.transaction.findFirst({
      where: { id, userId, deletedAt: null },
      select: { id: true, transferPairId: true },
    });
    if (!existing) return { success: false, error: "Transaction not found." };

    const now = new Date();
    if (existing.transferPairId) {
      await prisma.transaction.updateMany({
        where: {
          transferPairId: existing.transferPairId,
          userId,
          deletedAt: null,
        },
        data: { deletedAt: now },
      });
    } else {
      await prisma.transaction.update({
        where: { id },
        data: { deletedAt: now },
      });
    }

    revalidateTransactionViews();
    return { success: true };
  } catch (error) {
    console.error("deleteTransaction failed", error);
    return { success: false, error: "Could not delete the transaction." };
  }
}

/** Snackbar undo — clears `deletedAt`. For a transfer, both legs are restored. */
export async function restoreTransaction(id: string): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  try {
    const existing = await prisma.transaction.findFirst({
      where: { id, userId },
      select: { id: true, transferPairId: true },
    });
    if (!existing) return { success: false, error: "Transaction not found." };

    if (existing.transferPairId) {
      await prisma.transaction.updateMany({
        where: { transferPairId: existing.transferPairId, userId },
        data: { deletedAt: null },
      });
    } else {
      await prisma.transaction.update({
        where: { id },
        data: { deletedAt: null },
      });
    }

    revalidateTransactionViews();
    return { success: true };
  } catch (error) {
    console.error("restoreTransaction failed", error);
    return { success: false, error: "Could not restore the transaction." };
  }
}
