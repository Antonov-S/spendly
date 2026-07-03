"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Landmark, ChevronDown, Menu, Check, Settings2 } from "lucide-react";
import { Logo } from "@/components/dashboard/logo";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { cn } from "@/lib/utils";
import type { AccountOption } from "@/types/transactions";

interface TopbarProps {
  onOpenMobileNav: () => void;
  accounts: AccountOption[];
}

const ALL_ACCOUNTS_LABEL = "All accounts";

/**
 * Global account selector. Selection lives in the `?account=<id>` URL param so
 * the scope is shareable and survives navigation; pages that read it (the
 * transactions feed) filter accordingly. "All accounts" clears the param.
 */
export function Topbar({ onOpenMobileNav, accounts }: TopbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  const selectedId = searchParams.get("account");
  const selected = accounts.find((a) => a.id === selectedId) ?? null;
  const isFiltered = selected != null;
  const label = selected?.name ?? ALL_ACCOUNTS_LABEL;

  function selectAccount(id: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("account", id);
    else params.delete("account");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
    setOpen(false);
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-app px-3 md:px-4">
      {/* Mobile menu */}
      <button
        type="button"
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
        className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink md:hidden"
      >
        <Menu size={20} />
      </button>

      {/* Logo — wordmark hidden on small screens to declutter the mobile bar */}
      <Logo wordmarkClassName="hidden sm:inline" />

      <div className="flex-1" />

      {/* Notification bell — app-wide "anything for me?" surface (POST-MVP §9) */}
      <NotificationBell />

      {/* Account selector pill (global filter), right-aligned */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] text-ink transition-colors hover:bg-surface-2"
        >
          <Landmark size={15} className="text-ink-2" />
          <span className="max-w-30 truncate">{label}</span>
          {isFiltered && <span className="h-1.5 w-1.5 rounded-full bg-success" />}
          <ChevronDown size={14} className="text-ink-3" />
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <ul
              role="listbox"
              className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-xl"
            >
              <AccountItem
                label={ALL_ACCOUNTS_LABEL}
                active={!isFiltered}
                onSelect={() => selectAccount(null)}
              />
              {accounts.map((account) => (
                <AccountItem
                  key={account.id}
                  label={account.name}
                  active={account.id === selectedId}
                  onSelect={() => selectAccount(account.id)}
                />
              ))}
              <li className="my-1 border-t border-line" role="separator" />
              <li>
                <Link
                  href="/accounts"
                  onClick={() => setOpen(false)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  <Settings2 size={14} className="text-ink-3" />
                  <span className="flex-1 truncate">Manage accounts</span>
                </Link>
              </li>
            </ul>
          </>
        )}
      </div>
    </header>
  );
}

function AccountItem({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li role="option" aria-selected={active}>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-2",
          active ? "text-ink" : "text-ink-2"
        )}
      >
        <Landmark size={14} className="text-ink-3" />
        <span className="flex-1 truncate">{label}</span>
        {active && <Check size={14} className="text-success" />}
      </button>
    </li>
  );
}
