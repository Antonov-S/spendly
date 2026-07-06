import { z } from "zod";
import { PROFILE_NAME_MAX } from "@/lib/system-constants";

/**
 * Validation for the profile write actions. Only the display `name` is editable;
 * `email`, `isPro`, `preferredCurrency`, and `stripe*` are never accepted from
 * the client. The name is a presentation label — required-when-present (no
 * blanking) but not unique.
 */
export const updateProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name cannot be empty.")
    .max(PROFILE_NAME_MAX, `Name must be ${PROFILE_NAME_MAX} characters or fewer.`),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const updateAnalyticsPreferenceSchema = z.object({
  enabled: z.boolean(),
});

export type UpdateAnalyticsPreferenceInput = z.infer<
  typeof updateAnalyticsPreferenceSchema
>;
