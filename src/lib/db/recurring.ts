import "server-only";
import { prisma } from "@/lib/prisma";
import { startOfUtcDay, toDateInputValue } from "@/lib/date";
import {
  mapTemplateRow,
  mapDraftRow,
  type TemplateRow,
  type DraftRow,
  type RecurringType,
} from "@/lib/recurring";
import type { RecurringCadence } from "@/generated/prisma/client";

/**
 * Editable pre-fill for the drawer. Only `name`, `amount`, and `cadence` are
 * mutable; `type`, `nextOccurrence`, `financialAccountId`, and `categoryId` are
 * returned so the form can show them disabled-but-populated in edit mode.
 */
export interface TemplateEditable {
  id: string;
  name: string;
  type: RecurringType;
  amount: number;
  cadence: RecurringCadence;
  nextOccurrence: string; // "YYYY-MM-DD"
  financialAccountId: string;
  categoryId: string | null;
}

const categorySelect = {
  select: { id: true, name: true, icon: true, color: true },
} as const;

/**
 * All of the user's templates (active + paused) with category and account name.
 * Active first, then soonest-due — management screens care about upcoming
 * activity. The UI still groups Active/Paused; this keeps order stable within
 * each split.
 */
export async function getTemplates(userId: string): Promise<TemplateRow[]> {
  const rows = await prisma.recurringTemplate.findMany({
    where: { userId },
    include: {
      category: categorySelect,
      financialAccount: { select: { name: true } },
    },
    orderBy: [{ isActive: "desc" }, { nextOccurrence: "asc" }],
  });
  return rows.map(mapTemplateRow);
}

/**
 * All PENDING drafts belonging to this user's templates, joined to the template
 * for display. CONFIRMED/DISMISSED drafts are retained for audit but never
 * surfaced.
 */
export async function getPendingDrafts(userId: string): Promise<DraftRow[]> {
  const rows = await prisma.recurringDraft.findMany({
    where: { status: "PENDING", recurringTemplate: { userId } },
    include: {
      recurringTemplate: {
        include: {
          financialAccount: { select: { name: true } },
          category: categorySelect,
        },
      },
    },
    orderBy: { suggestedDate: "asc" },
  });
  return rows.map(mapDraftRow);
}

/** Editable pre-fill for a single template, scoped to the owner. */
export async function getTemplateForEdit(
  userId: string,
  id: string
): Promise<TemplateEditable | null> {
  const template = await prisma.recurringTemplate.findFirst({
    where: { id, userId },
    select: {
      id: true,
      name: true,
      type: true,
      amount: true,
      cadence: true,
      nextOccurrence: true,
      financialAccountId: true,
      categoryId: true,
    },
  });
  if (!template) return null;
  return {
    id: template.id,
    name: template.name,
    type: template.type as RecurringType,
    amount: Number(template.amount),
    cadence: template.cadence,
    nextOccurrence: toDateInputValue(template.nextOccurrence),
    financialAccountId: template.financialAccountId,
    categoryId: template.categoryId,
  };
}

/**
 * The MVP substitute for a background scheduler — called server-side on every
 * `/recurring` page load. For each active template whose `nextOccurrence` is
 * today or past and that has no outstanding PENDING draft, insert one PENDING
 * draft snapshotting the template's date and amount.
 *
 * Idempotent. `skipDuplicates` → `ON CONFLICT DO NOTHING`, which defers to the
 * partial unique index `(recurringTemplateId) WHERE status = 'PENDING'`: two
 * concurrent loads can't double-insert. The `drafts.length` filter below is an
 * optimization to skip pointless insert attempts; the index is the real guard.
 */
export async function generatePendingDrafts(userId: string): Promise<void> {
  const today = startOfUtcDay(new Date());

  const due = await prisma.recurringTemplate.findMany({
    where: { userId, isActive: true, nextOccurrence: { lte: today } },
    include: {
      drafts: { where: { status: "PENDING" }, select: { id: true }, take: 1 },
    },
  });

  const toCreate = due
    .filter((t) => t.drafts.length === 0)
    .map((t) => ({
      recurringTemplateId: t.id,
      suggestedDate: t.nextOccurrence,
      suggestedAmount: t.amount,
    }));

  if (toCreate.length > 0) {
    await prisma.recurringDraft.createMany({
      data: toCreate,
      skipDuplicates: true,
    });
  }
}
