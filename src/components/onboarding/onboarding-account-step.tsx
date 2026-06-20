"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createFinancialAccount } from "@/actions/financial-accounts";
import { InputFormField } from "@/components/auth/input-form-field";
import { SubmitButton } from "@/components/auth/submit-button";
import {
  ACCOUNT_TYPE_OPTIONS,
  DEFAULT_ACCOUNT_COLOR,
  DEFAULT_ACCOUNT_ICON,
  ONBOARDING_STEP_PARAM,
} from "@/lib/constants";
import type { AccountTypeValue } from "@/types/accounts";

interface OnboardingAccountStepProps {
  /** Called once the account is created — advances the flow to Step 2. */
  onCreated: () => void;
}

const DEFAULT_TYPE: AccountTypeValue = "CHECKING";

/**
 * Step 1 (mandatory) — an inline first-account form. Onboarding is the focus
 * surface, so this is a plain form rather than the slide-in drawer. Color/icon
 * are defaulted (refined later on /accounts); currency is stamped EUR
 * server-side. Calls the existing `createFinancialAccount` action.
 */
export function OnboardingAccountStep({ onCreated }: OnboardingAccountStepProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountTypeValue>(DEFAULT_TYPE);
  const [startingBalance, setStartingBalance] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      // Mark the flow in-progress in the URL *before* the mutation. Creating
      // the account flips the user to "has an active account", and the Server
      // Action's implicit refresh of /onboarding would otherwise trip the
      // reverse guard and eject the user to /dashboard before Step 2 renders.
      // The ?step marker tells the page's guard "mid-flow — don't bounce".
      router.replace(`/onboarding?${ONBOARDING_STEP_PARAM}=budgets`, {
        scroll: false,
      });
      const res = await createFinancialAccount({
        name,
        type,
        startingBalance: Number(startingBalance || 0),
        color: DEFAULT_ACCOUNT_COLOR,
        icon: DEFAULT_ACCOUNT_ICON,
      });
      if (res.success) {
        onCreated();
      } else {
        // Revert the marker so a fresh reload is treated as a fresh visit.
        router.replace("/onboarding", { scroll: false });
        setError(res.error ?? "Could not create the account.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <InputFormField
        id="account-name"
        label="Account name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Checking"
        autoFocus
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="account-type" className="text-[12px] font-medium text-ink-2">
          Type
        </label>
        <select
          id="account-type"
          value={type}
          onChange={(e) => setType(e.target.value as AccountTypeValue)}
          className="rounded-md border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none transition-colors focus:border-ink-3"
        >
          {ACCOUNT_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="account-balance"
          className="text-[12px] font-medium text-ink-2"
        >
          Starting balance
        </label>
        <div className="flex items-center rounded-md border border-line bg-app px-3 transition-colors focus-within:border-ink-3">
          <span className="text-[15px] font-medium text-ink-3">€</span>
          <input
            id="account-balance"
            type="text"
            inputMode="decimal"
            value={startingBalance}
            onChange={(e) => setStartingBalance(e.target.value)}
            placeholder="0.00"
            className="w-full bg-transparent py-2 pl-1.5 text-[13px] text-ink outline-none placeholder:text-ink-3"
          />
        </div>
        <span className="text-[11px] text-ink-3">
          Use a negative value for a card or loan you already owe on.
        </span>
      </div>

      {error && <p className="text-[12px] text-danger">{error}</p>}

      <SubmitButton pending={isPending}>Continue</SubmitButton>
    </form>
  );
}
