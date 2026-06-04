"use client";

import { useState } from "react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";
import { PageHeader } from "@/components/dashboard/page-header";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { TransactionDrawer } from "@/components/dashboard/transaction-drawer";
import { cn } from "@/lib/utils";
import type { DashboardSummary } from "@/types/dashboard";

interface DashboardShellProps {
  summary: DashboardSummary;
  /** Static, non-interactive content: metric strip + content columns. */
  children: React.ReactNode;
}

export function DashboardShell({ summary, children }: DashboardShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(v => !v)}
      />

      {/* Mobile sidebar overlay */}
      <div
        onClick={() => setMobileNavOpen(false)}
        aria-hidden
        className={cn(
          "fixed inset-0 z-40 bg-black/60 transition-opacity duration-300 md:hidden",
          mobileNavOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 transition-transform duration-300 ease-in-out md:hidden",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <Sidebar variant="mobile" onNavigate={() => setMobileNavOpen(false)} />
      </div>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMobileNav={() => setMobileNavOpen(true)} />

        <main className="flex-1 overflow-y-auto bg-app p-4 pb-24 md:pb-4">
          <div className="mx-auto flex max-w-350 flex-col gap-3">
            <PageHeader summary={summary} onAdd={() => setDrawerOpen(true)} />
            {children}
          </div>
        </main>
      </div>

      {/* Mobile bottom nav + floating add */}
      <MobileNav onAdd={() => setDrawerOpen(true)} />

      {/* Slide-in transaction drawer */}
      <TransactionDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
