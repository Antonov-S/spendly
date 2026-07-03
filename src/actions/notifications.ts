"use server";

import { auth } from "@/auth";
import { deriveNotifications } from "@/lib/db/notifications";
import { track } from "@/lib/analytics/track";
import type {
  NotificationKind,
  NotificationsPayload,
} from "@/types/notifications";

/**
 * Read-only notification fetch for the topbar bell (POST-MVP §9). A thin wrapper
 * over the channel-agnostic `deriveNotifications` service — auth, telemetry,
 * error shape, nothing else. No `revalidatePath`, no writes, no rate limit
 * (auth-guarded, read-only, self-throttled by the UI's mount + open; matches
 * `loadMoreTransactions`). Fail-closed to `{ success: false }` so a fetch error
 * or an expired session can never break the topbar.
 */
export async function getNotifications(): Promise<
  | { success: true; data: NotificationsPayload }
  | { success: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated." };
  }

  try {
    const payload = await deriveNotifications(session.user.id);
    // Spread the payload's per-kind counts verbatim (§11) — counts/enums only,
    // no names or amounts, per the telemetry shim's contract.
    await track("notifications_derived", {
      total: payload.totalCount,
      ...payload.counts,
    });
    return { success: true, data: payload };
  } catch (error) {
    console.error("getNotifications failed", error);
    return { success: false, error: "Could not load notifications." };
  }
}

/**
 * Fire-and-forget engagement telemetry for the panel — the rung-2 evidence the
 * roadmap gates persistence on (§11). Lives as a server action because `track`
 * is server-only and the bell is a client component. Never touches data.
 */
export async function trackNotificationEvent(
  input:
    | { type: "opened"; total: number }
    | { type: "clicked"; kind: NotificationKind }
): Promise<void> {
  if (input.type === "opened") {
    await track("notification_panel_opened", { total: input.total });
  } else {
    await track("notification_item_clicked", { kind: input.kind });
  }
}
