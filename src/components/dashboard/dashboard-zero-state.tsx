import Link from "next/link";
import { Wallet } from "lucide-react";

/**
 * Defensive zero-account fallback for the dashboard. The onboarding guard
 * normally routes a zero-account user to /onboarding before they reach here;
 * this card is the safety net for a guard bypass or client nav race. It keys
 * off the dashboard's locally-fetched accounts, never the guard.
 */
export function DashboardZeroState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface px-6 py-20 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink-3">
        <Wallet size={22} />
      </span>
      <h2 className="mt-4 text-[15px] font-medium text-ink">
        Create your first account to get started
      </h2>
      <p className="mt-1.5 max-w-xs text-[12px] text-ink-2">
        Spendly tracks your money across accounts. Add one to capture your first
        transaction and see your dashboard come to life.
      </p>
      <Link
        href="/onboarding"
        className="mt-5 rounded-lg bg-success px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
      >
        Get started
      </Link>
    </div>
  );
}
