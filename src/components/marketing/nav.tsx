"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/dashboard/logo";
import { NAV_LINKS } from "@/lib/marketing/copy";

const MOBILE_MENU_ID = "primary-mobile-menu";

/**
 * Fixed primary navigation. Transparent over the hero, gaining a solid blurred
 * background once the page is scrolled. The mobile menu uses the native Popover
 * API, which gives light-dismiss, Escape-to-close, and focus handling for free.
 */
export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll(); // sync on mount (e.g. restored scroll position)
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const closeMenu = () =>
    document.getElementById(MOBILE_MENU_ID)?.hidePopover?.();

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b transition-colors duration-200",
        scrolled
          ? "border-line bg-app/80 backdrop-blur-md"
          : "border-transparent bg-transparent"
      )}
    >
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6 md:h-16">
        <Link href="/" aria-label="Spendly home">
          <Logo />
        </Link>

        {/* Desktop anchor links */}
        <div className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Desktop actions */}
        <div className="hidden items-center gap-2 md:flex">
          <Link
            href="/sign-in"
            className="rounded-lg px-3 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="rounded-lg bg-success px-4 py-2 text-[13px] font-semibold text-white ring-1 ring-inset ring-white/15 transition-colors hover:bg-success/90"
          >
            Get Started
          </Link>
        </div>

        {/* Mobile: keep the primary CTA visible, collapse the rest into a menu */}
        <div className="flex items-center gap-2 md:hidden">
          <Link
            href="/register"
            className="rounded-lg bg-success px-3.5 py-1.5 text-[13px] font-semibold text-white ring-1 ring-inset ring-white/15"
          >
            Get Started
          </Link>
          <button
            type="button"
            popoverTarget={MOBILE_MENU_ID}
            aria-label="Open menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-ink"
          >
            <Menu size={18} />
          </button>
        </div>
      </div>

      {/* Mobile menu (native popover, anchored below the bar). */}
      <div
        id={MOBILE_MENU_ID}
        popover="auto"
        className="fixed inset-x-3 top-16 bottom-auto m-0 w-auto rounded-xl border border-line bg-surface p-2 shadow-2xl shadow-black/40"
      >
        <ul className="flex flex-col">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                onClick={closeMenu}
                className="block rounded-lg px-3 py-2.5 text-[14px] font-medium text-ink transition-colors hover:bg-surface-2"
              >
                {link.label}
              </a>
            </li>
          ))}
          <li>
            <Link
              href="/sign-in"
              onClick={closeMenu}
              className="block rounded-lg px-3 py-2.5 text-[14px] font-medium text-ink-2 transition-colors hover:bg-surface-2"
            >
              Sign in
            </Link>
          </li>
        </ul>
      </div>
    </nav>
  );
}
