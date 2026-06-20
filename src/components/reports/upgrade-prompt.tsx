import { Sparkles } from "lucide-react";
import { REPORTS_FREE_MAX_MONTHS } from "@/lib/system-constants";

/**
 * Free-tier 12-month gate banner, shown **above** the chart grid when a Free
 * user requested the 12-month window (the grid still renders the entitled
 * 3-month charts beneath). Names the clamp explicitly so the URL/rendered-data
 * mismatch is legible. Informational only — the billing surface (`/settings`)
 * is not built yet, so there is no dead CTA (never UI without backing function).
 */
export function UpgradePrompt() {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3">
      <Sparkles size={16} className="mt-0.5 shrink-0 text-warning" />
      <div>
        <p className="text-[13px] font-medium text-ink">
          Showing the last {REPORTS_FREE_MAX_MONTHS} months
        </p>
        <p className="mt-0.5 text-[12px] text-ink-2">
          Upgrade to Pro for the full 12-month reporting window.
        </p>
      </div>
    </div>
  );
}
