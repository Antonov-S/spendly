export const dynamic = "force-dynamic";

export const metadata = { title: "Import data" };

import Link from "next/link";
import { ArrowLeft, Wallet } from "lucide-react";
import { getSessionOrRedirect } from "@/lib/auth/guards";
import { getUserAccounts } from "@/lib/db/accounts";
import { getImportTargets } from "@/lib/db/import";
import { getSidebarUser } from "@/lib/db/profile";
import { AppShell } from "@/components/layout/app-shell";
import { ImportFlow } from "@/components/import/import-flow";

/**
 * Data Import page (data-import-spec §8 / T2). Auth-guarded, NOT onboarding-gated
 * (escape hatch like /settings). A zero-account user has no target to import into
 * (C1) and sees a "create an account first" empty state.
 */
export default async function ImportPage() {
  const session = await getSessionOrRedirect();
  const userId = session.user.id;

  const [targets, accounts, sidebarUser] = await Promise.all([
    getImportTargets(userId),
    getUserAccounts(userId),
    getSidebarUser(userId),
  ]);

  return (
    <AppShell accounts={accounts} user={sidebarUser}>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-5 px-4 py-6">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 text-[12px] text-ink-2 transition-colors hover:text-ink"
        >
          <ArrowLeft size={14} />
          Back to settings
        </Link>

        <header>
          <h1 className="text-[20px] font-medium text-ink">Import data</h1>
          <p className="mt-1 text-[13px] text-ink-2">
            Migrate your history from a CSV or a Spendly JSON export. Nothing is
            saved until you review a preview and confirm. Spendly JSON backups
            restore split categories and tags.
          </p>
        </header>

        {targets.accounts.length === 0 ? (
          <section className="rounded-xl border border-line bg-surface p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink-2">
              <Wallet size={22} />
            </div>
            <h2 className="mt-4 text-[14px] font-medium text-ink">
              Create an account first
            </h2>
            <p className="mx-auto mt-1 max-w-sm text-[12px] text-ink-2">
              Imported transactions land in one of your accounts, so you need at
              least one before importing.
            </p>
            <Link
              href="/accounts"
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3.5 py-2 text-[13px] font-medium text-ink shadow-sm transition-colors hover:border-success/50 hover:text-success"
            >
              Go to accounts
            </Link>
          </section>
        ) : (
          <ImportFlow
            accounts={targets.accounts}
            categoryCount={targets.categories.length}
          />
        )}
      </div>
    </AppShell>
  );
}
