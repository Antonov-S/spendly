"use client";

import Link from "next/link";
import { useActionState } from "react";
import { authenticate, type SignInState } from "@/actions/auth";
import { InputFormField } from "@/components/auth/input-form-field";
import { SubmitButton } from "@/components/auth/submit-button";
import { GoogleButton } from "@/components/auth/google-button";

const INITIAL_STATE: SignInState = {};

interface SignInFormProps {
  /** Shown after a successful registration redirect (`?registered=1`). */
  justRegistered?: boolean;
  /** Shown after a successful email verification (`?verified=1`). */
  justVerified?: boolean;
}

export function SignInForm({ justRegistered, justVerified }: SignInFormProps) {
  const [state, formAction] = useActionState(authenticate, INITIAL_STATE);

  return (
    <div className="flex flex-col gap-4">
      {justVerified && (
        <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-[12px] text-success">
          Email verified. Sign in to continue.
        </p>
      )}
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

      <p className="text-center text-[11px] text-ink-3">
        Haven&apos;t verified your email?{" "}
        <Link href="/verify-email" className="text-success">
          Resend the link
        </Link>
      </p>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[11px] text-ink-3">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <GoogleButton />
    </div>
  );
}
