"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { deleteAccount, type DeleteAccountState } from "@/actions/profile";
import { InputFormField } from "@/components/auth/input-form-field";
import { ACCOUNT_DELETION_GRACE_PERIOD_DAYS } from "@/lib/system-constants";

const INITIAL_STATE: DeleteAccountState = {};

interface DeleteAccountDialogProps {
  /** The account email the user must re-type to confirm deletion. */
  email: string;
}

/** Destructive submit button — disabled until the typed email matches. */
function ConfirmDeleteButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-danger text-[13px] font-medium text-white transition-colors hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending && <Loader2 size={15} className="animate-spin" />}
      Delete account
    </button>
  );
}

/** "Delete account" action with a confirmation modal (native <dialog>). */
export function DeleteAccountDialog({ email }: DeleteAccountDialogProps) {
  const [state, formAction] = useActionState(deleteAccount, INITIAL_STATE);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [confirmValue, setConfirmValue] = useState("");

  const matches = confirmValue.trim().toLowerCase() === email.toLowerCase();

  function openDialog() {
    setConfirmValue("");
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <section
      aria-labelledby="delete-account-heading"
      className="rounded-xl border border-danger/30 bg-surface p-6"
    >
      <h2
        id="delete-account-heading"
        className="text-[13px] font-medium text-danger"
      >
        Delete account
      </h2>
      <p className="mt-1 text-[12px] text-ink-2">
        Your account is deactivated immediately. Your data is kept for{" "}
        {ACCOUNT_DELETION_GRACE_PERIOD_DAYS} days before it is permanently
        deleted.
      </p>

      <button
        type="button"
        onClick={openDialog}
        className="mt-4 flex h-9 w-full items-center justify-center rounded-md border border-danger/40 px-4 text-[13px] font-medium text-danger transition-colors hover:bg-danger/10"
      >
        Delete account
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="delete-dialog-title"
        className="m-auto w-[min(92vw,28rem)] rounded-xl border border-line bg-surface p-6 text-ink backdrop:bg-black/60"
      >
        <h3
          id="delete-dialog-title"
          className="text-[15px] font-medium text-ink"
        >
          Delete your account?
        </h3>
        <p className="mt-2 text-[12px] text-ink-2">
          This deactivates your account and schedules all of your data for
          deletion after {ACCOUNT_DELETION_GRACE_PERIOD_DAYS} days. To confirm,
          type your email{" "}
          <span className="font-medium text-ink">{email}</span> below.
        </p>

        <form action={formAction} className="mt-4 flex flex-col gap-4">
          <InputFormField
            id="confirmEmail"
            name="confirmEmail"
            type="email"
            label="Confirm your email"
            placeholder={email}
            autoComplete="off"
            value={confirmValue}
            onChange={(e) => setConfirmValue(e.target.value)}
            required
          />

          {state.error && (
            <p className="text-[12px] text-danger">{state.error}</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={closeDialog}
              className="flex h-9 flex-1 items-center justify-center rounded-md border border-line text-[13px] font-medium text-ink transition-colors hover:bg-surface-2"
            >
              Cancel
            </button>
            <ConfirmDeleteButton disabled={!matches} />
          </div>
        </form>
      </dialog>
    </section>
  );
}
