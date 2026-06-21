"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HelpCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Wallet,
} from "lucide-react";
import { Logo } from "@/components/dashboard/logo";
import { UserMenu } from "@/components/dashboard/user-menu";
import { NAV_ITEMS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/system-constants";

/** Signed-in user shown in the bottom profile row. */
export interface SidebarUser {
  name: string | null;
  email: string | null;
  image: string | null;
}

interface SidebarProps {
  /** "mobile" renders a full-width overlay panel with labels always shown. */
  variant?: "desktop" | "mobile";
  /** Desktop icon-only mode. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Called when a nav item is tapped (used to close the mobile overlay). */
  onNavigate?: () => void;
  /** The authenticated user rendered in the profile row. */
  user: SidebarUser;
}

export function Sidebar({
  variant = "desktop",
  collapsed = false,
  onToggleCollapse,
  onNavigate,
  user
}: SidebarProps) {
  const pathname = usePathname();
  const isMobile = variant === "mobile";

  // Label visibility: mobile always shows; desktop hides at tablet width and
  // when manually collapsed.
  const showLabel = isMobile || !collapsed;
  const labelClass = isMobile
    ? "inline"
    : collapsed
      ? "hidden"
      : "hidden lg:inline";
  // Same visibility rule but using flex (for multi-line blocks like the profile).
  const labelFlexClass = isMobile
    ? "flex"
    : collapsed
      ? "hidden"
      : "hidden lg:flex";

  return (
    <aside
      className={cn(
        "flex h-full flex-col bg-sidebar",
        isMobile
          ? "w-65"
          : cn(
              "hidden w-16 border-r border-line transition-[width] duration-300 md:flex",
              collapsed ? "lg:w-16" : "lg:w-55"
            )
      )}
    >
      {/* Logo (mobile overlay only — desktop logo lives in the topbar) */}
      {isMobile && (
        <div className="flex h-14 items-center px-4">
          <Logo />
        </div>
      )}

      <nav className="flex flex-1 flex-col gap-0.5 p-2.5">
        {NAV_ITEMS.map(item => (
          <SidebarLink
            key={item.href}
            item={item}
            active={pathname === item.href}
            labelClass={labelClass}
            showLabel={showLabel}
            collapsed={!isMobile && collapsed}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div className="flex flex-col gap-0.5 p-2.5">
        {/* Desktop collapse toggle */}
        {!isMobile && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden items-center gap-3 rounded-md px-3 py-2 text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink lg:flex"
          >
            {collapsed ? (
              <PanelLeftOpen size={16} className="shrink-0" />
            ) : (
              <PanelLeftClose size={16} className="shrink-0" />
            )}
            <span className={cn("text-[13px]", labelClass)}>Collapse</span>
          </button>
        )}

        {/* Accounts: a setup/config surface, kept out of the primary daily-use nav. */}
        <Link
          href="/accounts"
          onClick={onNavigate}
          title={!isMobile && collapsed ? "Accounts" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 transition-colors",
            pathname === "/accounts"
              ? "border border-line bg-surface text-ink"
              : "text-ink-2 hover:bg-surface-2 hover:text-ink"
          )}
        >
          <Wallet
            size={16}
            className={cn("shrink-0", pathname === "/accounts" && "text-success")}
            strokeWidth={2}
          />
          <span className={cn("text-[13px]", labelClass)}>Accounts</span>
        </Link>

        <Link
          href="/settings"
          onClick={onNavigate}
          title={!isMobile && collapsed ? "Settings" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 transition-colors",
            pathname === "/settings"
              ? "border border-line bg-surface text-ink"
              : "text-ink-2 hover:bg-surface-2 hover:text-ink"
          )}
        >
          <Settings
            size={16}
            className={cn("shrink-0", pathname === "/settings" && "text-success")}
            strokeWidth={2}
          />
          <span className={cn("text-[13px]", labelClass)}>Settings</span>
        </Link>

        <Link
          href="/help"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <HelpCircle size={16} className="shrink-0" />
          <span className={cn("text-[13px]", labelClass)}>Help</span>
        </Link>

        {/* User profile + sign-out menu */}
        <UserMenu
          user={user}
          collapsed={!isMobile && collapsed}
          labelFlexClass={labelFlexClass}
          onNavigate={onNavigate}
        />
      </div>
    </aside>
  );
}

function SidebarLink({
  item,
  active,
  labelClass,
  showLabel,
  collapsed,
  onNavigate
}: {
  item: NavItem;
  active: boolean;
  labelClass: string;
  showLabel: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-md px-3 py-2 transition-colors",
        active
          ? "border border-line bg-surface text-ink"
          : "text-ink-2 hover:bg-surface-2 hover:text-ink"
      )}
    >
      <Icon
        size={16}
        className={cn("shrink-0", active && "text-success")}
        strokeWidth={2}
      />
      <span className={cn("text-[13px] font-medium", labelClass)}>
        {item.label}
      </span>
      {item.alert &&
        (showLabel ? (
          <span className="ml-auto flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-danger/20 px-1 text-[9px] font-medium text-danger">
            !
          </span>
        ) : (
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-danger" />
        ))}
    </Link>
  );
}
