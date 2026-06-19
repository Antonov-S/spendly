import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createGoal,
  updateGoal,
  completeGoal,
  deleteGoal,
  addContribution,
  deleteContribution,
  getGoalForEdit,
} from "@/actions/goals";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getGoalForEdit as getGoalForEditQuery } from "@/lib/db/goals";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/revalidation", () => ({ revalidateGoalViews: vi.fn() }));
vi.mock("@/lib/db/goals", () => ({ getGoalForEdit: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    goal: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    goalContribution: {
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const mockAuth = vi.mocked(auth);

/** Authenticate the session as `id` for the action under test. */
function signIn(id = "u1") {
  mockAuth.mockResolvedValue({ user: { id } } as never);
}

/** Run the `$transaction` callback against the prisma mock itself as `tx`. */
function runTransactionsInline() {
  vi.mocked(prisma.$transaction).mockImplementation(
    // @ts-expect-error — callback form only
    async (cb: (tx: typeof prisma) => unknown) => cb(prisma)
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authentication", () => {
  it("rejects every action when not signed in", async () => {
    mockAuth.mockResolvedValue(null as never);

    expect((await createGoal({ name: "X", targetAmount: 100 })).success).toBe(false);
    expect((await updateGoal("g1", { name: "Y" })).success).toBe(false);
    expect((await completeGoal("g1")).success).toBe(false);
    expect((await deleteGoal("g1")).success).toBe(false);
    expect(
      (await addContribution({ goalId: "g1", amount: 10, date: "2026-06-20" })).success
    ).toBe(false);
    expect((await deleteContribution("c1")).success).toBe(false);
    expect((await getGoalForEdit("g1")).success).toBe(false);

    expect(prisma.goal.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("createGoal", () => {
  it("inserts with the session userId, EUR currency, 0 saved, not completed", async () => {
    signIn("u1");
    vi.mocked(prisma.goal.create).mockResolvedValue({ id: "g1" } as never);

    const res = await createGoal({ name: "Japan Trip", targetAmount: 1000, targetDate: "2026-12-31" });
    expect(res.success).toBe(true);

    const data = vi.mocked(prisma.goal.create).mock.calls[0][0].data;
    expect(data.userId).toBe("u1");
    expect(data.currency).toBe("EUR");
    expect(data.currentAmount).toBe(0);
    expect(data.isCompleted).toBe(false);
    expect(data.targetAmount).toBe(1000);
    expect(data.targetDate).toEqual(new Date(Date.UTC(2026, 11, 31)));
  });

  it("ignores client-supplied currency / currentAmount / isCompleted", async () => {
    signIn("u1");
    vi.mocked(prisma.goal.create).mockResolvedValue({ id: "g1" } as never);

    await createGoal({
      name: "Trip",
      targetAmount: 500,
      // @ts-expect-error — these are not part of the schema and must be dropped
      currency: "USD",
      currentAmount: 999,
      isCompleted: true,
    });

    const data = vi.mocked(prisma.goal.create).mock.calls[0][0].data;
    expect(data.currency).toBe("EUR");
    expect(data.currentAmount).toBe(0);
    expect(data.isCompleted).toBe(false);
  });

  it("rejects an empty name", async () => {
    signIn();
    expect((await createGoal({ name: "  ", targetAmount: 100 })).success).toBe(false);
    expect(prisma.goal.create).not.toHaveBeenCalled();
  });

  it("rejects a zero / negative target", async () => {
    signIn();
    expect((await createGoal({ name: "X", targetAmount: 0 })).success).toBe(false);
    expect((await createGoal({ name: "X", targetAmount: -5 })).success).toBe(false);
    expect(prisma.goal.create).not.toHaveBeenCalled();
  });

  it("rejects a target over GOAL_AMOUNT_MAX", async () => {
    signIn();
    expect((await createGoal({ name: "X", targetAmount: 1_000_001 })).success).toBe(false);
    expect(prisma.goal.create).not.toHaveBeenCalled();
  });
});

describe("updateGoal", () => {
  it("scopes the ownership lookup by userId and patches only provided fields", async () => {
    signIn("u1");
    vi.mocked(prisma.goal.findFirst).mockResolvedValue({ id: "g1" } as never);
    vi.mocked(prisma.goal.update).mockResolvedValue({ id: "g1" } as never);

    const res = await updateGoal("g1", { name: "New name" });
    expect(res.success).toBe(true);

    expect(vi.mocked(prisma.goal.findFirst).mock.calls[0][0].where).toEqual({ id: "g1", userId: "u1" });
    const data = vi.mocked(prisma.goal.update).mock.calls[0][0].data;
    expect(data).toEqual({ name: "New name" });
    expect(data).not.toHaveProperty("currentAmount");
    expect(data).not.toHaveProperty("isCompleted");
  });

  it("clears the target date when passed null", async () => {
    signIn();
    vi.mocked(prisma.goal.findFirst).mockResolvedValue({ id: "g1" } as never);
    vi.mocked(prisma.goal.update).mockResolvedValue({ id: "g1" } as never);

    await updateGoal("g1", { targetDate: null });
    expect(vi.mocked(prisma.goal.update).mock.calls[0][0].data).toEqual({ targetDate: null });
  });

  it("returns not found for a foreign/unknown id without updating", async () => {
    signIn();
    vi.mocked(prisma.goal.findFirst).mockResolvedValue(null as never);

    const res = await updateGoal("g1", { name: "X" });
    expect(res).toEqual({ success: false, error: "Goal not found." });
    expect(prisma.goal.update).not.toHaveBeenCalled();
  });
});

describe("completeGoal", () => {
  it("sets isCompleted true, scoped by userId, regardless of progress", async () => {
    signIn("u1");
    vi.mocked(prisma.goal.findFirst).mockResolvedValue({ id: "g1" } as never);
    vi.mocked(prisma.goal.update).mockResolvedValue({ id: "g1" } as never);

    const res = await completeGoal("g1");
    expect(res.success).toBe(true);
    expect(vi.mocked(prisma.goal.findFirst).mock.calls[0][0].where).toEqual({ id: "g1", userId: "u1" });
    expect(vi.mocked(prisma.goal.update).mock.calls[0][0].data).toEqual({ isCompleted: true });
  });

  it("returns not found for a foreign id", async () => {
    signIn();
    vi.mocked(prisma.goal.findFirst).mockResolvedValue(null as never);
    expect((await completeGoal("g1")).success).toBe(false);
    expect(prisma.goal.update).not.toHaveBeenCalled();
  });
});

describe("deleteGoal", () => {
  it("hard-deletes scoped by userId", async () => {
    signIn("u1");
    vi.mocked(prisma.goal.findFirst).mockResolvedValue({ id: "g1" } as never);
    vi.mocked(prisma.goal.delete).mockResolvedValue({ id: "g1" } as never);

    const res = await deleteGoal("g1");
    expect(res.success).toBe(true);
    expect(vi.mocked(prisma.goal.delete).mock.calls[0][0]).toEqual({ where: { id: "g1" } });
  });

  it("returns not found for a foreign id without deleting", async () => {
    signIn();
    vi.mocked(prisma.goal.findFirst).mockResolvedValue(null as never);
    expect((await deleteGoal("g1")).success).toBe(false);
    expect(prisma.goal.delete).not.toHaveBeenCalled();
  });
});

describe("addContribution", () => {
  it("creates the row and increments currentAmount in one transaction", async () => {
    signIn("u1");
    runTransactionsInline();
    vi.mocked(prisma.goal.findFirst).mockResolvedValue({ id: "g1" } as never);
    vi.mocked(prisma.goalContribution.create).mockResolvedValue({ id: "c1" } as never);
    vi.mocked(prisma.goal.update).mockResolvedValue({ id: "g1" } as never);

    const res = await addContribution({ goalId: "g1", amount: 250, date: "2026-06-20", note: "bonus" });
    expect(res.success).toBe(true);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.goalContribution.create).mock.calls[0][0].data).toMatchObject({
      goalId: "g1",
      amount: 250,
      note: "bonus",
    });
    expect(vi.mocked(prisma.goal.update).mock.calls[0][0].data).toEqual({
      currentAmount: { increment: 250 },
    });
  });

  it("accepts a negative amount (withdrawal) and increments by the negative value", async () => {
    signIn();
    runTransactionsInline();
    vi.mocked(prisma.goal.findFirst).mockResolvedValue({ id: "g1" } as never);
    vi.mocked(prisma.goalContribution.create).mockResolvedValue({ id: "c1" } as never);
    vi.mocked(prisma.goal.update).mockResolvedValue({ id: "g1" } as never);

    const res = await addContribution({ goalId: "g1", amount: -80, date: "2026-06-20" });
    expect(res.success).toBe(true);
    expect(vi.mocked(prisma.goal.update).mock.calls[0][0].data).toEqual({
      currentAmount: { increment: -80 },
    });
  });

  it("rejects a zero amount with no write", async () => {
    signIn();
    runTransactionsInline();
    const res = await addContribution({ goalId: "g1", amount: 0, date: "2026-06-20" });
    expect(res.success).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rolls back (no contribution) when the goal is foreign/missing", async () => {
    signIn();
    runTransactionsInline();
    vi.mocked(prisma.goal.findFirst).mockResolvedValue(null as never);

    const res = await addContribution({ goalId: "g1", amount: 50, date: "2026-06-20" });
    expect(res).toEqual({ success: false, error: "Goal not found." });
    expect(prisma.goalContribution.create).not.toHaveBeenCalled();
    expect(prisma.goal.update).not.toHaveBeenCalled();
  });
});

describe("deleteContribution", () => {
  it("decrements by the STORED row amount (not a caller value) in one transaction", async () => {
    signIn("u1");
    runTransactionsInline();
    vi.mocked(prisma.goalContribution.findFirst).mockResolvedValue({
      id: "c1",
      amount: 175,
      goalId: "g1",
    } as never);
    vi.mocked(prisma.goalContribution.delete).mockResolvedValue({ id: "c1" } as never);
    vi.mocked(prisma.goal.update).mockResolvedValue({ id: "g1" } as never);

    const res = await deleteContribution("c1");
    expect(res.success).toBe(true);

    // ownership enforced via the parent goal's userId
    expect(vi.mocked(prisma.goalContribution.findFirst).mock.calls[0][0].where).toEqual({
      id: "c1",
      goal: { userId: "u1" },
    });
    expect(vi.mocked(prisma.goalContribution.delete).mock.calls[0][0]).toEqual({ where: { id: "c1" } });
    expect(vi.mocked(prisma.goal.update).mock.calls[0][0].data).toEqual({
      currentAmount: { decrement: 175 },
    });
  });

  it("returns not found for a foreign id without deleting", async () => {
    signIn();
    runTransactionsInline();
    vi.mocked(prisma.goalContribution.findFirst).mockResolvedValue(null as never);

    const res = await deleteContribution("c1");
    expect(res).toEqual({ success: false, error: "Contribution not found." });
    expect(prisma.goalContribution.delete).not.toHaveBeenCalled();
    expect(prisma.goal.update).not.toHaveBeenCalled();
  });
});

describe("getGoalForEdit", () => {
  it("proxies the fetcher and wraps a hit in { success, data }", async () => {
    signIn("u1");
    vi.mocked(getGoalForEditQuery).mockResolvedValue({
      id: "g1",
      name: "Trip",
      targetAmount: 1000,
      targetDate: null,
    });

    const res = await getGoalForEdit("g1");
    expect(res.success).toBe(true);
    expect(res.data?.id).toBe("g1");
    expect(getGoalForEditQuery).toHaveBeenCalledWith("u1", "g1");
  });

  it("returns not found when the fetcher returns null", async () => {
    signIn();
    vi.mocked(getGoalForEditQuery).mockResolvedValue(null);
    expect((await getGoalForEdit("g1")).success).toBe(false);
  });
});
