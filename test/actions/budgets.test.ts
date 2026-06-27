import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createBudget,
  updateBudget,
  archiveBudget,
  unarchiveBudget,
  seedPresetBudgets,
  getBudgetForEdit,
} from "@/actions/budgets";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getBudgetForEdit as getBudgetForEditQuery } from "@/lib/db/budgets";
import { BUDGET_PRESETS } from "@/lib/constants";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/budgets", () => ({ getBudgetForEdit: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    budget: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      createMany: vi.fn(),
    },
    category: { findFirst: vi.fn(), findMany: vi.fn() },
    user: { findUniqueOrThrow: vi.fn() },
  },
}));

const mockAuth = vi.mocked(auth);

/** Authenticate the session as `id` for the action under test. */
function signIn(id = "u1") {
  mockAuth.mockResolvedValue({ user: { id } } as never);
}

/** A Prisma-style unique-constraint error. */
function p2002(): Error & { code: string } {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authentication", () => {
  it("rejects every action when not signed in", async () => {
    mockAuth.mockResolvedValue(null as never);

    expect(
      (
        await createBudget({
          categoryId: "c1",
          amount: 100,
          month: 6,
          year: 2026,
          rollover: false,
        })
      ).success
    ).toBe(false);
    expect(
      (await updateBudget("b1", { amount: 100, rollover: false })).success
    ).toBe(false);
    expect((await archiveBudget("b1")).success).toBe(false);
    expect((await unarchiveBudget("b1")).success).toBe(false);
    expect((await seedPresetBudgets(6, 2026)).success).toBe(false);
    expect((await getBudgetForEdit("b1")).success).toBe(false);

    expect(prisma.budget.upsert).not.toHaveBeenCalled();
  });
});

describe("createBudget", () => {
  function validInput() {
    return { categoryId: "c1", amount: 250, month: 6, year: 2026, rollover: false };
  }

  function setupOwnedCategory() {
    vi.mocked(prisma.category.findFirst).mockResolvedValue({ id: "c1" } as never);
  }

  it("rejects a category the user does not own or share (system)", async () => {
    signIn();
    vi.mocked(prisma.category.findFirst).mockResolvedValue(null);

    const res = await createBudget(validInput());

    expect(res.success).toBe(false);
    expect(prisma.budget.upsert).not.toHaveBeenCalled();
  });

  it("stamps EUR currency and inserts when no row exists", async () => {
    signIn();
    setupOwnedCategory();
    vi.mocked(prisma.budget.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.budget.upsert).mockResolvedValue({ id: "new" } as never);

    const res = await createBudget(validInput());

    expect(res.success).toBe(true);
    const args = vi.mocked(prisma.budget.upsert).mock.calls[0][0] as {
      create: { currency: string; amount: number };
    };
    expect(args.create.currency).toBe("EUR");
    expect(args.create.amount).toBe(250);
    // Currency resolves from DEFAULT_CURRENCY, never the user record.
    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("revives an archived row via upsert (update branch), keeping its id", async () => {
    signIn();
    setupOwnedCategory();
    vi.mocked(prisma.budget.findUnique).mockResolvedValue({
      id: "existing",
      isArchived: true,
    } as never);
    vi.mocked(prisma.budget.upsert).mockResolvedValue({ id: "existing" } as never);

    const res = await createBudget(validInput());

    expect(res.success).toBe(true);
    // Single upsert keyed on the unique tuple — never a second create.
    expect(prisma.budget.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.budget.create).not.toHaveBeenCalled();
    const args = vi.mocked(prisma.budget.upsert).mock.calls[0][0] as {
      where: unknown;
      update: { amount: number; currency: string; isArchived: boolean; rollover: boolean };
    };
    expect(args.update).toEqual({
      amount: 250,
      currency: "EUR",
      isArchived: false,
      rollover: false,
    });
    expect(args.where).toEqual({
      userId_categoryId_month_year: {
        userId: "u1",
        categoryId: "c1",
        month: 6,
        year: 2026,
      },
    });
  });

  it("ignores a USD preferredCurrency and still stamps EUR", async () => {
    signIn();
    setupOwnedCategory();
    // A legacy user whose preferredCurrency is USD must not leak into the budget.
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
      preferredCurrency: "USD",
    } as never);
    vi.mocked(prisma.budget.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.budget.upsert).mockResolvedValue({ id: "new" } as never);

    const res = await createBudget(validInput());

    expect(res.success).toBe(true);
    const args = vi.mocked(prisma.budget.upsert).mock.calls[0][0] as {
      create: { currency: string };
    };
    expect(args.create.currency).toBe("EUR");
    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("returns a friendly error for an active duplicate without upserting", async () => {
    signIn();
    setupOwnedCategory();
    vi.mocked(prisma.budget.findUnique).mockResolvedValue({
      id: "existing",
      isArchived: false,
    } as never);

    const res = await createBudget(validInput());

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/already exists/i);
    expect(prisma.budget.upsert).not.toHaveBeenCalled();
  });

  it("maps a racing P2002 to the friendly duplicate error", async () => {
    signIn();
    setupOwnedCategory();
    vi.mocked(prisma.budget.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.budget.upsert).mockRejectedValue(p2002());

    const res = await createBudget(validInput());

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/already exists/i);
  });

  it("rejects a non-positive amount", async () => {
    signIn();
    const res = await createBudget({ ...validInput(), amount: 0 });
    expect(res.success).toBe(false);
    expect(prisma.budget.upsert).not.toHaveBeenCalled();
  });

  it("rejects an amount over the cap", async () => {
    signIn();
    const res = await createBudget({ ...validInput(), amount: 1_000_001 });
    expect(res.success).toBe(false);
    expect(prisma.budget.upsert).not.toHaveBeenCalled();
  });

  it("persists rollover in both the create and the revive (update) branch", async () => {
    signIn();
    setupOwnedCategory();
    vi.mocked(prisma.budget.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.budget.upsert).mockResolvedValue({ id: "new" } as never);

    const res = await createBudget({ ...validInput(), rollover: true });

    expect(res.success).toBe(true);
    const args = vi.mocked(prisma.budget.upsert).mock.calls[0][0] as {
      create: { rollover: boolean };
      update: { rollover: boolean };
    };
    expect(args.create.rollover).toBe(true);
    expect(args.update.rollover).toBe(true);
  });

  it("rejects a non-boolean rollover", async () => {
    signIn();
    setupOwnedCategory();
    const res = await createBudget({
      ...validInput(),
      rollover: "yes" as unknown as boolean,
    });
    expect(res.success).toBe(false);
    expect(prisma.budget.upsert).not.toHaveBeenCalled();
  });
});

