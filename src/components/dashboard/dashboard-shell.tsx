"use client";

import { AppShell, useAppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/dashboard/page-header";
import type { SidebarUser } from "@/components/dashboard/sidebar";
import type { DashboardSummary } from "@/types/dashboard";
import type { AccountOption } from "@/types/transactions";

interface DashboardShellProps {
  summary: DashboardSummary;
  balanceTrend: number[];
  /** The authenticated user shown in the sidebar profile row. */
  user: SidebarUser;
  /** Accounts for the global topbar selector. */
  accounts: AccountOption[];
  /** Static, non-interactive content: metric strip + content columns. */
  children: React.ReactNode;
}

export function DashboardShell({
  summary,
  balanceTrend,
  user,
  accounts,
  children,
}: DashboardShellProps) {
  return (
    <AppShell user={user} accounts={accounts}>
      <DashboardHeader summary={summary} balanceTrend={balanceTrend} />
      {children}
    </AppShell>
  );
}

/** The dashboard's hero header; wired to the shell drawer via context. */
function DashboardHeader({
  summary,
  balanceTrend,
}: {
  summary: DashboardSummary;
  balanceTrend: number[];
}) {
  const { openDrawer } = useAppShell();
  return (
    <PageHeader
      summary={summary}
      balanceTrend={balanceTrend}
      onAdd={() => openDrawer()}
    />
  );
}
