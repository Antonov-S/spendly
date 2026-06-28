export const dynamic = "force-dynamic";

export const metadata = { title: "Trash" };

import { requireOnboarded } from "@/lib/auth/guards";
import { getUserAccounts } from "@/lib/db/accounts";
import { getDeletedTransactions } from "@/lib/db/transactions";
import { getSidebarUser } from "@/lib/db/profile";
import { AppShell } from "@/components/layout/app-shell";
import { TrashView } from "@/components/trash/trash-view";

export default async function TrashPage() {
  const session = await requireOnboarded();
  const userId = session.user.id;

  // `accounts` is shell chrome (topbar selector), not trash data.
  const [rows, accounts, sidebarUser] = await Promise.all([
    getDeletedTransactions(userId),
    getUserAccounts(userId),
    getSidebarUser(userId),
  ]);

  // Anchor "deleted X ago" labels to the request, not module import time.
  const nowMs = Date.now();

  return (
    <AppShell accounts={accounts} user={sidebarUser}>
      <TrashView rows={rows} nowMs={nowMs} />
    </AppShell>
  );
}
