"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getTagForEdit as getTagForEditQuery } from "@/lib/db/tags";
import { revalidateTagViews } from "@/lib/revalidation";
import {
  createTagSchema,
  updateTagSchema,
  type CreateTagInput,
  type UpdateTagInput,
} from "@/lib/validations/tag";
import type { TagOption, EditableTag } from "@/types/tags";

/** Standard mutation result for the write actions. */
export interface MutationResult {
  success: boolean;
  error?: string;
}

/** `createTag` returns the persisted row so the picker can auto-select it. */
export type CreateTagResult =
  | { success: true; data: TagOption }
  | { success: false; error: string };

const NOT_AUTHED: MutationResult = {
  success: false,
  error: "You must be signed in.",
};

const NOT_FOUND = "Tag not found.";
const DUPLICATE_ERROR = "A tag with that name already exists.";

/** True when a thrown error is a Prisma unique-constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Case-insensitive dedup pre-check against the user's OWN tags (there is no
 * system tier, so a single owner axis covers everything). Gives an instant
 * friendly error on the common path; the functional `(lower(name), userId)`
 * index is the race-proof backstop. Pass `editingId` to exclude the row being
 * renamed (so recasing your own tag is allowed). Returns an error message, or
 * null when the name is free.
 */
async function assertTagNameAvailable(
  userId: string,
  name: string,
  editingId?: string
): Promise<string | null> {
  const clash = await prisma.tag.findFirst({
    where: {
      userId,
      name: { equals: name, mode: "insensitive" },
      ...(editingId ? { NOT: { id: editingId } } : {}),
    },
    select: { id: true },
  });
  return clash ? DUPLICATE_ERROR : null;
}

/**
 * Map a thrown write error to a friendly result, or null when the caller should
 * rethrow. A P2002 here is the functional index firing on a race the pre-check
 * couldn't see — surface the same "already exists" message, never a 500.
 */
function mapTagWriteError(error: unknown): MutationResult | null {
  if (isUniqueViolation(error)) {
    return { success: false, error: DUPLICATE_ERROR };
  }
  return null;
}

/**
 * Create a user tag. `userId` is stamped from the session — never accepted from
 * the client. Returns the persisted row as a `TagOption` so an inline picker can
 * append-and-select it without an optimistic guess.
 */
export async function createTag(input: CreateTagInput): Promise<CreateTagResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: NOT_AUTHED.error! };
  const userId = session.user.id;

  const parsed = createTagSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { name, color } = parsed.data;

  try {
    const clash = await assertTagNameAvailable(userId, name);
    if (clash) return { success: false, error: clash };

    const created = await prisma.tag.create({
      data: { name, color: color ?? null, userId },
      select: { id: true, name: true, color: true },
    });

    revalidateTagViews();
    return { success: true, data: created };
  } catch (error) {
    const mapped = mapTagWriteError(error);
    if (mapped) return mapped as CreateTagResult;
    console.error("createTag failed", error);
    return { success: false, error: "Could not create the tag." };
  }
}

/**
 * Patch a user tag's name / color. Ownership-scoped: another user's row matches
 * zero rows and collapses to "not found" (non-enumerable). Dedup runs only when
 * the name changes, excluding the row itself so recasing is allowed. `color`
 * can be set to null to clear it back to a neutral chip.
 */
export async function updateTag(input: UpdateTagInput): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  const parsed = updateTagSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { id, name, color } = parsed.data;

  try {
    const existing = await prisma.tag.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) return { success: false, error: NOT_FOUND };

    if (name !== undefined) {
      const clash = await assertTagNameAvailable(userId, name, id);
      if (clash) return { success: false, error: clash };
    }

    await prisma.tag.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(color !== undefined ? { color: color ?? null } : {}),
      },
    });

    revalidateTagViews();
    return { success: true };
  } catch (error) {
    const mapped = mapTagWriteError(error);
    if (mapped) return mapped;
    console.error("updateTag failed", error);
    return { success: false, error: "Could not update the tag." };
  }
}

/**
 * Hard delete a user tag (no `deletedAt`, no undo — guarded by a confirm dialog).
 * Ownership-scoped. The `TransactionTag` joins cascade away automatically;
 * transactions survive, they just lose the label.
 */
export async function deleteTag(id: string): Promise<MutationResult> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  try {
    const existing = await prisma.tag.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) return { success: false, error: NOT_FOUND };

    await prisma.tag.delete({ where: { id } });

    revalidateTagViews();
    return { success: true };
  } catch (error) {
    console.error("deleteTag failed", error);
    return { success: false, error: "Could not delete the tag." };
  }
}

/** Thin auth-guarded proxy over the read fetcher, for the drawer's edit pre-fill. */
export async function getTagForEdit(id: string): Promise<{
  success: boolean;
  data?: EditableTag;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: NOT_AUTHED.error };

  try {
    const tag = await getTagForEditQuery(session.user.id, id);
    if (!tag) return { success: false, error: NOT_FOUND };
    return { success: true, data: tag };
  } catch (error) {
    console.error("getTagForEdit failed", error);
    return { success: false, error: "Could not load the tag." };
  }
}
