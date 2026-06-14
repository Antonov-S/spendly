"use client";

import { useState } from "react";
import Link from "next/link";
import { InputFormField } from "@/components/auth/input-form-field";
import { SubmitButton } from "@/components/auth/submit-button";
import { resetPasswordSchema } from "@/lib/validations/auth";

type FieldErrors = Partial<Record<"password" | "confirmPassword", string>>;

interface ResetPasswordFormProps {
  /** The reset token read from the `?token=` query on the page. */
  token: string;
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);

    const parsed = resetPasswordSchema.safeParse({
      token,
      password,
      confirmPassword,
    });
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof FieldErrors;
        if (field) errors[field] ??= issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setPending(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setFormError(data?.error ?? "Something went wrong. Please try again.");
        return;
      }

      setDone(true);
    } catch {
      setFormError("Unable to reach the server. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-[12px] text-success">
          Your password has been reset. You can now sign in with your new
          password.
        </p>
        <Link
          href="/sign-in"
          className="flex h-9 w-full items-center justify-center rounded-md bg-success text-[13px] font-medium text-white transition-colors hover:bg-success/90"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <InputFormField
        id="password"
        name="password"
        type="password"
        label="New password"
        placeholder="At least 8 characters"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={fieldErrors.password}
        required
      />
      <InputFormField
        id="confirmPassword"
        name="confirmPassword"
        type="password"
        label="Confirm new password"
        placeholder="Re-enter your password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        error={fieldErrors.confirmPassword}
        required
      />

      {formError && <p className="text-[12px] text-danger">{formError}</p>}

      <SubmitButton pending={pending}>Reset password</SubmitButton>
    </form>
  );
}
