import { describe, it, expect } from "vitest";
import { buildNotificationItems } from "@/lib/notifications";
import { NOTIFICATION_GROUP_MAX } from "@/lib/constants";
import type { NotificationKind } from "@/types/notifications";

/** A UTC calendar date for draft suggestedDate inputs. */
function d(year: number, month1: number, day: number): Date {
  return new Date(Date.UTC(year, month1 - 1, day));
}

const EMPTY = { budgets: [], drafts: [], goals: [] } as const;

describe("buildNotificationItems", () => {
  it("returns an empty payload for empty input", () => {
    const payload = buildNotificationItems(EMPTY);
    expect(payload.items).toEqual([]);
    expect(payload.counts).toEqual({
      "budget-over": 0,
      "budget-risk": 0,
      draft: 0,
      "goal-overdue": 0,
    });
    expect(payload.totalCount).toBe(0);
  });

  it("orders kinds over → risk → draft → goal", () => {
    const payload = buildNotificationItems({
      budgets: [
        { id: "over1", name: "Rent", spent: 200, limit: 100, carriedAmount: 0 },
        { id: "risk1", name: "Food", spent: 90, limit: 100, carriedAmount: 0 },
      ],
      drafts: [{ id: "dr1", templateName: "Netflix", suggestedDate: d(2026, 6, 28) }],
      goals: [{ id: "g1", name: "Japan", overdue: true }],
    });
    expect(payload.items.map((i) => i.kind)).toEqual([
      "budget-over",
      "budget-risk",
      "draft",
      "goal-overdue",
    ]);
  });

  it("sorts over budgets worst-first (magnitude desc)", () => {
    const payload = buildNotificationItems({
      ...EMPTY,
      budgets: [
        { id: "mild", name: "Mild", spent: 150, limit: 100, carriedAmount: 0 },
        { id: "worst", name: "Worst", spent: 300, limit: 100, carriedAmount: 0 },
      ],
    });
    expect(payload.items.map((i) => i.id)).toEqual([
      "budget-over:worst",
      "budget-over:mild",
    ]);
  });

  it("sorts at-risk budgets by percent desc", () => {
    const payload = buildNotificationItems({
      ...EMPTY,
      budgets: [
        { id: "low", name: "Low", spent: 82, limit: 100, carriedAmount: 0 },
        { id: "high", name: "High", spent: 95, limit: 100, carriedAmount: 0 },
      ],
    });
    expect(payload.items.map((i) => i.id)).toEqual([
      "budget-risk:high",
      "budget-risk:low",
    ]);
  });

  it("sorts drafts by suggestedDate asc (most overdue first)", () => {
    const payload = buildNotificationItems({
      ...EMPTY,
      drafts: [
        { id: "newer", templateName: "B", suggestedDate: d(2026, 6, 20) },
        { id: "older", templateName: "A", suggestedDate: d(2026, 6, 1) },
      ],
    });
    expect(payload.items.map((i) => i.id)).toEqual([
      "draft:older",
      "draft:newer",
    ]);
  });

  it("sorts overdue goals by name asc and drops non-overdue goals", () => {
    const payload = buildNotificationItems({
      ...EMPTY,
      goals: [
        { id: "z", name: "Zeta", overdue: true },
        { id: "a", name: "Alpha", overdue: true },
        { id: "safe", name: "Beta", overdue: false },
      ],
    });
    expect(payload.items.map((i) => i.id)).toEqual([
      "goal-overdue:a",
      "goal-overdue:z",
    ]);
    expect(payload.counts["goal-overdue"]).toBe(2);
  });

  it("builds the exact label copy per kind", () => {
    const payload = buildNotificationItems({
      budgets: [
        { id: "o", name: "Rent", spent: 120, limit: 100, carriedAmount: 0 },
        { id: "r", name: "Groceries", spent: 92, limit: 100, carriedAmount: 0 },
      ],
      drafts: [{ id: "dr", templateName: "Netflix", suggestedDate: d(2026, 6, 28) }],
      goals: [{ id: "g", name: "Japan Trip", overdue: true }],
    });
    const byKind = Object.fromEntries(
      payload.items.map((i) => [i.kind, i])
    ) as Record<NotificationKind, (typeof payload.items)[number]>;
    expect(byKind["budget-over"].label).toBe("Rent budget is over the limit");
    expect(byKind["budget-risk"].label).toBe("Groceries budget at 92%");
    expect(byKind.draft.label).toBe("Netflix — draft pending");
    expect(byKind.draft.detail).toBe("Jun 28");
    expect(byKind["goal-overdue"].label).toBe(
      "Japan Trip goal is past its target date"
    );
  });

  it("rounds the at-risk percent to the nearest integer", () => {
    const payload = buildNotificationItems({
      ...EMPTY,
      // 92.6% → 93
      budgets: [{ id: "r", name: "X", spent: 92.6, limit: 100, carriedAmount: 0 }],
    });
    expect(payload.items[0].label).toBe("X budget at 93%");
  });

  it("caps each kind at NOTIFICATION_GROUP_MAX with a flagged overflow row", () => {
    const risks = Array.from({ length: NOTIFICATION_GROUP_MAX + 2 }, (_, i) => ({
      id: `r${i}`,
      name: `Cat ${i}`,
      // strictly decreasing percent so order is deterministic, all in [80,100)
      spent: 99 - i,
      limit: 100,
      carriedAmount: 0,
    }));
    const payload = buildNotificationItems({ ...EMPTY, budgets: risks });

    // MAX real rows + 1 overflow row.
    expect(payload.items).toHaveLength(NOTIFICATION_GROUP_MAX + 1);
    const overflow = payload.items[payload.items.length - 1];
    expect(overflow.isOverflowRow).toBe(true);
    expect(overflow.kind).toBe("budget-risk");
    expect(overflow.href).toBe("/budgets");
    expect(overflow.label).toBe("+2 more");
    // The visible rows carry no overflow flag.
    expect(
      payload.items.slice(0, NOTIFICATION_GROUP_MAX).every((i) => !i.isOverflowRow)
    ).toBe(true);
  });

  it("emits no overflow row at exactly the cap", () => {
    const risks = Array.from({ length: NOTIFICATION_GROUP_MAX }, (_, i) => ({
      id: `r${i}`,
      name: `Cat ${i}`,
      spent: 99 - i,
      limit: 100,
      carriedAmount: 0,
    }));
    const payload = buildNotificationItems({ ...EMPTY, budgets: risks });
    expect(payload.items).toHaveLength(NOTIFICATION_GROUP_MAX);
    expect(payload.items.some((i) => i.isOverflowRow)).toBe(false);
    expect(payload.counts["budget-risk"]).toBe(NOTIFICATION_GROUP_MAX);
  });

  it("counts are PRE-cap entity counts; overflow rows are never counted; totalCount === sum(counts)", () => {
    const risks = Array.from({ length: NOTIFICATION_GROUP_MAX + 3 }, (_, i) => ({
      id: `r${i}`,
      name: `Cat ${i}`,
      spent: 99 - i,
      limit: 100,
      carriedAmount: 0,
    }));
    const payload = buildNotificationItems({
      budgets: [
        { id: "o", name: "Over", spent: 120, limit: 100, carriedAmount: 0 },
        ...risks,
      ],
      drafts: [{ id: "dr", templateName: "N", suggestedDate: d(2026, 6, 1) }],
      goals: [{ id: "g", name: "G", overdue: true }],
    });

    expect(payload.counts).toEqual({
      "budget-over": 1,
      "budget-risk": NOTIFICATION_GROUP_MAX + 3,
      draft: 1,
      "goal-overdue": 1,
    });

    const sum = Object.values(payload.counts).reduce((a, b) => a + b, 0);
    expect(payload.totalCount).toBe(sum);

    // No overflow row is included in any count — verify by summing rendered
    // non-overflow rows of each kind against a capped expectation.
    const renderedRisk = payload.items.filter(
      (i) => i.kind === "budget-risk" && !i.isOverflowRow
    ).length;
    expect(renderedRisk).toBe(NOTIFICATION_GROUP_MAX);
    // but the count still reflects the true pre-cap total
    expect(payload.counts["budget-risk"]).toBe(NOTIFICATION_GROUP_MAX + 3);
  });

  it("assigns tone and href per kind", () => {
    const payload = buildNotificationItems({
      budgets: [
        { id: "o", name: "O", spent: 120, limit: 100, carriedAmount: 0 },
        { id: "r", name: "R", spent: 90, limit: 100, carriedAmount: 0 },
      ],
      drafts: [{ id: "dr", templateName: "N", suggestedDate: d(2026, 6, 1) }],
      goals: [{ id: "g", name: "G", overdue: true }],
    });
    const byKind = Object.fromEntries(
      payload.items.map((i) => [i.kind, { tone: i.tone, href: i.href }])
    );
    expect(byKind["budget-over"]).toEqual({ tone: "danger", href: "/budgets" });
    expect(byKind["budget-risk"]).toEqual({ tone: "warning", href: "/budgets" });
    expect(byKind.draft).toEqual({ tone: "info", href: "/recurring" });
    expect(byKind["goal-overdue"]).toEqual({ tone: "warning", href: "/goals" });
  });
});
