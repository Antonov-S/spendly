"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionHeading } from "@/components/marketing/section-heading";
import { PricingToggle } from "@/components/marketing/pricing-toggle";
import {
  PRICING,
  PRICING_PLANS,
  PRICING_SECTION,
  yearlyDiscountPercent,
  type BillingPeriod,
} from "@/lib/marketing/pricing";

/**
 * Pricing section with a monthly/yearly toggle. Prices and the yearly-savings
 * percentage come from the data module — no numbers are hardcoded here. CTAs
 * link to /register (real checkout is a separate post-auth flow).
 */
export function Pricing() {
  const [billing, setBilling] = useState<BillingPeriod>("monthly");
  const savingsLabel = `Save ${yearlyDiscountPercent()}% with yearly billing`;

  return (
    <section
      id="pricing"
      aria-labelledby="pricing-heading"
      className="scroll-mt-20 bg-sidebar px-6 py-16 sm:py-20"
    >
      <div className="mx-auto w-full max-w-6xl">
        <SectionHeading
          eyebrow={PRICING_SECTION.eyebrow}
          title={PRICING_SECTION.title}
          subtitle={PRICING_SECTION.subtitle}
          headingId="pricing-heading"
        />

        <PricingToggle
          value={billing}
          onChange={setBilling}
          savingsLabel={savingsLabel}
        />

        <div className="mx-auto mt-10 grid max-w-3xl grid-cols-1 gap-5 md:grid-cols-2">
          {PRICING_PLANS.map((plan) => {
            const isFree = plan.monthlyPrice === 0;
            const amount =
              billing === "monthly" ? plan.monthlyPrice : plan.yearlyPrice;
            const periodSuffix = isFree
              ? "forever"
              : billing === "monthly"
                ? "per month"
                : "per year";

            return (
              <div
                key={plan.name}
                className={cn(
                  "relative flex flex-col rounded-2xl border bg-surface p-6",
                  plan.highlighted
                    ? "border-success/50 ring-1 ring-success/30"
                    : "border-line"
                )}
              >
                {plan.badge && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-success px-3 py-0.5 text-[11px] font-semibold text-white">
                    {plan.badge}
                  </span>
                )}

                <h3 className="text-[15px] font-semibold text-ink">
                  {plan.name}
                </h3>
                <p className="mt-1 text-[13px] text-ink-2">{plan.tagline}</p>

                <div className="mt-5 flex items-baseline gap-1.5">
                  <span className="text-[34px] font-semibold leading-none text-ink">
                    {PRICING.currency}
                    {amount}
                  </span>
                  <span className="text-[13px] text-ink-3">{periodSuffix}</span>
                </div>

                <Link
                  href={plan.cta.href}
                  className={cn(
                    "mt-6 flex h-10 items-center justify-center rounded-lg px-4 text-[13px] font-semibold transition-colors",
                    plan.highlighted
                      ? "bg-success text-white ring-1 ring-inset ring-white/15 hover:bg-success/90"
                      : "border border-line bg-surface-2 text-ink hover:bg-surface"
                  )}
                >
                  {plan.cta.label}
                </Link>

                <ul className="mt-6 flex flex-col gap-2.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5">
                      <Check
                        size={15}
                        className="mt-0.5 shrink-0 text-success"
                        strokeWidth={2.5}
                      />
                      <span className="text-[13px] leading-relaxed text-ink-2">
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
