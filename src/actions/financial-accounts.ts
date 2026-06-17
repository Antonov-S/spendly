"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { revalidateAccountViews } from "@/lib/revalidation";
import { getAccountForEdit as getAccountForEditQuery } from "@/lib/db/accounts";
import {
  createAccountSchema,
  updateAccountSchema,
  type CreateAccountInput,
  type UpdateAccountInput,
} from "@/lib/validations/financial-account";
import type { EditableAccount } from "@/types/accounts";

/** Standard mutation result for the write actions. */
export interface MutationResult {
  success: boolean;
  error?: string;
}

const NOT_AUTHED: MutationResult = {
  success: false,
  error: "You must be signed in.",
};

/**
 * Single not-found shape for both "missing" and "owned by another user" — every
 * write is scoped `where: { id, userId }`, so ownership stays non-enumerable.
 */
const NOT_FOUND: MutationResult = { success: false, error: "Account not found." };

/** Round a money magnitude to the 2 decimals the Decimal(12,2) column stores. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Create an account for the signed-in user. `currency` is stamped server-side as
 * `DEFAULT_CURRENCY` (EUR) — never trusted from the client (EUR-only MVP).
 * `startingBalance` is signed (liability accounts may open negative).
 */
export async function createFinancialAccount(
  input: CreateAccountInput
): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  const parsed = createAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { name, type, startingBalance, color, icon } = parsed.data;

  try {
    await prisma.financialAccount.create({
      data: {
        userId,
        name,
        type,
        currency: DEFAULT_CURRENCY,
        startingBalance: round2(startingBalance),
        color: color ?? null,
        icon: icon ?? null,
      },
    });

    revalidateAccountViews();
    return { success: true };
  } catch (error) {
    console.error("createFinancialAccount failed", error);
    return { success: false, error: "Could not create the account." };
  }
}

/**
 * Patch name/color/icon only. `type` and `startingBalance` are immutable in MVP
 * (changing the opening balance would silently rewrite every derived balance).
 */
export async function updateFinancialAccount(
  input: UpdateAccountInput
): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  const parsed = updateAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { id, name, color, icon } = parsed.data;

  try {
    const existing = await prisma.financialAccount.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) return NOT_FOUND;

    await prisma.financialAccount.update({
      where: { id },
      data: { name, color: color ?? null, icon: icon ?? null },
    });

    revalidateAccountViews();
    return { success: true };
  } catch (error) {
    console.error("updateFinancialAccount failed", error);
    return { success: false, error: "Could not update the account." };
  }
}

/**
 * Archive an account (the UI "delete"). Idempotent — re-archiving an already
 * archived account is a no-op success. In the same `$transaction`, pauses the
 * account's active recurring templates so the scheduler stops emitting drafts
 * that could never be confirmed. Never hard-deletes.
 */
export async function archiveFinancialAccount(
  id: string
): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  try {
    const claimed = await prisma.$transaction(async (tx) => {
      // updateMany (count-based) distinguishes "not found" (0 rows) from
      // "already archived" (1 row) without throwing.
      const updated = await tx.financialAccount.updateMany({
        where: { id, userId },
        data: { isArchived: true },
      });
      if (updated.count === 0) return false;

      await tx.recurringTemplate.updateMany({
        where: { financialAccountId: id, userId, isActive: true },
        data: { isActive: false },
      });
      return true;
    });

    if (!claimed) return NOT_FOUND;

    revalidateAccountViews();
    revalidatePath("/recurring"); // templates may have been paused
    return { success: true };
  } catch (error) {
    console.error("archiveFinancialAccount failed", error);
    return { success: false, error: "Could not archive the account." };
  }
}

/**
 * Unarchive an account — drives the Sonner undo. Idempotent. Deliberately does
 * NOT auto-resume the templates archiving paused; the user re-activates each one
 * deliberately (conscious-capture principle).
 */
export async function unarchiveFinancialAccount(
  id: string
): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  try {
    const updated = await prisma.financialAccount.updateMany({
      where: { id, userId },
      data: { isArchived: false },
    });
    if (updated.count === 0) return NOT_FOUND;

    revalidateAccountViews();
    return { success: true };
  } catch (error) {
    console.error("unarchiveFinancialAccount failed", error);
    return { success: false, error: "Could not restore the account." };
  }
}

/** Auth-guarded proxy over the read fetcher, for the drawer's edit pre-fill. */
export async function getAccountForEdit(id: string): Promise<{
  success: boolean;
  data?: EditableAccount;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: NOT_AUTHED.error };

  try {
    const account = await getAccountForEditQuery(session.user.id, id);
    if (!account) return { success: false, error: NOT_FOUND.error };
    return { success: true, data: account };
  } catch (error) {
    console.error("getAccountForEdit failed", error);
    return { success: false, error: "Could not load the account." };
  }
}