describe("updateBudget", () => {
  it("404s when the budget is not the user's active row", async () => {
    signIn();
    vi.mocked(prisma.budget.findFirst).mockResolvedValue(null);

    const res = await updateBudget("b1", { amount: 300, rollover: false });

    expect(res.success).toBe(false);
    expect(prisma.budget.update).not.toHaveBeenCalled();
  });

  it("updates the amount and the rollover flag in place", async () => {
    signIn();
    vi.mocked(prisma.budget.findFirst).mockResolvedValue({ id: "b1" } as never);
    vi.mocked(prisma.budget.update).mockResolvedValue({ id: "b1" } as never);

    const res = await updateBudget("b1", { amount: 300, rollover: true });

    expect(res.success).toBe(true);
    const args = vi.mocked(prisma.budget.update).mock.calls[0][0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(args.where).toEqual({ id: "b1" });
    expect(args.data).toEqual({ amount: 300, rollover: true });
  });
});

describe("archiveBudget / unarchiveBudget", () => {
  it("archive 404s when not owned", async () => {
    signIn();
    vi.mocked(prisma.budget.findFirst).mockResolvedValue(null);
    const res = await archiveBudget("b1");
    expect(res.success).toBe(false);
    expect(prisma.budget.update).not.toHaveBeenCalled();
  });

  it("archive flips isArchived to true", async () => {
    signIn();
    vi.mocked(prisma.budget.findFirst).mockResolvedValue({ id: "b1" } as never);
    vi.mocked(prisma.budget.update).mockResolvedValue({ id: "b1" } as never);

    const res = await archiveBudget("b1");

    expect(res.success).toBe(true);
    const args = vi.mocked(prisma.budget.update).mock.calls[0][0] as {
      data: { isArchived: boolean };
    };
    expect(args.data).toEqual({ isArchived: true });
  });

  it("unarchive flips isArchived to false", async () => {
    signIn();
    vi.mocked(prisma.budget.findFirst).mockResolvedValue({ id: "b1" } as never);
    vi.mocked(prisma.budget.update).mockResolvedValue({ id: "b1" } as never);

    const res = await unarchiveBudget("b1");

    expect(res.success).toBe(true);
    const args = vi.mocked(prisma.budget.update).mock.calls[0][0] as {
      data: { isArchived: boolean };
    };
    expect(args.data).toEqual({ isArchived: false });
  });

  it("unarchive returns a friendly error when the slot is re-occupied (P2002)", async () => {
    signIn();
    vi.mocked(prisma.budget.findFirst).mockResolvedValue({ id: "b1" } as never);
    vi.mocked(prisma.budget.update).mockRejectedValue(p2002());

    const res = await unarchiveBudget("b1");

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/already exists/i);
  });
});

