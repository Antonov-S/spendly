import { describe, it, expect, vi, beforeEach } from "vitest";
import { track } from "@/lib/analytics/track";
import { auth } from "@/auth";
import { getAnalyticsOptOut, persistEvent } from "@/lib/db/analytics";

// Controllable copies of the two constants track.ts reads, so the kill switch
// and the truncation cap can be flipped per test (getter → read fresh each call).
const state = vi.hoisted(() => ({ enabled: true, maxBytes: 2048 }));

vi.mock("@/lib/system-constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/system-constants")>();
  return {
    ...actual,
    get ANALYTICS_ENABLED() {
      return state.enabled;
    },
    get ANALYTICS_PROPS_MAX_BYTES() {
      return state.maxBytes;
    },
  };
});

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/analytics", () => ({
  getAnalyticsOptOut: vi.fn(),
  persistEvent: vi.fn(),
}));

const mockAuth = vi.mocked(auth);
const mockOptOut = vi.mocked(getAnalyticsOptOut);
const mockPersist = vi.mocked(persistEvent);

function signedIn(id = "u1") {
  mockAuth.mockResolvedValue({ user: { id } } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.enabled = true;
  state.maxBytes = 2048;
});

describe("track sink", () => {
  it("persists a registered event with sanitized props", async () => {
    signedIn("u1");
    mockOptOut.mockResolvedValue(false);

    await track("transaction_created", {
      type: "EXPENSE",
      isSplit: false,
      tagCount: 2,
    });

    expect(mockPersist).toHaveBeenCalledTimes(1);
    expect(mockPersist).toHaveBeenCalledWith("u1", "transaction_created", {
      type: "EXPENSE",
      isSplit: false,
      tagCount: 2,
    });
  });

  it("strips an unregistered prop key before persisting", async () => {
    signedIn("u1");
    mockOptOut.mockResolvedValue(false);

    await track("budget_created", {
      rollover: true,
      merchant: "Whole Foods",
    } as never);

    expect(mockPersist).toHaveBeenCalledWith("u1", "budget_created", {
      rollover: true,
    });
  });

  it("drops when there is no session — no opt-out read, no write", async () => {
    mockAuth.mockResolvedValue(null as never);

    await track("goal_created");

    expect(mockOptOut).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it("drops when the user has opted out", async () => {
    signedIn("u1");
    mockOptOut.mockResolvedValue(true);

    await track("goal_created");

    expect(mockPersist).not.toHaveBeenCalled();
  });

  it("drops when the user row is missing (opt-out read → null)", async () => {
    signedIn("u1");
    mockOptOut.mockResolvedValue(null);

    await track("goal_created");

    expect(mockPersist).not.toHaveBeenCalled();
  });

  it("drops an unregistered event without reading opt-out or writing", async () => {
    signedIn("u1");
    mockOptOut.mockResolvedValue(false);

    await track("totally_made_up" as never);

    expect(mockPersist).not.toHaveBeenCalled();
  });

  it("respects the ANALYTICS_ENABLED kill switch — no auth, no write", async () => {
    state.enabled = false;

    await track("goal_created");

    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it("stores { _truncated: true } when props exceed the byte cap", async () => {
    signedIn("u1");
    mockOptOut.mockResolvedValue(false);
    state.maxBytes = 5; // any real payload exceeds this

    await track("transaction_created", {
      type: "EXPENSE",
      isSplit: false,
      tagCount: 2,
    });

    expect(mockPersist).toHaveBeenCalledWith("u1", "transaction_created", {
      _truncated: true,
    });
  });

  it("fails open — a persist error never throws", async () => {
    signedIn("u1");
    mockOptOut.mockResolvedValue(false);
    mockPersist.mockRejectedValue(new Error("db down"));

    await expect(track("goal_created")).resolves.toBeUndefined();
  });
});
