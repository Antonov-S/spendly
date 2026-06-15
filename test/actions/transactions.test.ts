import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadMoreTransactions } from "@/actions/transactions";
import { auth } from "@/auth";
import { getTransactions } from "@/lib/db/transactions";
import type { TransactionPage } from "@/types/transactions";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/transactions", () => ({ getTransactions: vi.fn() }));

const mockAuth = vi.mocked(auth);
const mockGetTransactions = vi.mocked(getTransactions);

const PAGE: TransactionPage = { rows: [], nextCursor: "next" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadMoreTransactions", () => {
  it("returns the next page for an authenticated user", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockGetTransactions.mockResolvedValue(PAGE);

    const result = await loadMoreTransactions({ type: "EXPENSE" }, "cursor1");

    expect(mockGetTransactions).toHaveBeenCalledWith(
      "u1",
      { type: "EXPENSE" },
      "cursor1"
    );
    expect(result).toEqual({ success: true, data: PAGE });
  });

  it("rejects unauthenticated callers without querying", async () => {
    mockAuth.mockResolvedValue(null as never);

    const result = await loadMoreTransactions({}, "cursor1");

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(mockGetTransactions).not.toHaveBeenCalled();
  });

  it("returns an error result when the query throws", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockGetTransactions.mockRejectedValue(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await loadMoreTransactions({}, "cursor1");

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    errorSpy.mockRestore();
  });
});
