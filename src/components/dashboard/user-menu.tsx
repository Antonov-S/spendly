"use client";

import { useState } from "react";
import Link from "next/link";
import { User, LogOut } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { signOutAction } from "@/actions/auth";
import { cn } from "@/lib/utils";
import type { SidebarUser } from "@/components/dashboard/sidebar";

interface UserMenuProps {
  user: SidebarUser;
  /** Icon-only desktop mode — hides name/email, keeps the avatar trigger. */
  collapsed: boolean;
  /** Visibility class for the name/email block (matches sidebar label rules). */
  labelFlexClass: string;
  /** Close the mobile overlay when a menu item is tapped. */
  onNavigate?: () => void;
}

/**
 * Bottom-of-sidebar profile control. Clicking the row opens a drop-up menu
 * with a link to the profile page and a sign-out action.
 */
export function UserMenu({
  user,
  collapsed,
  labelFlexClass,
  onNavigate,
}: UserMenuProps) {
  const [open, setOpen] = useState(false);

  const displayName = user.name?.trim() || user.email || "Account";

  return (
    <div className="relative">
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-full left-0 z-20 mb-1 w-52 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-xl">
            <Link
              href="/profile"
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
              className="flex items-center gap-2.5 px-3 py-2 text-[12px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <User size={15} className="shrink-0" />
              Profile
            </Link>
            <form action={signOutAction}>
              <button
                type="submit"
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-danger"
              >
                <LogOut size={15} className="shrink-0" />
                Sign out
              </button>
            </form>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={collapsed ? displayName : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "mt-0.5 flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-2",
          open && "bg-surface-2"
        )}
      >
        <Avatar name={user.name} email={user.email} image={user.image} />
        <span className={cn("min-w-0 flex-col", labelFlexClass)}>
          <span className="truncate text-[12px] font-medium text-ink">
            {displayName}
          </span>
          {user.email && (
            <span className="truncate text-[10px] text-ink-3">
              {user.email}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}
