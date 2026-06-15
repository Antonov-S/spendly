"use client";

import { createContext, useContext, useState } from "react";
import { Sidebar, type SidebarUser } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { TransactionDrawer } from "@/components/dashboard/transaction-drawer";
import { cn } from "@/lib/utils";
import type { AccountOption } from "@/types/transactions";

interface AppShellContextValue {
  /** Open the create-transaction drawer (drawer is a visual mock until Part 2). */
  openDrawer: () => void;
}

const AppShellContext = createContext<AppShellContextValue | null>(null);

/** Access shell-level actions (e.g. opening the transaction drawer). */
export function useAppShell(): AppShellContextValue {
  const ctx = useContext(AppShellContext);
  if (!ctx) {
    throw new Error("useAppShell must be used within <AppShell>");
  }
  return ctx;
}

interface AppShellProps {
  /** The authenticated user shown in the sidebar profile row. */
  user: SidebarUser;
  /** Accounts for the global topbar selector. */
  accounts: AccountOption[];
  children: React.ReactNode;
}

/**
 * App chrome shared by every authenticated page: collapsible sidebar (desktop +
 * mobile overlay), topbar with the global account selector, scrollable main
 * area, mobile bottom nav, and the slide-in transaction drawer. Pages render
 * their own header + content as `children`.
 */
export function AppShell({ user, accounts, children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const openDrawer = () => setDrawerOpen(true);

  return (
    <AppShellContext.Provider value={{ openDrawer }}>
      <div className="flex h-screen overflow-hidden">
        {/* Desktop sidebar */}
        <Sidebar
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
          user={user}
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
          <Sidebar
            variant="mobile"
            onNavigate={() => setMobileNavOpen(false)}
            user={user}
          />
        </div>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            onOpenMobileNav={() => setMobileNavOpen(true)}
            accounts={accounts}
          />

          <main className="flex-1 overflow-y-auto bg-app p-4 pb-24 md:pb-4">
            <div className="mx-auto flex max-w-350 flex-col gap-3">
              {children}
            </div>
          </main>
        </div>

        {/* Mobile bottom nav + floating add */}
        <MobileNav onAdd={openDrawer} />

        {/* Slide-in transaction drawer */}
        <TransactionDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </div>
    </AppShellContext.Provider>
  );
}
