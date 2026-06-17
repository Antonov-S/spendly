export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { getSessionOrRedirect } from "@/lib/auth/guards";
import { getUserAccounts, getAccountsWithBalances } from "@/lib/db/accounts";
import { AppShell } from "@/components/layout/app-shell";
import { AccountsView } from "@/components/accounts/accounts-view";

export default async function AccountsPage() {
  const session = await getSessionOrRedirect();
  const userId = session.user.id;

  // The management list includes archived accounts (shown in a separate
  // section); `accounts` is shell chrome for the topbar selector (active-only).
  const [rows, accounts] = await Promise.all([
    getAccountsWithBalances(userId, { includeArchived: true }),
    getUserAccounts(userId),
  ]);

  return (
    <AppShell
      accounts={accounts}
      user={{
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
      }}
    >
      <Suspense key={rows.length}>
        <AccountsView accounts={rows} />
      </Suspense>
    </AppShell>
  );
}
