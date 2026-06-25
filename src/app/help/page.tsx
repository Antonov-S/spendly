export const metadata = { title: "Help" };

import { getSessionOrRedirect } from "@/lib/auth/guards";
import { getUserAccounts } from "@/lib/db/accounts";
import { getSidebarUser } from "@/lib/db/profile";
import { AppShell } from "@/components/layout/app-shell";
import { HelpContent } from "@/components/help/help-content";

export default async function HelpPage() {
  // Auth-guarded but NOT onboarding-gated: a zero-account first-run user must
  // be able to reach Help (it explains how to start). Escape hatch like
  // /accounts and /settings.
  const session = await getSessionOrRedirect();
  const userId = session.user.id;

  // Shell chrome only — the page body is fully static content.
  const [accounts, sidebarUser] = await Promise.all([
    getUserAccounts(userId),
    getSidebarUser(userId),
  ]);

  return (
    <AppShell accounts={accounts} user={sidebarUser}>
      <HelpContent />
    </AppShell>
  );
}
