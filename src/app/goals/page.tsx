export const dynamic = "force-dynamic";

export const metadata = { title: "Goals" };

import { Suspense } from "react";
import { requireOnboarded } from "@/lib/auth/guards";
import { getUserAccounts } from "@/lib/db/accounts";
import { getGoals } from "@/lib/db/goals";
import { AppShell } from "@/components/layout/app-shell";
import { GoalsView } from "@/components/goals/goals-view";

export default async function GoalsPage() {
  const session = await requireOnboarded();
  const userId = session.user.id;

  // `accounts` is shell chrome (topbar selector), not goal data.
  const [goals, accounts] = await Promise.all([
    getGoals(userId),
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
      <Suspense key={goals.length}>
        <GoalsView goals={goals} />
      </Suspense>
    </AppShell>
  );
}
