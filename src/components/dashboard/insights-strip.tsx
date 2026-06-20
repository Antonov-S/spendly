import Link from "next/link";
import type { InsightItem } from "@/types/dashboard";

/** Tinted pill classes keyed on tone — warning matches the goals overdue badge,
 *  info matches the "View all →" link accent. */
const TONE_CLASS: Record<InsightItem["tone"], string> = {
  warning: "bg-warning/15 text-warning",
  info: "bg-info/15 text-info",
};

/**
 * Actionable insights strip: a row of link pills for budgets at risk, pending
 * recurring drafts, and overdue goals. Renders nothing when there is nothing to
 * act on — an empty `items` array is the calm state, not a missing feature.
 */
export function InsightsStrip({ items }: { items: InsightItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 lg:my-1 lg:gap-3">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className={`rounded-full px-3 py-1 text-[11px] font-medium transition-opacity hover:opacity-80 ${TONE_CLASS[item.tone]}`}
        >
          {item.label} →
        </Link>
      ))}
    </div>
  );
}
