import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadMoreTransactions,
  createTransaction,
  createTransfer,
  updateTransaction,
  updateTransfer,
  deleteTransaction,
  restoreTransaction,
  hardDeleteTransaction,
  emptyTrash,
} from "@/actions/transactions";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getTransactions } from "@/lib/db/transactions";
import type { TransactionPage } from "@/types/transactions";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/transactions", () => ({ getTransactions: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    financialAccount: { findFirst: vi.fn(), findMany: vi.fn() },
    category: { findFirst: vi.fn() },
    transaction: {
      create: vi.fn(),
      update: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const mockAuth = vi.mocked(auth);
const mockGetTransactions = vi.mocked(getTransactions);

/** Authenticate the session as `id` for the action under test. */
function signIn(id = "u1") {
  mockAuth.mockResolvedValue({ user: { id } } as never);
}

/** Read the `data` array passed to a `createMany` call. */
function lastCreateManyLegs(): Array<{
  amount: number;
  isTransferLeg: boolean;
  transferPairId: string;
  financialAccountId: string;
  currency: string;
}> {
  const call = vi.mocked(prisma.transaction.createMany).mock.calls.at(-1)?.[0];
  return (call as { data: ReturnType<typeof lastCreateManyLegs> }).data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadMoreTransactions", () => {
  const PAGE: TransactionPage = { rows: [], nextCursor: "next" };

  it("returns the next page for an authenticated user", async () => {
    signIn();
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
    expect(mockGetTransactions).not.toHaveBeenCalled();
  });
});

describe("createTransaction", () => {
  it("stores an expense as a negative signed amount in the account currency", async () => {
    signIn();
    vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue({
      currency: "EUR",
    } as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({} as never);

    const res = await createTransaction({
      type: "EXPENSE",
      amount: 25,
      date: "2026-06-10",
      financialAccountId: "acc1",
      categoryId: null,
      merchant: null,
      note: null,
    });

    expect(res.success).toBe(true);
    expect(prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "EXPENSE",
          amount: -25,
          currency: "EUR",
          financialAccountId: "acc1",
        }),
      })
    );
  });

  it("stores income as a positive signed amount", async () => {
    signIn();
    vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue({
      currency: "USD",
    } as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({} as never);

    await createTransaction({
      type: "INCOME",
      amount: 1200,
      date: "2026-06-10",
      financialAccountId: "acc1",
      categoryId: null,
      merchant: null,
      note: null,
    });

    expect(prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 1200 }),
      })
    );
  });

  it("rejects an account the user does not own", async () => {
    signIn();
    vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue(null);

    const res = await createTransaction({
      type: "EXPENSE",
      amount: 10,
      date: "2026-06-10",
      financialAccountId: "not-mine",
      categoryId: null,
      merchant: null,
      note: null,
    });

    expect(res.success).toBe(false);
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it("rejects a non-positive amount before touching the database", async () => {
    signIn();

    const res = await createTransaction({
      type: "EXPENSE",
      amount: 0,
      date: "2026-06-10",
      financialAccountId: "acc1",
      categoryId: null,
      merchant: null,
      note: null,
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/greater than 0/i);
    expect(prisma.financialAccount.findFirst).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await createTransaction({
      type: "EXPENSE",
      amount: 10,
      date: "2026-06-10",
      financialAccountId: "acc1",
      categoryId: null,
      merchant: null,
      note: null,
    });

    expect(res.success).toBe(false);
    expect(prisma.financialAccount.findFirst).not.toHaveBeenCalled();
  });
});

describe("updateTransaction", () => {
  it("updates an income/expense in place", async () => {
    signIn();
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
      id: "t1",
      isTransferLeg: false,
    } as never);
    vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue({
      currency: "USD",
    } as never);
    vi.mocked(prisma.transaction.update).mockResolvedValue({} as never);

    const res = await updateTransaction("t1", {
      type: "EXPENSE",
      amount: 40,
      date: "2026-06-10",
      financialAccountId: "acc1",
      categoryId: null,
      merchant: null,
      note: null,
    });

    expect(res.success).toBe(true);
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "t1" },
        data: expect.objectContaining({ amount: -40 }),
      })
    );
  });

  it("refuses to edit a transfer leg in place", async () => {
    signIn();
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
      id: "t1",
      isTransferLeg: true,
    } as never);

    const res = await updateTransaction("t1", {
      type: "EXPENSE",
      amount: 40,
      date: "2026-06-10",
      financialAccountId: "acc1",
      categoryId: null,
      merchant: null,
      note: null,
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/transfer/i);
    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });
});

