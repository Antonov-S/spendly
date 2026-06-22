"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import {
  createCheckoutSession,
  createPortalSession,
} from "@/actions/billing";
import { PRICING } from "@/lib/marketing/pricing";
import type { BillingPeriod } from "@/lib/stripe";
import { cn } from "@/lib/utils";

export type CheckoutResult = "success" | "cancelled" | undefined;

interface BillingActionsProps {
  isPro: boolean;
  /** Whether the user already has a Stripe customer (drives the Pro branch). */
  hasCustomer: boolean;
  /** `?checkout=` outcome on return from Stripe; renders a one-line banner. */
  checkoutResult: CheckoutResult;
}

/**
 * The Free/Pro action buttons for the Settings Billing card (the §8 seam). The
 * success path of both actions `redirect()`s to Stripe (or back), so there's no
 * client navigation — just a pending state and an inline error. Errors are shown
 * inline (not via Sonner) because `/settings` renders outside AppShell, where no
 * `<Toaster/>` is mounted; this matches the sibling name form's banner pattern.
 */
export function BillingActions({
  isPro,
  hasCustomer,
  checkoutResult,
}: BillingActionsProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function runUpgrade(period: BillingPeriod) {
    setError(null);
    startTransition(async () => {
      const result = await createCheckoutSession(period);
      if (result?.error) setError(result.error);
    });
  }

  function runManage() {
    setError(null);
    startTransition(async () => {
      const result = await createPortalSession();
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      {checkoutResult === "success" && (
        <p
          role="status"
          className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-[12px] text-success"
        >
          Welcome to Pro 🎉 Your full reports history is unlocked.
        </p>
      )}
      {checkoutResult === "cancelled" && (
        <p
          role="status"
          className="rounded-md border border-line bg-app px-3 py-2 text-[12px] text-ink-2"
        >
          Checkout cancelled — no changes were made.
        </p>
      )}

      {isPro ? (
        <BillingButton variant="neutral" pending={pending} onClick={runManage}>
          {hasCustomer ? "Manage subscription" : "Manage billing"}
        </BillingButton>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <BillingButton
            variant="primary"
            pending={pending}
            onClick={() => runUpgrade("monthly")}
          >
            Upgrade — {PRICING.currency}
            {PRICING.monthly}/mo
          </BillingButton>
          <BillingButton
            variant="primary"
            pending={pending}
            onClick={() => runUpgrade("yearly")}
          >
            Upgrade — {PRICING.currency}
            {PRICING.yearly}/yr
          </BillingButton>
        </div>
      )}

      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}

function BillingButton({
  children,
  variant,
  pending,
  onClick,
}: {
  children: React.ReactNode;
  variant: "primary" | "neutral";
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onClick}
      className={cn(
        "flex h-9 w-full items-center justify-center gap-2 rounded-md text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        variant === "primary"
          ? "bg-success text-white hover:bg-success/90"
          : "border border-line text-ink hover:bg-app"
      )}
    >
      {pending && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}
