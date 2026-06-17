/**
 * Single source of truth for currency policy across accounts, budgets, goals,
 * onboarding, and `User.preferredCurrency`.
 *
 * EUR-only for the MVP. The app does no FX conversion (post-MVP), so there is no
 * currency picker anywhere — every account is created in `DEFAULT_CURRENCY`,
 * stamped server-side. The set is a tuple so widening support later is a
 * one-line change (add codes here, add a `z.enum(SUPPORTED_CURRENCIES)` field to
 * the account schema, render a `<select>` from the same constant). This is a
 * future-boundary seam, not a runtime multi-currency system: nothing here flexes
 * at runtime today beyond "everything is EUR".
 */
export const SUPPORTED_CURRENCIES = ["EUR"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_CURRENCY: SupportedCurrency = "EUR";

export function isSupportedCurrency(c: string): c is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(c);
}
