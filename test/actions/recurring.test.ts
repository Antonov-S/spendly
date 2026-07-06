import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createTemplate,
  updateTemplate,
  pauseTemplate,
  resumeTemplate,
  deleteTemplate,
  getTemplateForEdit,
  confirmDraft,
  dismissDraft,
  muteRecurringSuggestion,
} from "@/actions/recurring";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { track } from "@/lib/analytics/track";
import { getTemplateForEdit as getTemplateForEditQuery } from "@/lib/db/recurring";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/revalidation", () => ({ revalidateTransactionViews: vi.fn() }));
vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));
vi.mock("@/lib/db/recurring", () => ({ getTemplateForEdit: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    recurringTemplate: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    recurringDraft: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    recurringSuggestionMute: { upsert: vi.fn() },
    financialAccount: { findFirst: vi.fn() },
    category: { findFirst: vi.fn() },
    transaction: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const mockAuth = vi.mocked(auth);
const mockTrack = vi.mocked(track);

/** Authenticate the session as `id`. */
function signIn(id = "u1") {
  mockAuth.mockResolvedValue({ user: { id } } as never);
}

/** Minimal Prisma.Decimal stand-in with the `.negated()` we rely on. */
function decimal(n: number) {
  return {
    negated: () => decimal(-n),
    toString: () => String(n),
    valueOf: () => n,
    __value: n,
  };
}

/** Run the interactive `$transaction` callback against the prisma mock itself. */
function runTxWithCallback() {
  vi.mocked(prisma.$transaction).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (async (cb: any) => cb(prisma)) as never
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authentication", () => {
  it("rejects every action when not signed in", async () => {
    mockAuth.mockResolvedValue(null as never);

    expect(
      (
        await createTemplate({
          name: "Rent",
          type: "EXPENSE",
          amount: 1000,
          cadence: "MONTHLY",
          nextOccurrence: "2026-06-16",
          financialAccountId: "a1",
        })
      ).success
    ).toBe(false);
    expect(
      (await updateTemplate("t1", { name: "x", amount: 1, cadence: "MONTHLY" }))
        .success
    ).toBe(false);
    expect((await pauseTemplate("t1")).success).toBe(false);
    expect((await resumeTemplate("t1")).success).toBe(false);
    expect((await deleteTemplate("t1")).success).toBe(false);
    expect((await getTemplateForEdit("t1")).success).toBe(false);
    expect((await confirmDraft("d1")).success).toBe(false);
    expect((await dismissDraft("d1")).success).toBe(false);

    expect(prisma.recurringTemplate.create).not.toHaveBeenCalled();
  });
});

describe("createTemplate", () => {
  function validInput() {
    return {
      name: "Netflix",
      type: "EXPENSE" as const,
      amount: 12.99,
      cadence: "MONTHLY" as const,
      nextOccurrence: "2026-06-20",
      financialAccountId: "a1",
    };
  }

  it("rejects a nonexistent or archived account", async () => {
    signIn();
    vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue(null as never);

    const res = await createTemplate(validInput());

    expect(res.success).toBe(false);
    expect(prisma.recurringTemplate.create).not.toHaveBeenCalled();
  });

  it("resolves currency from the account and inserts with the session userId", async () => {
    signIn("user-9");
    vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue({
      currency: "EUR",
    } as never);

    const res = await createTemplate(validInput());

    expect(res.success).toBe(true);
    const data = vi.mocked(prisma.recurringTemplate.create).mock.calls[0][0]
      .data as Record<string, unknown>;
    expect(data.currency).toBe("EUR");
    expect(data.userId).toBe("user-9");
    expect(data.amount).toBe(12.99);
    expect(data.categoryId).toBeNull();
  });

  it("rejects a categoryId owned by another user", async () => {
    signIn();
    vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue({
      currency: "USD",
    } as never);
    vi.mocked(prisma.category.findFirst).mockResolvedValue(null as never);

    const res = await createTemplate({ ...validInput(), categoryId: "foreign" });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/category/i);
    expect(prisma.recurringTemplate.create).not.toHaveBeenCalled();
  });

  it("accepts a system or owned category", async () => {
    signIn();
    vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue({
      currency: "USD",
    } as never);
    vi.mocked(prisma.category.findFirst).mockResolvedValue({ id: "c1" } as never);

    const res = await createTemplate({ ...validInput(), categoryId: "c1" });

    expect(res.success).toBe(true);
    const data = vi.mocked(prisma.recurringTemplate.create).mock.calls[0][0]
      .data as Record<string, unknown>;
    expect(data.categoryId).toBe("c1");
  });

  it("rejects TRANSFER at the schema level", async () => {
    signIn();
    const res = await createTemplate({
      ...validInput(),
      // @ts-expect-error — TRANSFER is intentionally not assignable.
      type: "TRANSFER",
    });
    expect(res.success).toBe(false);
    expect(prisma.financialAccount.findFirst).not.toHaveBeenCalled();
  });
});

describe("updateTemplate", () => {
  it("404s when the template is not owned by the session user", async () => {
    signIn();
    vi.mocked(prisma.recurringTemplate.findFirst).mockResolvedValue(null as never);

    const res = await updateTemplate("t1", {
      name: "x",
      amount: 5,
      cadence: "WEEKLY",
    });

    expect(res.success).toBe(false);
    expect(prisma.recurringTemplate.update).not.toHaveBeenCalled();
  });

  it("updates only name/amount/cadence and never touches nextOccurrence", async () => {
    signIn();
    vi.mocked(prisma.recurringTemplate.findFirst).mockResolvedValue({
      id: "t1",
    } as never);

    const res = await updateTemplate("t1", {
      name: "New name",
      amount: 9.5,
      cadence: "YEARLY",
    });

    expect(res.success).toBe(true);
    const data = vi.mocked(prisma.recurringTemplate.update).mock.calls[0][0]
      .data as Record<string, unknown>;
    expect(data).toEqual({ name: "New name", amount: 9.5, cadence: "YEARLY" });
    expect(data).not.toHaveProperty("nextOccurrence");
  });
});

describe("pause / resume", () => {
  it("pauseTemplate sets isActive=false on an owned template", async () => {
    signIn();
    vi.mocked(prisma.recurringTemplate.findFirst).mockResolvedValue({
      id: "t1",
    } as never);

    const res = await pauseTemplate("t1");

    expect(res.success).toBe(true);
    const data = vi.mocked(prisma.recurringTemplate.update).mock.calls[0][0]
      .data as Record<string, unknown>;
    expect(data).toEqual({ isActive: false });
  });

  it("resumeTemplate sets isActive=true and does not write nextOccurrence", async () => {
    signIn();
    vi.mocked(prisma.recurringTemplate.findFirst).mockResolvedValue({
      id: "t1",
    } as never);

    const res = await resumeTemplate("t1");

    expect(res.success).toBe(true);
    const data = vi.mocked(prisma.recurringTemplate.update).mock.calls[0][0]
      .data as Record<string, unknown>;
    expect(data).toEqual({ isActive: true });
    expect(data).not.toHaveProperty("nextOccurrence");
  });

  it("guards ownership before flipping the flag", async () => {
    signIn();
    vi.mocked(prisma.recurringTemplate.findFirst).mockResolvedValue(null as never);

    expect((await pauseTemplate("t1")).success).toBe(false);
    expect(prisma.recurringTemplate.update).not.toHaveBeenCalled();
  });
});

describe("deleteTemplate", () => {
  it("hard-deletes an owned template", async () => {
    signIn();
    vi.mocked(prisma.recurringTemplate.findFirst).mockResolvedValue({
      id: "t1",
    } as never);

    const res = await deleteTemplate("t1");

    expect(res.success).toBe(true);
    expect(prisma.recurringTemplate.delete).toHaveBeenCalledWith({
      where: { id: "t1" },
    });
  });

  it("404s and does not delete when not owner", async () => {
    signIn();
    vi.mocked(prisma.recurringTemplate.findFirst).mockResolvedValue(null as never);

    expect((await deleteTemplate("t1")).success).toBe(false);
    expect(prisma.recurringTemplate.delete).not.toHaveBeenCalled();
  });
});

describe("getTemplateForEdit (proxy)", () => {
  it("returns the editable shape for an owned template", async () => {
    signIn("u1");
    vi.mocked(getTemplateForEditQuery).mockResolvedValue({
      id: "t1",
      name: "Netflix",
      type: "EXPENSE",
      amount: 12.99,
      cadence: "MONTHLY",
      nextOccurrence: "2026-06-20",
      financialAccountId: "a1",
      categoryId: "c1",
    } as never);

    const res = await getTemplateForEdit("t1");

    expect(res.success).toBe(true);
    expect(res.data?.name).toBe("Netflix");
    expect(getTemplateForEditQuery).toHaveBeenCalledWith("u1", "t1");
  });

  it("404s when the query returns null", async () => {
    signIn();
    vi.mocked(getTemplateForEditQuery).mockResolvedValue(null as never);
    expect((await getTemplateForEdit("t1")).success).toBe(false);
  });
});

describe("confirmDraft", () => {
  function pendingDraft(overrides: Record<string, unknown> = {}) {
    return {
      id: "d1",
      status: "PENDING",
      suggestedDate: new Date("2026-06-16T00:00:00.000Z"),
      suggestedAmount: decimal(12.99),
      recurringTemplate: {
        id: "t1",
        userId: "u1",
        name: "Netflix",
        type: "EXPENSE",
        currency: "USD",
        cadence: "MONTHLY",
        nextOccurrence: new Date("2026-06-16T00:00:00.000Z"),
        financialAccountId: "a1",
        categoryId: "c1",
      },
      ...overrides,
    };
  }

  it("404s when the draft does not belong to the session user", async () => {
    signIn("u1");
    vi.mocked(prisma.recurringDraft.findUnique).mockResolvedValue(
      pendingDraft({
        recurringTemplate: { ...pendingDraft().recurringTemplate, userId: "other" },
      }) as never
    );

    expect((await confirmDraft("d1")).success).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("errors when the draft is no longer PENDING", async () => {
    signIn("u1");
    vi.mocked(prisma.recurringDraft.findUnique).mockResolvedValue(
      pendingDraft({ status: "CONFIRMED" }) as never
    );

    expect((await confirmDraft("d1")).success).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("claims, creates a negative EXPENSE transaction, and advances nextOccurrence", async () => {
    signIn("u1");
    vi.mocked(prisma.recurringDraft.findUnique).mockResolvedValue(
      pendingDraft() as never
    );
    vi.mocked(prisma.recurringDraft.updateMany).mockResolvedValue({
      count: 1,
    } as never);
    runTxWithCallback();

    const res = await confirmDraft("d1");

    expect(res.success).toBe(true);
    // Claim used the status guard.
    expect(prisma.recurringDraft.updateMany).toHaveBeenCalledWith({
      where: { id: "d1", status: "PENDING" },
      data: { status: "CONFIRMED" },
    });
    // Transaction sign is negative for EXPENSE (Decimal.negated()).
    const txData = vi.mocked(prisma.transaction.create).mock.calls[0][0]
      .data as Record<string, unknown>;
    expect((txData.amount as { __value: number }).__value).toBe(-12.99);
    expect(txData.recurringTemplateId).toBe("t1");
    // Template name is stamped as the merchant so the row is identifiable.
    expect(txData.merchant).toBe("Netflix");
    // nextOccurrence advanced one month (Jun 16 -> Jul 16).
    const updData = vi.mocked(prisma.recurringTemplate.update).mock.calls[0][0]
      .data as { nextOccurrence: Date };
    expect(updData.nextOccurrence.toISOString()).toBe("2026-07-16T00:00:00.000Z");
    // Telemetry: the success path emits draft_confirmed with the cadence (§0).
    expect(track).toHaveBeenCalledWith("draft_confirmed", { cadence: "MONTHLY" });
  });

  it("creates a positive INCOME transaction", async () => {
    signIn("u1");
    vi.mocked(prisma.recurringDraft.findUnique).mockResolvedValue(
      pendingDraft({
        suggestedAmount: decimal(3000),
        recurringTemplate: {
          ...pendingDraft().recurringTemplate,
          type: "INCOME",
        },
      }) as never
    );
    vi.mocked(prisma.recurringDraft.updateMany).mockResolvedValue({
      count: 1,
    } as never);
    runTxWithCallback();

    const res = await confirmDraft("d1");

    expect(res.success).toBe(true);
    const txData = vi.mocked(prisma.transaction.create).mock.calls[0][0]
      .data as Record<string, unknown>;
    expect((txData.amount as { __value: number }).__value).toBe(3000);
  });

  it("is idempotent: a count===0 claim creates no transaction and errors", async () => {
    signIn("u1");
    vi.mocked(prisma.recurringDraft.findUnique).mockResolvedValue(
      pendingDraft() as never
    );
    vi.mocked(prisma.recurringDraft.updateMany).mockResolvedValue({
      count: 0,
    } as never);
    runTxWithCallback();

    const res = await confirmDraft("d1");

    expect(res.success).toBe(false);
    expect(prisma.transaction.create).not.toHaveBeenCalled();
    expect(prisma.recurringTemplate.update).not.toHaveBeenCalled();
  });
});

describe("dismissDraft", () => {
  function pendingDraft(overrides: Record<string, unknown> = {}) {
    return {
      id: "d1",
      status: "PENDING",
      suggestedDate: new Date("2026-06-16T00:00:00.000Z"),
      suggestedAmount: decimal(12.99),
      recurringTemplate: {
        id: "t1",
        userId: "u1",
        cadence: "MONTHLY",
        nextOccurrence: new Date("2026-06-16T00:00:00.000Z"),
      },
      ...overrides,
    };
  }

  it("404s when not owner", async () => {
    signIn("u1");
    vi.mocked(prisma.recurringDraft.findUnique).mockResolvedValue(
      pendingDraft({
        recurringTemplate: { ...pendingDraft().recurringTemplate, userId: "x" },
      }) as never
    );
    expect((await dismissDraft("d1")).success).toBe(false);
  });

  it("claims, sets DISMISSED, and advances nextOccurrence atomically", async () => {
    signIn("u1");
    vi.mocked(prisma.recurringDraft.findUnique).mockResolvedValue(
      pendingDraft() as never
    );
    vi.mocked(prisma.recurringDraft.updateMany).mockResolvedValue({
      count: 1,
    } as never);
    runTxWithCallback();

    const res = await dismissDraft("d1");

    expect(res.success).toBe(true);
    expect(prisma.recurringDraft.updateMany).toHaveBeenCalledWith({
      where: { id: "d1", status: "PENDING" },
      data: { status: "DISMISSED" },
    });
    const updData = vi.mocked(prisma.recurringTemplate.update).mock.calls[0][0]
      .data as { nextOccurrence: Date };
    expect(updData.nextOccurrence.toISOString()).toBe("2026-07-16T00:00:00.000Z");
  });

  it("is idempotent: a count===0 claim performs no advance and errors", async () => {
    signIn("u1");
    vi.mocked(prisma.recurringDraft.findUnique).mockResolvedValue(
      pendingDraft() as never
    );
    vi.mocked(prisma.recurringDraft.updateMany).mockResolvedValue({
      count: 0,
    } as never);
    runTxWithCallback();

    const res = await dismissDraft("d1");

    expect(res.success).toBe(false);
    expect(prisma.recurringTemplate.update).not.toHaveBeenCalled();
  });
});

describe("muteRecurringSuggestion", () => {
  it("fails when not signed in", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await muteRecurringSuggestion({
      merchantKey: "netflix",
      outcome: "dismissed",
      cadence: "MONTHLY",
    });

    expect(res.success).toBe(false);
    expect(prisma.recurringSuggestionMute.upsert).not.toHaveBeenCalled();
  });

  it("rejects invalid input (blank merchantKey)", async () => {
    signIn("u1");

    const res = await muteRecurringSuggestion({
      merchantKey: "   ",
      outcome: "dismissed",
      cadence: "MONTHLY",
    });

    expect(res.success).toBe(false);
    expect(prisma.recurringSuggestionMute.upsert).not.toHaveBeenCalled();
  });

  it("re-normalizes the raw key before the upsert", async () => {
    signIn("u1");
    vi.mocked(prisma.recurringSuggestionMute.upsert).mockResolvedValue(
      {} as never
    );

    const res = await muteRecurringSuggestion({
      merchantKey: "  NETFLIX  ",
      outcome: "dismissed",
      cadence: "MONTHLY",
    });

    expect(res.success).toBe(true);
    const arg = vi.mocked(prisma.recurringSuggestionMute.upsert).mock.calls[0][0];
    // Server-side normalization: canonical lower/trimmed key is stored + queried.
    expect(arg.where).toEqual({
      userId_merchantKey: { userId: "u1", merchantKey: "netflix" },
    });
    expect(arg.create).toEqual({ userId: "u1", merchantKey: "netflix" });
    expect(arg.update).toEqual({});
  });

  it("is idempotent across a double-call (upsert absorbs the second)", async () => {
    signIn("u1");
    vi.mocked(prisma.recurringSuggestionMute.upsert).mockResolvedValue(
      {} as never
    );

    const input = {
      merchantKey: "netflix",
      outcome: "dismissed" as const,
      cadence: "MONTHLY" as const,
    };
    await muteRecurringSuggestion(input);
    await muteRecurringSuggestion(input);

    // Both calls issue the same upsert — the unique constraint makes it a no-op.
    expect(prisma.recurringSuggestionMute.upsert).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(prisma.recurringSuggestionMute.upsert).mock.calls) {
      expect(call[0].where).toEqual({
        userId_merchantKey: { userId: "u1", merchantKey: "netflix" },
      });
    }
  });

  it("emits exactly one telemetry event with the matching outcome name", async () => {
    signIn("u1");
    vi.mocked(prisma.recurringSuggestionMute.upsert).mockResolvedValue(
      {} as never
    );

    await muteRecurringSuggestion({
      merchantKey: "spotify",
      outcome: "accepted",
      cadence: "WEEKLY",
    });

    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith("recurring_suggestion_accepted", {
      cadence: "WEEKLY",
    });
  });

  it("emits the dismissed event name for a dismiss outcome", async () => {
    signIn("u1");
    vi.mocked(prisma.recurringSuggestionMute.upsert).mockResolvedValue(
      {} as never
    );

    await muteRecurringSuggestion({
      merchantKey: "gym",
      outcome: "dismissed",
      cadence: "MONTHLY",
    });

    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith("recurring_suggestion_dismissed", {
      cadence: "MONTHLY",
    });
  });
});
