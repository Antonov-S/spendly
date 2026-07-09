import { z } from "zod";
import { TAG_NAME_MAX } from "@/lib/system-constants";

/**
 * Validation for the tag write actions. Mirrors `validations/category.ts`, minus
 * the icon (tags have no icon — only an optional accent color). `color` is a free
 * hex string, optional (a tag can be name-only). `userId` is NEVER accepted from
 * the client — the action stamps it from the session.
 */

export const TAG_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

const hexColor = z.string().regex(TAG_COLOR_PATTERN, "Pick a valid color");

/** Create: name (required) + optional color. */
export const createTagSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(TAG_NAME_MAX),
  color: hexColor.optional(),
});

export type CreateTagInput = z.infer<typeof createTagSchema>;

/**
 * Update: name/color patchable. `id` identifies the row (ownership checked
 * server-side). `color` is nullish so a user can clear it back to a neutral chip.
 */
export const updateTagSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Name is required").max(TAG_NAME_MAX).optional(),
  color: hexColor.nullish(),
});

export type UpdateTagInput = z.infer<typeof updateTagSchema>;
