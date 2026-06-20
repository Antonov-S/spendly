import type { ReactNode } from "react";

/**
 * Shared section frame for a report chart: title row + a flexible body slot.
 * The body is either the chart (a client SVG component) or a `ChartEmptyState`,
 * decided per-chart by the view's individual data-sufficiency gates.
 */
export function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-xl border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[13px] font-medium text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[11px] text-ink-3">{subtitle}</p>}
      </div>
      <div className="flex flex-1 flex-col p-4">{children}</div>
    </section>
  );
}
