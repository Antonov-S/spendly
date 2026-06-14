"use client";

import { useState } from "react";
import { InputFormField } from "@/components/auth/input-form-field";
import { SubmitButton } from "@/components/auth/submit-button";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setSent(false);
    setPending(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? "Something went wrong. Please try again.");
        return;
      }

      setSent(true);
    } catch {
      setError("Unable to reach the server. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <InputFormField
        id="email"
        name="email"
        type="email"
        label="Email"
        placeholder="you@example.com"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />

      {sent && (
        <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-[12px] text-success">
          If an account exists for that email, a reset link is on its way.
        </p>
      )}
      {error && <p className="text-[12px] text-danger">{error}</p>}

      <SubmitButton pending={pending}>Send reset link</SubmitButton>
    </form>
  );
}
