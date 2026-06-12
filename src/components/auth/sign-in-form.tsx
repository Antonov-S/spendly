"use client";

import { useActionState } from "react";
import { authenticate, type SignInState } from "@/actions/auth";
import { InputFormField } from "@/components/auth/input-form-field";
import { SubmitButton } from "@/components/auth/submit-button";
import { GoogleButton } from "@/components/auth/google-button";

const INITIAL_STATE: SignInState = {};

interface SignInFormProps {
  /** Shown after a successful registration redirect (`?registered=1`). */
  justRegistered?: boolean;
}

export function SignInForm({ justRegistered }: SignInFormProps) {
  const [state, formAction] = useActionState(authenticate, INITIAL_STATE);

  return (
    <div className="flex flex-col gap-4">
      {justRegistered && (
        <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-[12px] text-success">
          Account created. Sign in to continue.
        </p>
      )}

      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <InputFormField
          id="email"
          name="email"
          type="email"
          label="Email"
          placeholder="you@example.com"
          autoComplete="email"
          required
        />
        <InputFormField
          id="password"
          name="password"
          type="password"
          label="Password"
          placeholder="••••••••"
          autoComplete="current-password"
          required
        />

        {state.error && (
          <p className="text-[12px] text-danger">{state.error}</p>
        )}

        <SubmitButton>Sign in</SubmitButton>
      </form>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[11px] text-ink-3">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <GoogleButton />
    </div>
  );
}
