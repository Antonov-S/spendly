import { TrendingUp, TrendingDown, ArrowLeftRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatCurrency, formatSigned } from "@/lib/format";
import type { DashboardSummary } from "@/types/dashboard";

interface Metric {
  label: string;
  value: string;
  icon: LucideIcon;
  /** Tailwind text color class for the value + icon accent. */
  tone: string;
  /** Inline tint for the icon square background. */
  tint: string;
}

export function MetricStrip({ summary }: { summary: DashboardSummary }) {
  const metrics: Metric[] = [
    {
      label: "Income",
      value: formatCurrency(summary.income),
      icon: TrendingUp,
      tone: "text-success",
      tint: "#1D9E7522",
    },
    {
      label: "Expenses",
      value: formatCurrency(summary.expenses),
      icon: TrendingDown,
      tone: "text-danger",
      tint: "#E24B4A22",
    },
    {
      label: "Cashflow",
      value: formatSigned(summary.cashflow),
      icon: ArrowLeftRight,
      tone: "text-ink",
      tint: "#378ADD22",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <div
            key={metric.label}
            className="flex items-center gap-3.5 rounded-xl border border-line bg-surface px-5 py-5"
          >
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: metric.tint }}
            >
              <Icon size={20} className={metric.tone} />
            </span>
            <div>
              <p className="text-[11px] text-ink-3">{metric.label}</p>
              <p className={`text-[22px] font-medium leading-tight ${metric.tone}`}>
                {metric.value}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
