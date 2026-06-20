"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";
import { REPORT_PERIOD_OPTIONS } from "@/lib/constants";
import {
  isPeriodAllowed,
  type PeriodMonths,
  type ReportPeriod,
} from "@/lib/report-period";
import { cn } from "@/lib/utils";

/**
 * URL-driven period pills. Highlights the **effective** window (so a clamped
 * Free 12m request highlights "Last 3 months", matching what's drawn). The
 * 12-month pill carries a lock glyph for Free users but stays clickable —
 * navigating to `?period=12m` is itself the upgrade affordance: the page clamps
 * the data to 3 months and surfaces the upgrade banner. Other params (`account`)
 * are preserved.
 */
export function PeriodSelector({
  effective,
  isPro,
}: {
  effective: ReportPeriod;
  isPro: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function selectPeriod(param: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", param);
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div
      role="group"
      aria-label="Reporting period"
      className="flex items-center gap-1 rounded-lg border border-line bg-surface p-1"
    >
      {REPORT_PERIOD_OPTIONS.map((option) => {
        const active = option.param === effective.param;
        const locked = !isPeriodAllowed(option.months as PeriodMonths, isPro);
        return (
          <button
            key={option.param}
            type="button"
            onClick={() => selectPeriod(option.param)}
            aria-current={active ? "true" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors",
              active
                ? "bg-surface-2 text-ink"
                : "text-ink-2 hover:text-ink"
            )}
          >
            <span className="whitespace-nowrap">{option.label}</span>
            {locked && <Lock size={11} className="text-ink-3" />}
          </button>
        );
      })}
    </div>
  );
}
