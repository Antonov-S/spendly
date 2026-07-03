"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, ChevronRight } from "lucide-react";
import {
  getNotifications,
  trackNotificationEvent,
} from "@/actions/notifications";
import { NOTIFICATION_BADGE_MAX } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type {
  NotificationTone,
  NotificationsPayload,
} from "@/types/notifications";

/** Solid dot color per tone — strictly semantic, no new tokens. */
const DOT_CLASS: Record<NotificationTone, string> = {
  danger: "bg-danger",
  warning: "bg-warning",
  info: "bg-info",
};

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; payload: NotificationsPayload };

/**
 * Topbar notification bell + popover panel (POST-MVP §9). Rung 1 (derive-first):
 * the panel shows per-entity, derived, link-out items built from the same rules
 * as the dashboard insights strip. Nothing is persisted — resolving an item on
 * its linked page is the only "dismiss".
 *
 * Feeds itself via the read-only `getNotifications` Server Action (no prop
 * threading through the 10 AppShell pages) — derives on mount (per-navigation,
 * since AppShell remounts on nav) and re-derives when the panel opens. A
 * monotonic run-token guards against a stale response landing after a newer
 * request. Fetch failure degrades to a badge-less bell + an error line — the
 * bell must never break the topbar.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const runToken = useRef(0);

  async function load() {
    const token = ++runToken.current;
    const result = await getNotifications();
    // Discard if a newer request superseded this one (shell remounted mid-flight).
    if (token !== runToken.current) return;
    setState(
      result.success
        ? { status: "ready", payload: result.data }
        : { status: "error" }
    );
  }

  useEffect(() => {
    // Mount-only: per-navigation freshness (AppShell remounts on navigation).
    void load();
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      void load();
      const total = state.status === "ready" ? state.payload.totalCount : 0;
      void trackNotificationEvent({ type: "opened", total });
    }
  }

  const totalCount =
    state.status === "ready" ? state.payload.totalCount : 0;
  const showBadge = totalCount > 0;
  const badgeLabel =
    totalCount > NOTIFICATION_BADGE_MAX
      ? `${NOTIFICATION_BADGE_MAX}+`
      : String(totalCount);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <Bell size={18} />
        {showBadge && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[9px] font-semibold text-app">
            {badgeLabel}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Notifications"
            // Mobile: near-full-width sheet pinned just under the topbar (the bell
            // sits mid-bar, so a fixed-width right-anchored popover would spill off
            // the left edge). Desktop (sm+): anchored w-80 popover under the bell.
            className="fixed left-2 right-2 top-14 z-20 flex max-h-[70vh] flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-xl sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-1 sm:max-h-96 sm:w-80"
          >
            <div className="border-b border-line px-3 py-2 text-[11px] font-medium text-ink-2">
              Notifications
            </div>
            <div className="overflow-y-auto py-1">
              {state.status === "loading" && (
                <p className="px-3 py-6 text-center text-[12px] text-ink-2">
                  Loading…
                </p>
              )}
              {state.status === "error" && (
                <p className="px-3 py-6 text-center text-[12px] text-ink-2">
                  Couldn&apos;t load — try again.
                </p>
              )}
              {state.status === "ready" &&
                state.payload.items.length === 0 && (
                  <p className="px-3 py-6 text-center text-[12px] text-ink-2">
                    All caught up.
                  </p>
                )}
              {state.status === "ready" &&
                state.payload.items.map((item) =>
                  item.isOverflowRow ? (
                    <Link
                      key={item.id}
                      href={item.href}
                      onClick={() => {
                        setOpen(false);
                        void trackNotificationEvent({
                          type: "clicked",
                          kind: item.kind,
                        });
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                    >
                      {item.label}
                      <ChevronRight size={12} />
                    </Link>
                  ) : (
                    <Link
                      key={item.id}
                      href={item.href}
                      onClick={() => {
                        setOpen(false);
                        void trackNotificationEvent({
                          type: "clicked",
                          kind: item.kind,
                        });
                      }}
                      className="flex items-start gap-2.5 px-3 py-2 transition-colors hover:bg-surface-2"
                    >
                      <span
                        className={cn(
                          "mt-1 h-2 w-2 shrink-0 rounded-full",
                          DOT_CLASS[item.tone]
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] text-ink">
                          {item.label}
                        </span>
                        {item.detail && (
                          <span className="block text-[10px] text-ink-3">
                            {item.detail}
                          </span>
                        )}
                      </span>
                    </Link>
                  )
                )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
