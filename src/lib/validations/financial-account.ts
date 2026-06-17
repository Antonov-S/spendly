import { z } from "zod";
import { STARTING_BALANCE_MAX } from "@/lib/system-constants";
import { ACCOUNT_ICONS } from "@/lib/constants";

/**
 * Validation for the financial-account write actions.
 *
 * EUR-only MVP: there is **no** `currency` field — the action stamps
 * `DEFAULT_CURRENCY` server-side, never trusting the client. `startingBalance`
 * is **signed** (liability accounts open negative). `icon` is restricted to the
 * `ACCOUNT_ICONS` whitelist; an icon outside it has no `icon-map.ts` mapping and
 * would render blank, so it's rejected at the boundary.
 */

const hexColor = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Pick a valid color");

const accountIcon = z.enum(ACCOUNT_ICONS);

/** Optional color: trims null/""/undefined → null. */
const optionalColor = hexColor
  .nullish()
  .transform((v) => (v ? v : null));

/** Optional icon: null/""/undefined → null; otherwise must be whitelisted. */
const optionalIcon = z
  .union([accountIcon, z.literal(""), z.null()])
  .nullish()
  .transform((v) => (v ? v : null));

/** Signed money magnitude bounded by ±STARTING_BALANCE_MAX. */
const startingBalance = z.coerce
  .number()
  .refine((n) => Number.isFinite(n), "Enter a valid amount")
  .refine((n) => Math.abs(n) <= STARTING_BALANCE_MAX, "Out of range");

export const createAccountSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  type: z.enum([
    "CHECKING",
    "SAVINGS",
    "CREDIT_CARD",
    "CASH",
    "INVESTMENT",
    "OTHER",
  ]),
  startingBalance,
  color: optionalColor,
  icon: optionalIcon,
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;

/** Edit: only name, color, icon are mutable. type/startingBalance are immutable. */
export const updateAccountSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Name is required").max(60),
  color: optionalColor,
  icon: optionalIcon,
});

export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
