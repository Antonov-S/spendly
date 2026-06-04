"use client";

import { useState } from "react";
import { Landmark, ChevronDown, Menu } from "lucide-react";
import { Logo } from "@/components/dashboard/logo";
import { MOCK_ACCOUNTS } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

interface TopbarProps {
  onOpenMobileNav: () => void;
}

export function Topbar({ onOpenMobileNav }: TopbarProps) {
  const [account, setAccount] = useState<string>(MOCK_ACCOUNTS[0]);
  const [open, setOpen] = useState(false);
  const isFiltered = account !== MOCK_ACCOUNTS[0];

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

      {/* Account selector pill (global filter), right-aligned (no search/bell — post-MVP) */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] text-ink transition-colors hover:bg-surface-2"
        >
          <Landmark size={15} className="text-ink-2" />
          <span className="max-w-30 truncate">{account}</span>
          {isFiltered && (
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
          )}
          <ChevronDown size={14} className="text-ink-3" />
        </button>

        {open && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setOpen(false)}
            />
            <ul className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-xl">
              {MOCK_ACCOUNTS.map(name => (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => {
                      setAccount(name);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-2",
                      name === account ? "text-ink" : "text-ink-2"
                    )}
                  >
                    <Landmark size={14} className="text-ink-3" />
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </header>
  );
}
