"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { MOBILE_NAV_ITEMS } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface MobileNavProps {
  onAdd: () => void;
}

/** Bottom navigation bar with a centered floating add button (mobile only). */
export function MobileNav({ onAdd }: MobileNavProps) {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-stretch border-t border-line bg-sidebar md:hidden">
      {MOBILE_NAV_ITEMS.map((item, index) => {
        const Icon = item.icon;
        const active = pathname === item.href;
        // Leave a gap in the middle for the floating add button.
        const isMiddleGap = index === 2;
        return (
          <div key={item.href} className="contents">
            {isMiddleGap && <div className="w-16 shrink-0" aria-hidden />}
            <Link
              href={item.href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 text-[10px]",
                active ? "text-success" : "text-ink-3"
              )}
            >
              <Icon size={19} strokeWidth={2} />
              {item.label}
            </Link>
          </div>
        );
      })}

      {/* Floating add button */}
      <button
        type="button"
        onClick={onAdd}
        aria-label="Add transaction"
        className="absolute left-1/2 top-0 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-success text-white shadow-lg transition-opacity hover:opacity-90"
      >
        <Plus size={22} strokeWidth={2.4} />
      </button>
    </nav>
  );
}
