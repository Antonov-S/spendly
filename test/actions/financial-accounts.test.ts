import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createFinancialAccount,
  updateFinancialAccount,
  archiveFinancialAccount,
  unarchiveFinancialAccount,
  getAccountForEdit,
} from "@/actions/financial-accounts";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAccountForEdit as getAccountForEditQuery } from "@/lib/db/accounts";
import type { CreateAccountInput } from "@/lib/validations/financial-account";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/accounts", () => ({ getAccountForEdit: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    financialAccount: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    recurringTemplate: { updateMany: vi.fn() },
    // Run the callback against the same mocked prisma (single connection in tests).
    $transaction: vi.fn(),
  },
}));

const mockAuth = vi.mocked(auth);

/** Authenticate the session as `id` for the action under test. */
function signIn(id = "u1") {
  mockAuth.mockResolvedValue({ user: { id } } as never);
}

/** A valid create payload (positive checking account). */
function validCreate(overrides: Partial<CreateAccountInput> = {}): CreateAccountInput {
  return {
    name: "Checking",
    type: "CHECKING",
    startingBalance: 1800,
    color: "#1D9E75",
    icon: "Wallet",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: $transaction invokes its callback with the mocked prisma client.
  vi.mocked(prisma.$transaction).mockImplementation(
    (async (fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never
  );
});

describe("authentication", () => {
  it("rejects every action when not signed in", async () => {
    mockAuth.mockResolvedValue(null as never);

    expect((await createFinancialAccount(validCreate())).success).toBe(false);
    expect(
      (await updateFinancialAccount({ id: "a1", name: "X", color: null, icon: null }))
        .success
    ).toBe(false);
    expect((await archiveFinancialAccount("a1")).success).toBe(false);
    expect((await unarchiveFinancialAccount("a1")).success).toBe(false);
    expect((await getAccountForEdit("a1")).success).toBe(false);

    expect(prisma.financialAccount.create).not.toHaveBeenCalled();
    expect(prisma.financialAccount.updateMany).not.toHaveBeenCalled();
  });
});

describe("createFinancialAccount", () => {
  it("inserts with the session userId", async () => {
    signIn("u1");
    vi.mocked(prisma.financialAccount.create).mockResolvedValue({} as never);

    const res = await createFinancialAccount(validCreate());

    expect(res.success).toBe(true);
    const data = vi.mocked(prisma.financialAccount.create).mock.calls[0][0].data;
    expect(data.userId).toBe("u1");
    expect(data.name).toBe("Checking");
  });

  it("stamps currency as EUR server-side, ignoring any client-supplied currency", async () => {
    signIn();
    vi.mocked(prisma.financialAccount.create).mockResolvedValue({} as never);

    // Client tries to sneak in a different currency — must be ignored.
    await createFinancialAccount({
      ...validCreate(),
      currency: "USD",
    } as never);

    const data = vi.mocked(prisma.financialAccount.create).mock.calls[0][0].data;
    expect(data.currency).toBe("EUR");
  });

  it("accepts a negative starting balance (liability account)", async () => {
    signIn();
    vi.mocked(prisma.financialAccount.create).mockResolvedValue({} as never);

    const res = await createFinancialAccount(
      validCreate({ type: "CREDIT_CARD", startingBalance: -500 })
    );

    expect(res.success).toBe(true);
    const data = vi.mocked(prisma.financialAccount.create).mock.calls[0][0].data;
    expect(data.startingBalance).toBe(-500);
  });

  it("rejects a starting balance beyond the bound", async () => {
    signIn();
    const res = await createFinancialAccount(
      validCreate({ startingBalance: 100_000_001 })
    );
    expect(res.success).toBe(false);
    expect(prisma.financialAccount.create).not.toHaveBeenCalled();
  });

  it("rejects an empty name", async () => {
    signIn();
    const res = await createFinancialAccount(validCreate({ name: "  " }));
    expect(res.success).toBe(false);
    expect(prisma.financialAccount.create).not.toHaveBeenCalled();
  });

  it("rejects a malformed hex color", async () => {
    signIn();
    const res = await createFinancialAccount(
      validCreate({ color: "red" } as never)
    );
    expect(res.success).toBe(false);
    expect(prisma.financialAccount.create).not.toHaveBeenCalled();
  });

  it("rejects an icon outside the ACCOUNT_ICONS whitelist", async () => {
    signIn();
    const res = await createFinancialAccount(
      validCreate({ icon: "Skull" } as never)
    );
    expect(res.success).toBe(false);
    expect(prisma.financialAccount.create).not.toHaveBeenCalled();
  });
});

describe("updateFinancialAccount", () => {
  it("scopes the ownership lookup by userId", async () => {
    signIn("u1");
    vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue({ id: "a1" } as never);
    vi.mocked(prisma.financialAccount.update).mockResolvedValue({} as never);

    const res = await updateFinancialAccount({
      id: "a1",
      name: "Renamed",
      color: null,
      icon: null,
    });

    expect(res.success).toBe(true);
    const where = vi.mocked(prisma.financialAccount.findFirst).mock.calls[0][0].where;
    expect(where).toMatchObject({ id: "a1", userId: "u1" });
  });

  it("returns the standardized not-found for an unknown/foreign id", async () => {
    signIn();
    vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue(null);

    const res = await updateFinancialAccount({
      id: "ghost",
      name: "X",
      color: null,
      icon: null,
    });

    expect(res).toEqual({ success: false, error: "Account not found." });
    expect(prisma.financialAccount.update).not.toHaveBeenCalled();
  });
});

describe("archiveFinancialAccount", () => {
  it("sets isArchived true scoped by userId and pauses the account's active templates", async () => {
    signIn("u1");
    vi.mocked(prisma.financialAccount.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.recurringTemplate.updateMany).mockResolvedValue({ count: 2 } as never);

    const res = await archiveFinancialAccount("a1");

    expect(res.success).toBe(true);
    const acctCall = vi.mocked(prisma.financialAccount.updateMany).mock.calls[0][0];
    expect(acctCall.where).toMatchObject({ id: "a1", userId: "u1" });
    expect(acctCall.data).toMatchObject({ isArchived: true });

    const tplCall = vi.mocked(prisma.recurringTemplate.updateMany).mock.calls[0][0];
    expect(tplCall.where).toMatchObject({
      financialAccountId: "a1",
      userId: "u1",
      isActive: true,
    });
    expect(tplCall.data).toMatchObject({ isActive: false });
  });

  it("is idempotent — re-archiving still returns success without error", async () => {
    signIn();
    // Already archived: updateMany still matches the row → count 1.
    vi.mocked(prisma.financialAccount.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.recurringTemplate.updateMany).mockResolvedValue({ count: 0 } as never);

    const res = await archiveFinancialAccount("a1");
    expect(res).toEqual({ success: true });
  });

  it("returns not-found when no owned row matches", async () => {
    signIn();
    vi.mocked(prisma.financialAccount.updateMany).mockResolvedValue({ count: 0 } as never);

    const res = await archiveFinancialAccount("ghost");
    expect(res).toEqual({ success: false, error: "Account not found." });
    expect(prisma.recurringTemplate.updateMany).not.toHaveBeenCalled();
  });
});

describe("unarchiveFinancialAccount", () => {
  it("sets isArchived false scoped by userId", async () => {
    signIn("u1");
    vi.mocked(prisma.financialAccount.updateMany).mockResolvedValue({ count: 1 } as never);

    const res = await unarchiveFinancialAccount("a1");

    expect(res.success).toBe(true);
    const call = vi.mocked(prisma.financialAccount.updateMany).mock.calls[0][0];
    expect(call.where).toMatchObject({ id: "a1", userId: "u1" });
    expect(call.data).toMatchObject({ isArchived: false });
  });

  it("does not resume templates (asymmetric with archive)", async () => {
    signIn();
    vi.mocked(prisma.financialAccount.updateMany).mockResolvedValue({ count: 1 } as never);

    await unarchiveFinancialAccount("a1");
    expect(prisma.recurringTemplate.updateMany).not.toHaveBeenCalled();
  });

  it("returns not-found when no owned row matches", async () => {
    signIn();
    vi.mocked(prisma.financialAccount.updateMany).mockResolvedValue({ count: 0 } as never);

    const res = await unarchiveFinancialAccount("ghost");
    expect(res).toEqual({ success: false, error: "Account not found." });
  });
});

describe("getAccountForEdit", () => {
  it("returns the mapped account from the fetcher", async () => {
    signIn("u1");
    const account = {
      id: "a1",
      name: "Checking",
      type: "CHECKING",
      startingBalance: 1800,
      currency: "EUR",
      color: "#1D9E75",
      icon: "Wallet",
    };
    vi.mocked(getAccountForEditQuery).mockResolvedValue(account as never);

    const res = await getAccountForEdit("a1");

    expect(res).toEqual({ success: true, data: account });
    expect(getAccountForEditQuery).toHaveBeenCalledWith("u1", "a1");
  });

  it("returns not-found when the fetcher returns null", async () => {
    signIn();
    vi.mocked(getAccountForEditQuery).mockResolvedValue(null);

    const res = await getAccountForEdit("ghost");
    expect(res).toEqual({ success: false, error: "Account not found." });
  });
});
