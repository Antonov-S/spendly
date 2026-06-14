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
  /** Shown after an account deletion (`?deleted=1`). */
  justDeleted?: boolean;
  /** When true, surface the resend-verification link after a failed sign-in. */
  emailVerificationEnabled?: boolean;
  /** Set when NextAuth redirects with `?error=OAuthAccountNotLinked`. */
  oauthError?: "OAuthAccountNotLinked";
}

export function SignInForm({
  justRegistered,
  justVerified,
  justDeleted,
  emailVerificationEnabled,
  oauthError,
}: SignInFormProps) {
  const [state, formAction] = useActionState(authenticate, INITIAL_STATE);

  return (
    <div className="flex flex-col gap-4">
      {oauthError === "OAuthAccountNotLinked" && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          This email is already registered with a password. Please sign in with
          your email and password instead.
        </p>
      )}
      {state.rateLimited && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          {state.error}
        </p>
      )}
      {justDeleted && (
        <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-2">
          Your account has been deactivated and is scheduled for deletion.
        </p>
      )}
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

        {state.error && !state.rateLimited && (
          <p className="text-[12px] text-danger">{state.error}</p>
        )}

        <div className="-mt-1 text-right">
          <Link
            href="/forgot-password"
            className="text-[11px] text-ink-3 hover:text-ink-2"
          >
            Forgot password?
          </Link>
        </div>

        <SubmitButton>Sign in</SubmitButton>
      </form>

      {emailVerificationEnabled && state.error && !state.rateLimited && (
        <p className="text-center text-[11px] text-ink-3">
          Haven&apos;t verified your email?{" "}
          <Link href="/verify-email" className="text-success">
            Resend the link
          </Link>
        </p>
      )}

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[11px] text-ink-3">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <GoogleButton />
    </div>
  );
}