describe("createTransfer", () => {
  it("creates two opposite-signed legs sharing one transferPairId", async () => {
    signIn();
    vi.mocked(prisma.financialAccount.findMany).mockResolvedValue([
      { id: "a", currency: "USD" },
      { id: "b", currency: "USD" },
    ] as never);
    vi.mocked(prisma.transaction.createMany).mockResolvedValue({
      count: 2,
    } as never);

    const res = await createTransfer({
      amount: 50,
      date: "2026-06-10",
      fromAccountId: "a",
      toAccountId: "b",
      merchant: null,
      note: null,
    });

    expect(res.success).toBe(true);
    const legs = lastCreateManyLegs();
    expect(legs).toHaveLength(2);
    expect(legs.every((l) => l.isTransferLeg)).toBe(true);
    expect(legs[0].transferPairId).toBe(legs[1].transferPairId);
    expect(legs.find((l) => l.financialAccountId === "a")?.amount).toBe(-50);
    expect(legs.find((l) => l.financialAccountId === "b")?.amount).toBe(50);
  });

  it("rejects a transfer to the same account before querying", async () => {
    signIn();

    const res = await createTransfer({
      amount: 50,
      date: "2026-06-10",
      fromAccountId: "a",
      toAccountId: "a",
      merchant: null,
      note: null,
    });

    expect(res.success).toBe(false);
    expect(prisma.financialAccount.findMany).not.toHaveBeenCalled();
  });

  it("rejects when an account is not owned/active", async () => {
    signIn();
    vi.mocked(prisma.financialAccount.findMany).mockResolvedValue([
      { id: "a", currency: "USD" },
    ] as never);

    const res = await createTransfer({
      amount: 50,
      date: "2026-06-10",
      fromAccountId: "a",
      toAccountId: "b",
      merchant: null,
      note: null,
    });

    expect(res.success).toBe(false);
    expect(prisma.transaction.createMany).not.toHaveBeenCalled();
  });
});

describe("updateTransfer", () => {
  it("soft-deletes the old pair and creates a fresh pair atomically", async () => {
    signIn();
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { id: "l1" },
      { id: "l2" },
    ] as never);
    vi.mocked(prisma.financialAccount.findMany).mockResolvedValue([
      { id: "a", currency: "USD" },
      { id: "b", currency: "USD" },
    ] as never);
    vi.mocked(prisma.$transaction).mockResolvedValue([] as never);

    const res = await updateTransfer("pair1", {
      amount: 70,
      date: "2026-06-11",
      fromAccountId: "a",
      toAccountId: "b",
      merchant: null,
      note: null,
    });

    expect(res.success).toBe(true);
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          transferPairId: "pair1",
          deletedAt: null,
        }),
        data: { deletedAt: expect.any(Date) },
      })
    );
    // New pair gets a different transferPairId than the deleted one.
    expect(lastCreateManyLegs()[0].transferPairId).not.toBe("pair1");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("rejects when the pair is not found", async () => {
    signIn();
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([] as never);

    const res = await updateTransfer("missing", {
      amount: 70,
      date: "2026-06-11",
      fromAccountId: "a",
      toAccountId: "b",
      merchant: null,
      note: null,
    });

    expect(res.success).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("deleteTransaction", () => {
  it("soft-deletes both legs of a transfer", async () => {
    signIn();
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
      id: "t1",
      transferPairId: "pair1",
    } as never);
    vi.mocked(prisma.transaction.updateMany).mockResolvedValue({
      count: 2,
    } as never);

    const res = await deleteTransaction("t1");

    expect(res.success).toBe(true);
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ transferPairId: "pair1" }),
        data: { deletedAt: expect.any(Date) },
      })
    );
    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  it("soft-deletes a single non-transfer row", async () => {
    signIn();
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
      id: "t1",
      transferPairId: null,
    } as never);
    vi.mocked(prisma.transaction.update).mockResolvedValue({} as never);

    const res = await deleteTransaction("t1");

    expect(res.success).toBe(true);
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "t1" },
        data: { deletedAt: expect.any(Date) },
      })
    );
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a row the user does not own", async () => {
    signIn();
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);

    const res = await deleteTransaction("t1");

    expect(res.success).toBe(false);
    expect(prisma.transaction.update).not.toHaveBeenCalled();
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
  });
});