describe("seedPresetBudgets", () => {
  it("creates EUR budgets for unbudgeted preset categories and reports the count", async () => {
    signIn();
    // All four presets resolve to system categories.
    vi.mocked(prisma.category.findMany).mockResolvedValue(
      BUDGET_PRESETS.map((p, i) => ({ id: `cat-${i}`, name: p.categoryName })) as never
    );
    // None already budgeted.
    vi.mocked(prisma.budget.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.budget.createMany).mockResolvedValue({
      count: BUDGET_PRESETS.length,
    } as never);

    const res = await seedPresetBudgets(6, 2026);

    expect(res.success).toBe(true);
    expect(res.data?.created).toBe(BUDGET_PRESETS.length);
    const args = vi.mocked(prisma.budget.createMany).mock.calls[0][0] as {
      data: { currency: string; rollover: boolean }[];
      skipDuplicates: boolean;
    };
    expect(args.data).toHaveLength(BUDGET_PRESETS.length);
    expect(args.data.every((d) => d.currency === "EUR")).toBe(true);
    expect(args.data.every((d) => d.rollover === false)).toBe(true);
    expect(args.skipDuplicates).toBe(true);
    // Currency comes from DEFAULT_CURRENCY, not the user record.
    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("skips categories already budgeted (archived or active) for the period", async () => {
    signIn();
    vi.mocked(prisma.category.findMany).mockResolvedValue(
      BUDGET_PRESETS.map((p, i) => ({ id: `cat-${i}`, name: p.categoryName })) as never
    );
    // First preset category already has a row.
    vi.mocked(prisma.budget.findMany).mockResolvedValue([
      { categoryId: "cat-0" },
    ] as never);
    vi.mocked(prisma.budget.createMany).mockResolvedValue({
      count: BUDGET_PRESETS.length - 1,
    } as never);

    const res = await seedPresetBudgets(6, 2026);

    expect(res.success).toBe(true);
    const args = vi.mocked(prisma.budget.createMany).mock.calls[0][0] as {
      data: { categoryId: string }[];
    };
    expect(args.data).toHaveLength(BUDGET_PRESETS.length - 1);
    expect(args.data.some((d) => d.categoryId === "cat-0")).toBe(false);
  });

  it("drops unresolved preset names without erroring", async () => {
    signIn();
    // Only the first preset resolves.
    vi.mocked(prisma.category.findMany).mockResolvedValue([
      { id: "cat-0", name: BUDGET_PRESETS[0].categoryName },
    ] as never);
    vi.mocked(prisma.budget.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.budget.createMany).mockResolvedValue({ count: 1 } as never);

    const res = await seedPresetBudgets(6, 2026);

    expect(res.success).toBe(true);
    const args = vi.mocked(prisma.budget.createMany).mock.calls[0][0] as {
      data: unknown[];
    };
    expect(args.data).toHaveLength(1);
  });

  it("returns created:0 and skips createMany when nothing resolves", async () => {
    signIn();
    vi.mocked(prisma.category.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.budget.findMany).mockResolvedValue([] as never);

    const res = await seedPresetBudgets(6, 2026);

    expect(res.success).toBe(true);
    expect(res.data?.created).toBe(0);
    expect(prisma.budget.createMany).not.toHaveBeenCalled();
  });
});

describe("getBudgetForEdit (proxy)", () => {
  it("delegates to the read fetcher with the session user id", async () => {
    signIn("u9");
    vi.mocked(getBudgetForEditQuery).mockResolvedValue({
      id: "b1",
      categoryId: "c1",
      amount: 250,
      month: 6,
      year: 2026,
    });

    const res = await getBudgetForEdit("b1");

    expect(res.success).toBe(true);
    expect(res.data?.amount).toBe(250);
    expect(getBudgetForEditQuery).toHaveBeenCalledWith("u9", "b1");
  });

  it("returns a not-found error when the fetcher yields null", async () => {
    signIn();
    vi.mocked(getBudgetForEditQuery).mockResolvedValue(null);

    const res = await getBudgetForEdit("missing");

    expect(res.success).toBe(false);
  });
});

describe("BUDGET_PRESETS seed drift guard", () => {
  // Canonical seeded system-category names (prisma/seed.ts). If a preset name
  // drifts away from this list, seedPresetBudgets would silently create nothing
  // for it — fail loudly here instead.
  const SEEDED_CATEGORY_NAMES = [
    "Groceries",
    "Dining",
    "Transport",
    "Housing",
    "Utilities",
    "Health",
    "Entertainment",
    "Miscellaneous",
    "Salary",
    "Freelance",
    "Subscriptions",
    "Clothing",
    "Education",
    "Insurance",
    "Gifts",
    "Travel",
    "Taxes",
    "Pets",
    "Investment",
    "Uncategorized",
  ];

  it("every preset name matches a seeded system category", () => {
    for (const preset of BUDGET_PRESETS) {
      expect(SEEDED_CATEGORY_NAMES).toContain(preset.categoryName);
    }
  });
});
