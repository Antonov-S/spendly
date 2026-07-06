"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  updateAnalyticsPreference,
  type UpdateAnalyticsPreferenceState,
} from "@/actions/profile";

const INITIAL_STATE: UpdateAnalyticsPreferenceState = {};
const SUCCESS_VISIBLE_MS = 3000;

interface AnalyticsPreferenceFormProps {
  enabled: boolean;
}

export function AnalyticsPreferenceForm({
  enabled,
}: AnalyticsPreferenceFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    updateAnalyticsPreference,
    INITIAL_STATE
  );
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const showSaved = state.success === true && state.at !== dismissedAt;

  useEffect(() => {
    if (!showSaved) return;
    const at = state.at ?? null;
    const t = setTimeout(() => setDismissedAt(at), SUCCESS_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [showSaved, state.at]);

  return (
    <form ref={formRef} action={formAction} className="mt-4" noValidate>
      <input type="hidden" name="enabled" value="false" />
      <label className="flex gap-3 rounded-lg border border-line bg-app p-3">
        <input
          type="checkbox"
          name="enabled"
          value="true"
          defaultChecked={enabled}
          disabled={pending}
          onChange={() => formRef.current?.requestSubmit()}
          className="mt-0.5 h-4 w-4 accent-success"
        />
        <span className="min-w-0">
          <span className="block text-[12px] font-medium text-ink">
            Usage analytics
          </span>
          <span className="mt-1 block text-[12px] leading-5 text-ink-2">
            Help improve Spendly by sharing which features you use. This is
            linked to your account but never includes amounts, balances, names,
            notes, or merchants, and is deleted with your account.
          </span>
          {state.error && (
            <span className="mt-2 block text-[12px] text-danger">
              {state.error}
            </span>
          )}
          {showSaved && (
            <span
              role="status"
              className="mt-2 block text-[12px] text-success"
            >
              Usage analytics setting saved.
            </span>
          )}
        </span>
      </label>
    </form>
  );
}
