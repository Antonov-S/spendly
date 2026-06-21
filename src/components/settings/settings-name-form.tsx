"use client";

import { useActionState, useEffect, useState } from "react";
import { updateProfile, type UpdateProfileState } from "@/actions/profile";
import { InputFormField } from "@/components/auth/input-form-field";
import { SubmitButton } from "@/components/auth/submit-button";

const INITIAL_STATE: UpdateProfileState = {};

/** How long the success banner stays before auto-dismissing (ms). */
const SUCCESS_VISIBLE_MS = 5000;

interface SettingsNameFormProps {
  /** Current display name (server-confirmed); prefilled into the field. */
  name: string | null;
  /** Shown read-only for orientation; not editable here. */
  email: string | null;
}

/**
 * Edit the signed-in user's display name. Uses `useActionState` so the form's
 * `action` drives `SubmitButton`'s `useFormStatus` pending spinner, and the
 * result survives the implicit post-action route refresh. The success banner is
 * shown derived from state (no setState-to-show) and auto-dismisses after a few
 * seconds via a timeout — the action returns a fresh `at` each save so a repeat
 * save re-shows the banner. No optimistic UI.
 */
export function SettingsNameForm({ name, email }: SettingsNameFormProps) {
  const [state, formAction] = useActionState(updateProfile, INITIAL_STATE);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  // Visible for a successful save we haven't auto-dismissed yet.
  const showBanner = state.success === true && state.at !== dismissedAt;

  // Schedule the auto-dismiss. setState lives in the timeout (not the effect
  // body), so this stays clear of the set-state-in-effect rule.
  useEffect(() => {
    if (!showBanner) return;
    const at = state.at ?? null;
    const t = setTimeout(() => setDismissedAt(at), SUCCESS_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [showBanner, state.at]);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-4" noValidate>
      {email && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink-2">Email</span>
          <p className="rounded-md border border-line bg-app px-3 py-2 text-[13px] text-ink-2">
            {email}
          </p>
        </div>
      )}

      <InputFormField
        id="name"
        name="name"
        type="text"
        label="Display name"
        placeholder="Your name"
        defaultValue={name ?? ""}
        autoComplete="name"
        maxLength={80}
        required
      />

      {state.error && <p className="text-[12px] text-danger">{state.error}</p>}
      {showBanner && (
        <p
          role="status"
          className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-[12px] text-success"
        >
          Your name has been updated.
        </p>
      )}

      <SubmitButton>Save changes</SubmitButton>
    </form>
  );
}
