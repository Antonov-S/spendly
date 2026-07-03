import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getNotifications,
  trackNotificationEvent,
} from "@/actions/notifications";
import { auth } from "@/auth";
import { deriveNotifications } from "@/lib/db/notifications";
import { track } from "@/lib/analytics/track";
import type { NotificationsPayload } from "@/types/notifications";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/notifications", () => ({ deriveNotifications: vi.fn() }));
vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));

const mockAuth = vi.mocked(auth);
const mockDerive = vi.mocked(deriveNotifications);
const mockTrack = vi.mocked(track);

const PAYLOAD: NotificationsPayload = {
  items: [
    {
      id: "budget-over:b1",
      kind: "budget-over",
      tone: "danger",
      label: "Rent budget is over the limit",
      href: "/budgets",
    },
  ],
  counts: { "budget-over": 1, "budget-risk": 2, draft: 3, "goal-overdue": 0 },
  totalCount: 6,
};

function authAs(id: string | null) {
  mockAuth.mockResolvedValue((id ? { user: { id } } : null) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getNotifications", () => {
  it("returns { success: false } when unauthenticated (no derive, no track)", async () => {
    authAs(null);
    const result = await getNotifications();
    expect(result).toEqual({ success: false, error: "Not authenticated." });
    expect(mockDerive).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("returns the derived payload for an authenticated user", async () => {
    authAs("u1");
    mockDerive.mockResolvedValue(PAYLOAD);
    const result = await getNotifications();
    expect(result).toEqual({ success: true, data: PAYLOAD });
    expect(mockDerive).toHaveBeenCalledWith("u1");
  });

  it("emits one notifications_derived event with total + per-kind counts", async () => {
    authAs("u1");
    mockDerive.mockResolvedValue(PAYLOAD);
    await getNotifications();
    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith("notifications_derived", {
      total: 6,
      "budget-over": 1,
      "budget-risk": 2,
      draft: 3,
      "goal-overdue": 0,
    });
  });

  it("fails closed when the service throws (never an unhandled rejection)", async () => {
    authAs("u1");
    mockDerive.mockRejectedValue(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await getNotifications();
    expect(result).toEqual({
      success: false,
      error: "Could not load notifications.",
    });
    errSpy.mockRestore();
  });
});

describe("trackNotificationEvent", () => {
  it("maps an open event to notification_panel_opened", async () => {
    await trackNotificationEvent({ type: "opened", total: 4 });
    expect(mockTrack).toHaveBeenCalledWith("notification_panel_opened", {
      total: 4,
    });
  });

  it("maps a click event to notification_item_clicked with the kind", async () => {
    await trackNotificationEvent({ type: "clicked", kind: "draft" });
    expect(mockTrack).toHaveBeenCalledWith("notification_item_clicked", {
      kind: "draft",
    });
  });
});
