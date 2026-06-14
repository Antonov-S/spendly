"use client";

import { useActionState, useEffect, useRef } from "react";
import { changePassword, type ChangePasswordState } from "@/actions/profile";
import { InputFormField } from "@/components/auth/input-form-field";
import { SubmitButton } from "@/components/auth/submit-button";

const INITIAL_STATE: ChangePasswordState = {};

/** Inline form to update the current user's password (email accounts only). */
export function ChangePasswordForm() {
  const [state, formAction] = useActionState(changePassword, INITIAL_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the fields once the password has been changed successfully.
  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state.success]);

  return (
    <section
      aria-labelledby="change-password-heading"
      className="rounded-xl border border-line bg-surface p-6"
    >
      <h2
        id="change-password-heading"
        className="text-[13px] font-medium text-ink"
      >
        Change password
      </h2>
      <p className="mt-1 text-[12px] text-ink-2">
        Enter your current password to set a new one.
      </p>

      <form
        ref={formRef}
        action={formAction}
        className="mt-4 flex flex-col gap-4"
        noValidate
      >
        <InputFormField
          id="currentPassword"
          name="currentPassword"
          type="password"
          label="Current password"
          placeholder="••••••••"
          autoComplete="current-password"
          required
        />
        <InputFormField
          id="newPassword"
          name="newPassword"
          type="password"
          label="New password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          required
        />
        <InputFormField
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          label="Confirm new password"
          placeholder="Re-enter your new password"
          autoComplete="new-password"
          required
        />

        {state.error && <p className="text-[12px] text-danger">{state.error}</p>}
        {state.success && (
          <p
            role="status"
            className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-[12px] text-success"
          >
            Your password has been updated.
          </p>
        )}

        <SubmitButton>Update password</SubmitButton>
      </form>
    </section>
  );
}