describe("restoreTransaction", () => {
  it("clears deletedAt on both legs of a transfer", async () => {
    signIn();
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
      id: "t1",
      transferPairId: "pair1",
    } as never);
    vi.mocked(prisma.transaction.updateMany).mockResolvedValue({
      count: 2,
    } as never);

    const res = await restoreTransaction("t1");

    expect(res.success).toBe(true);
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ transferPairId: "pair1" }),
        data: { deletedAt: null },
      })
    );
  });

  it("clears deletedAt on a single row", async () => {
    signIn();
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
      id: "t1",
      transferPairId: null,
    } as never);
    vi.mocked(prisma.transaction.update).mockResolvedValue({} as never);

    const res = await restoreTransaction("t1");

    expect(res.success).toBe(true);
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { deletedAt: null },
    });
  });
});

describe("hardDeleteTransaction", () => {
  it("rejects an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await hardDeleteTransaction("t1");

    expect(res.success).toBe(false);
    expect(prisma.transaction.findFirst).not.toHaveBeenCalled();
  });

  it("only targets already-soft-deleted rows it owns", async () => {
    signIn();
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
      id: "t1",
      transferPairId: null,
    } as never);
    vi.mocked(prisma.transaction.delete).mockResolvedValue({} as never);

    await hardDeleteTransaction("t1");

    expect(prisma.transaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "t1",
          userId: "u1",
          deletedAt: { not: null },
        }),
      })
    );
  });

  it("returns not-found for a missing / live / foreign row", async () => {
    signIn();
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);

    const res = await hardDeleteTransaction("t1");

    expect(res.success).toBe(false);
    expect(res.error).toBe("Transaction not found.");
    expect(prisma.transaction.delete).not.toHaveBeenCalled();
    expect(prisma.transaction.deleteMany).not.toHaveBeenCalled();
  });

  it("hard-deletes a single non-transfer row", async () => {
    signIn();
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
      id: "t1",
      transferPairId: null,
    } as never);
    vi.mocked(prisma.transaction.delete).mockResolvedValue({} as never);

    const res = await hardDeleteTransaction("t1");

    expect(res.success).toBe(true);
    expect(prisma.transaction.delete).toHaveBeenCalledWith({
      where: { id: "t1" },
    });
    expect(prisma.transaction.deleteMany).not.toHaveBeenCalled();
  });

  it("hard-deletes both legs of a transfer by transferPairId", async () => {
    signIn();
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
      id: "t1",
      transferPairId: "pair1",
    } as never);
    vi.mocked(prisma.transaction.deleteMany).mockResolvedValue({
      count: 2,
    } as never);

    const res = await hardDeleteTransaction("t1");

    expect(res.success).toBe(true);
    expect(prisma.transaction.deleteMany).toHaveBeenCalledWith({
      where: { transferPairId: "pair1", userId: "u1", deletedAt: { not: null } },
    });
    expect(prisma.transaction.delete).not.toHaveBeenCalled();
  });

  it("revalidates transaction views on success", async () => {
    signIn();
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
      id: "t1",
      transferPairId: null,
    } as never);
    vi.mocked(prisma.transaction.delete).mockResolvedValue({} as never);

    await hardDeleteTransaction("t1");

    expect(revalidatePath).toHaveBeenCalledWith("/trash");
  });
});

describe("emptyTrash", () => {
  it("rejects an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await emptyTrash();

    expect(res.success).toBe(false);
    expect(prisma.transaction.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes every soft-deleted row scoped to the user", async () => {
    signIn();
    vi.mocked(prisma.transaction.deleteMany).mockResolvedValue({
      count: 5,
    } as never);

    const res = await emptyTrash();

    expect(res.success).toBe(true);
    expect(prisma.transaction.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", deletedAt: { not: null } },
    });
  });

  it("is a safe no-op when the trash is empty", async () => {
    signIn();
    vi.mocked(prisma.transaction.deleteMany).mockResolvedValue({
      count: 0,
    } as never);

    const res = await emptyTrash();

    expect(res.success).toBe(true);
  });
});
