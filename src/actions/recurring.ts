"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { dateInputToUtc } from "@/lib/date";
import { advanceNextOccurrence } from "@/lib/recurring";
import { normalizeLabelKey } from "@/lib/text";
import { track } from "@/lib/analytics/track";
import { revalidateTransactionViews } from "@/lib/revalidation";
import { getTemplateForEdit as getTemplateForEditQuery } from "@/lib/db/recurring";
import {
  createTemplateSchema,
  updateTemplateSchema,
  muteSuggestionSchema,
  type CreateTemplateInput,
  type UpdateTemplateInput,
  type MuteSuggestionInput,
} from "@/lib/validations/recurring";
import type { TemplateEditable } from "@/lib/db/recurring";

/** Standard mutation result for the recurring write actions. */
export interface MutationResult {
  success: boolean;
  error?: string;
}

const NOT_AUTHED: MutationResult = {
  success: false,
  error: "You must be signed in.",
};

/**
 * Template CRUD and dismiss create no ledger row — only `/recurring` and the
 * dashboard draft count need refreshing. `confirmDraft` is the exception: it
 * writes a real transaction, so it reuses the exported `revalidateTransactionViews`.
 */
function revalidateRecurringViews() {
  revalidatePath("/recurring");
  revalidatePath("/dashboard"); // dashboard shows the pending-draft count
}

/** Round a money magnitude to the 2 decimals the Decimal(12,2) column stores. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Template actions ─────────────────────────────────

/** Create a recurring template. Currency is resolved from the chosen account. */
export async function createTemplate(
  input: CreateTemplateInput
): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  const parsed = createTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { name, type, amount, cadence, nextOccurrence, financialAccountId, categoryId } =
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

    await prisma.recurringTemplate.create({
      data: {
        userId,
        name,
        type,
        amount: round2(amount),
        currency: account.currency,
        cadence,
        nextOccurrence: dateInputToUtc(nextOccurrence),
        financialAccountId,
        categoryId: categoryId ?? null,
      },
    });

    revalidateRecurringViews();
    return { success: true };
  } catch (error) {
    console.error("createTemplate failed", error);
    return { success: false, error: "Could not create the template." };
  }
}

/** Update an existing template — only name, amount, and cadence are editable. */
export async function updateTemplate(
  id: string,
  input: UpdateTemplateInput
): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  const parsed = updateTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { name, amount, cadence } = parsed.data;

  try {
    const existing = await prisma.recurringTemplate.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) return { success: false, error: "Template not found." };

    // Note: nextOccurrence is intentionally NOT recomputed — the anchor stands,
    // the new cadence applies only to future advances.
    await prisma.recurringTemplate.update({
      where: { id },
      data: { name, amount: round2(amount), cadence },
    });

    revalidateRecurringViews();
    return { success: true };
  } catch (error) {
    console.error("updateTemplate failed", error);
    return { success: false, error: "Could not update the template." };
  }
}

/** Set `isActive` on an owned template (shared by pause/resume). */
async function setTemplateActive(
  id: string,
  isActive: boolean
): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  try {
    const existing = await prisma.recurringTemplate.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) return { success: false, error: "Template not found." };

    // Resume does NOT touch nextOccurrence — an overdue template generates a
    // draft on the next page load, no backlog replay, no forward jump.
    await prisma.recurringTemplate.update({ where: { id }, data: { isActive } });

    revalidateRecurringViews();
    return { success: true };
  } catch (error) {
    console.error("setTemplateActive failed", error);
    return { success: false, error: "Could not update the template." };
  }
}

/** Pause a template — stops draft generation; existing drafts remain. */
export async function pauseTemplate(id: string): Promise<MutationResult> {
  return setTemplateActive(id, false);
}

/** Resume a paused template — re-enables draft generation. */
export async function resumeTemplate(id: string): Promise<MutationResult> {
  return setTemplateActive(id, true);
}

/**
 * Hard-delete a template. Cascades to all its RecurringDraft rows; any
 * confirmed Transactions survive with `recurringTemplateId = null` (SetNull).
 * No undo — gated behind a confirm dialog in the UI.
 */
export async function deleteTemplate(id: string): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  try {
    const existing = await prisma.recurringTemplate.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) return { success: false, error: "Template not found." };

    await prisma.recurringTemplate.delete({ where: { id } });

    revalidateRecurringViews();
    return { success: true };
  } catch (error) {
    console.error("deleteTemplate failed", error);
    return { success: false, error: "Could not delete the template." };
  }
}

/** Auth-guarded proxy returning the edit pre-fill for the drawer. */
export async function getTemplateForEdit(id: string): Promise<{
  success: boolean;
  data?: TemplateEditable;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: NOT_AUTHED.error };

  try {
    const template = await getTemplateForEditQuery(session.user.id, id);
    if (!template) return { success: false, error: "Template not found." };
    return { success: true, data: template };
  } catch (error) {
    console.error("getTemplateForEdit failed", error);
    return { success: false, error: "Could not load the template." };
  }
}

// ─── Suggestion actions ───────────────────────────────

/**
 * Record "stop suggesting this merchant" (subscription detection §8.2, §9.3).
 * Shared by both suggestion outcomes: **Dismiss** fires it directly, and
 * **accept** fires it too (fire-and-forget) so a merchant stays suppressed even
 * if the user renames the template in the drawer before saving — the mute means
 * "stop suggesting this merchant," whatever the reason; accepted/dismissed lives
 * only in telemetry.
 *
 * The server re-normalizes the key through `normalizeLabelKey` before writing —
 * canonical storage is guaranteed server-side, never trusted from the client.
 * The write is an idempotent upsert on `@@unique([userId, merchantKey])`, so
 * double-clicks and the accept-then-dismiss race are no-ops. Not rate-limited
 * (a trivial auth-guarded upsert, matching `loadMoreTransactions`).
 */
