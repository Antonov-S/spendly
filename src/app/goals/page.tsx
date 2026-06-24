export const dynamic = "force-dynamic";

export const metadata = { title: "Goals" };

import { Suspense } from "react";
import { requireOnboarded } from "@/lib/auth/guards";
import { getUserAccounts } from "@/lib/db/accounts";
import { getGoals } from "@/lib/db/goals";
import { getSidebarUser } from "@/lib/db/profile";
import { AppShell } from "@/components/layout/app-shell";
import { GoalsView } from "@/components/goals/goals-view";

export default async function GoalsPage() {
  const session = await requireOnboarded();
  const userId = session.user.id;

  // `accounts` is shell chrome (topbar selector), not goal data.
  const [goals, accounts, sidebarUser] = await Promise.all([
    getGoals(userId),
    getUserAccounts(userId),
    getSidebarUser(userId),
  ]);

  return (
    <AppShell
      accounts={accounts}
      user={sidebarUser}
    >
      <Suspense key={goals.length}>
        <GoalsView goals={goals} />
      </Suspense>
    </AppShell>
  );
}
