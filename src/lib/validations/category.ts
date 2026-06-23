import { z } from "zod";
import { CATEGORY_ICONS } from "@/lib/constants";

/**
 * Validation for the category write actions.
 *
 * `icon` is restricted to the `CATEGORY_ICONS` whitelist — an icon outside it has
 * no `icon-map.ts` mapping and would render as the `HelpCircle` fallback, so it's
 * rejected at the boundary (same contract as `ACCOUNT_ICONS`). `userId` and
 * `isSystem` are NEVER accepted from the client — the action stamps them.
 */

const hexColor = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Pick a valid color");

const categoryIcon = z.enum(CATEGORY_ICONS);

/** Create: name + icon + color. isSystem/userId are server-set. */
export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(50),
  icon: categoryIcon,
  color: hexColor,
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

/** Update: same fields, patchable. id identifies the row; ownership checked server-side. */
export const updateCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Name is required").max(50).optional(),
  icon: categoryIcon.optional(),
  color: hexColor.optional(),
});

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
