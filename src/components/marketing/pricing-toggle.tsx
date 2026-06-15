"use client";

import { cn } from "@/lib/utils";
import type { BillingPeriod } from "@/lib/marketing/pricing";

const PERIODS: BillingPeriod[] = ["monthly", "yearly"];

interface PricingToggleProps {
  value: BillingPeriod;
  onChange: (value: BillingPeriod) => void;
  /** "Save X% with yearly billing" — shown when yearly is active. */
  savingsLabel: string;
}

/** Controlled monthly/yearly segmented toggle for the pricing section. */
export function PricingToggle({
  value,
  onChange,
  savingsLabel,
}: PricingToggleProps) {
  return (
    <div className="mt-8 flex flex-col items-center gap-2">
      <div
        role="group"
        aria-label="Billing period"
        className="inline-flex rounded-lg border border-line bg-surface p-1"
      >
        {PERIODS.map((period) => (
          <button
            key={period}
            type="button"
            aria-pressed={value === period}
            onClick={() => onChange(period)}
            className={cn(
              "rounded-md px-4 py-1.5 text-[13px] font-medium capitalize transition-colors",
              value === period
                ? "bg-success text-white"
                : "text-ink-2 hover:text-ink"
            )}
          >
            {period}
          </button>
        ))}
      </div>
      <span
        aria-hidden={value !== "yearly"}
        className={cn(
          "text-[12px] font-medium text-success transition-opacity",
          value === "yearly" ? "opacity-100" : "opacity-0"
        )}
      >
        {savingsLabel}
      </span>
    </div>
  );
}