export async function muteRecurringSuggestion(
  input: MuteSuggestionInput
): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  const parsed = muteSuggestionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { merchantKey, outcome, cadence } = parsed.data;

  try {
    const key = normalizeLabelKey(merchantKey);
    await prisma.recurringSuggestionMute.upsert({
      where: { userId_merchantKey: { userId, merchantKey: key } },
      create: { userId, merchantKey: key },
      update: {},
    });

    void track(
      outcome === "accepted"
        ? "recurring_suggestion_accepted"
        : "recurring_suggestion_dismissed",
      { cadence }
    );

    revalidatePath("/recurring");
    return { success: true };
  } catch (error) {
    console.error("muteRecurringSuggestion failed", error);
    return { success: false, error: "Could not update suggestions." };
  }
}

// ─── Draft actions ────────────────────────────────────

/**
 * Confirm a pending draft: create a real signed Transaction, mark the draft
 * CONFIRMED, and advance the template's `nextOccurrence` — all atomically. The
 * `updateMany` status guard inside the transaction serializes concurrent
 * confirms so a double-click / multi-tab produces at most one ledger entry.
 */
export async function confirmDraft(draftId: string): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  try {
    const draft = await prisma.recurringDraft.findUnique({
      where: { id: draftId },
      include: { recurringTemplate: true },
    });
    if (!draft || draft.recurringTemplate.userId !== userId) {
      return { success: false, error: "Draft not found." };
    }
    if (draft.status !== "PENDING") {
      return { success: false, error: "Draft is no longer pending." };
    }

    const template = draft.recurringTemplate;

    // Confirming writes a Transaction on the template's account — block it if the
    // account was archived after the draft was generated (archived accounts
    // cannot receive new transactions). The user dismisses such drafts instead.
    const account = await prisma.financialAccount.findFirst({
      where: { id: template.financialAccountId, userId },
      select: { isArchived: true },
    });
    if (!account) return { success: false, error: "Account not found." };
    if (account.isArchived) {
      return { success: false, error: "This account is archived." };
    }

    const nextOccurrence = advanceNextOccurrence(
      template.nextOccurrence,
      template.cadence
    );

    const claimed = await prisma.$transaction(async (tx) => {
      const res = await tx.recurringDraft.updateMany({
        where: { id: draftId, status: "PENDING" }, // race gate
        data: { status: "CONFIRMED" },
      });
      if (res.count === 0) return false; // someone else won the race

      await tx.transaction.create({
        data: {
          userId,
          type: template.type,
          // suggestedAmount is a positive magnitude; sign derives from type.
          // Decimal-native negation — never round-trip through float.
          amount:
            template.type === "INCOME"
              ? draft.suggestedAmount
              : draft.suggestedAmount.negated(),
          currency: template.currency,
          date: draft.suggestedDate,
          // Stamp the template name as the merchant so the ledger entry is
          // identifiable — without it the row has no description and each view
          // falls back differently (feed → category name, dashboard → "Transaction").
          merchant: template.name,
          financialAccountId: template.financialAccountId,
          categoryId: template.categoryId,
          recurringTemplateId: template.id,
        },
      });
      await tx.recurringTemplate.update({
        where: { id: template.id },
        data: { nextOccurrence },
      });
      return true;
    });

    if (!claimed) return { success: false, error: "Draft is no longer pending." };

    revalidateTransactionViews(); // /transactions + /dashboard + /budgets
    revalidatePath("/recurring");
    void track("draft_confirmed", { cadence: template.cadence });
    return { success: true };
  } catch (error) {
    console.error("confirmDraft failed", error);
    return { success: false, error: "Could not confirm the draft." };
  }
}

/**
 * Dismiss a pending draft: mark it DISMISSED and advance `nextOccurrence` so
 * the series keeps ticking. Atomic + idempotent via the same `updateMany`
 * claim. No undo — dismissing is an intentional "skip this one."
 */
export async function dismissDraft(draftId: string): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  try {
    const draft = await prisma.recurringDraft.findUnique({
      where: { id: draftId },
      include: { recurringTemplate: true },
    });
    if (!draft || draft.recurringTemplate.userId !== userId) {
      return { success: false, error: "Draft not found." };
    }
    if (draft.status !== "PENDING") {
      return { success: false, error: "Draft is no longer pending." };
    }

    const template = draft.recurringTemplate;
    const nextOccurrence = advanceNextOccurrence(
      template.nextOccurrence,
      template.cadence
    );

    const claimed = await prisma.$transaction(async (tx) => {
      const res = await tx.recurringDraft.updateMany({
        where: { id: draftId, status: "PENDING" }, // race gate
        data: { status: "DISMISSED" },
      });
      if (res.count === 0) return false;
      await tx.recurringTemplate.update({
        where: { id: template.id },
        data: { nextOccurrence },
      });
      return true;
    });

    if (!claimed) return { success: false, error: "Draft is no longer pending." };

    revalidateRecurringViews(); // no ledger row created → lighter revalidation
    return { success: true };
  } catch (error) {
    console.error("dismissDraft failed", error);
    return { success: false, error: "Could not dismiss the draft." };
  }
}
