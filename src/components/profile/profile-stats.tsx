import {
  Wallet,
  ArrowLeftRight,
  PiggyBank,
  Target,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import type { ProfileStats as ProfileStatsData } from "@/types/profile";

interface StatItem {
  label: string;
  value: number;
  icon: LucideIcon;
}

interface ProfileStatsProps {
  stats: ProfileStatsData;
}

/** Usage breakdown — record counts per item type. */
export function ProfileStats({ stats }: ProfileStatsProps) {
  const items: StatItem[] = [
    { label: "Accounts", value: stats.financialAccounts, icon: Wallet },
    { label: "Transactions", value: stats.transactions, icon: ArrowLeftRight },
    { label: "Budgets", value: stats.budgets, icon: PiggyBank },
    { label: "Goals", value: stats.goals, icon: Target },
    { label: "Recurring", value: stats.recurringTemplates, icon: RefreshCw },
  ];

  return (
    <section
      aria-labelledby="profile-stats-heading"
      className="rounded-xl border border-line bg-surface p-6"
    >
      <h2
        id="profile-stats-heading"
        className="text-[13px] font-medium text-ink"
      >
        Your data
      </h2>
      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-lg border border-line bg-app px-3 py-3"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-2">
              <Icon size={16} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <dd
                className={`text-[18px] font-medium ${
                  value === 0 ? "text-ink-2" : "text-ink"
                }`}
              >
                {value}
              </dd>
              <dt className="text-[11px] text-ink-2">{label}</dt>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}
