import { describe, it, expect } from "vitest";
import {
  advanceNextOccurrence,
  formatCadence,
  isDraftOverdue,
  mapTemplateRow,
  mapDraftRow,
} from "@/lib/recurring";

/** Build a UTC-midnight date from a "YYYY-MM-DD" string. */
function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

describe("advanceNextOccurrence", () => {
  it("DAILY advances by exactly one day (incl. month-end rollover)", () => {
    expect(advanceNextOccurrence(d("2026-06-16"), "DAILY")).toEqual(d("2026-06-17"));
    expect(advanceNextOccurrence(d("2026-01-31"), "DAILY")).toEqual(d("2026-02-01"));
  });

  it("WEEKLY advances by seven days", () => {
    expect(advanceNextOccurrence(d("2026-06-16"), "WEEKLY")).toEqual(d("2026-06-23"));
    expect(advanceNextOccurrence(d("2026-06-28"), "WEEKLY")).toEqual(d("2026-07-05"));
  });

  it("MONTHLY advances by one calendar month, clamping to the last valid day", () => {
    expect(advanceNextOccurrence(d("2026-06-20"), "MONTHLY")).toEqual(d("2026-07-20"));
    // Jan 31 -> Feb 28 (2026 is not a leap year), not Mar 3.
    expect(advanceNextOccurrence(d("2026-01-31"), "MONTHLY")).toEqual(d("2026-02-28"));
    // Jan 31 -> Feb 29 in a leap year.
    expect(advanceNextOccurrence(d("2028-01-31"), "MONTHLY")).toEqual(d("2028-02-29"));
    // Dec 31 -> Jan 31 next year (year wrap).
    expect(advanceNextOccurrence(d("2026-12-31"), "MONTHLY")).toEqual(d("2027-01-31"));
  });

  it("YEARLY advances by one year, clamping Feb 29 -> Feb 28 in a non-leap year", () => {
    expect(advanceNextOccurrence(d("2026-06-16"), "YEARLY")).toEqual(d("2027-06-16"));
    expect(advanceNextOccurrence(d("2028-02-29"), "YEARLY")).toEqual(d("2029-02-28"));
  });

  it("does not mutate the input date", () => {
    const original = d("2026-06-16");
    const copy = new Date(original);
    advanceNextOccurrence(original, "MONTHLY");
    expect(original).toEqual(copy);
  });
});

describe("formatCadence", () => {
  it("returns the human-readable label for each enum value", () => {
    expect(formatCadence("DAILY")).toBe("Daily");
    expect(formatCadence("WEEKLY")).toBe("Weekly");
    expect(formatCadence("MONTHLY")).toBe("Monthly");
    expect(formatCadence("YEARLY")).toBe("Yearly");
  });
});

describe("isDraftOverdue", () => {
  const now = new Date("2026-06-16T09:30:00.000Z");

  it("is true when suggestedDate is strictly before today (UTC)", () => {
    expect(isDraftOverdue(d("2026-06-15"), now)).toBe(true);
    expect(isDraftOverdue(d("2026-05-01"), now)).toBe(true);
  });

  it("is false for a draft due today — today is the due date, not overdue", () => {
    expect(isDraftOverdue(d("2026-06-16"), now)).toBe(false);
  });

  it("is false for a future draft", () => {
    expect(isDraftOverdue(d("2026-06-17"), now)).toBe(false);
  });
});

describe("mapTemplateRow", () => {
  it("maps a Prisma template (+account, +category) to a serializable row", () => {
    const row = mapTemplateRow({
      id: "t1",
      name: "Netflix",
      type: "EXPENSE",
      amount: "12.99",
      currency: "USD",
      cadence: "MONTHLY",
      nextOccurrence: d("2026-06-20"),
      isActive: true,
      financialAccount: { name: "Checking" },
      category: { id: "c1", name: "Subscriptions", icon: "Tv", color: "#378ADD" },
    });
    expect(row).toEqual({
      id: "t1",
      name: "Netflix",
      type: "EXPENSE",
      amount: 12.99,
      currency: "USD",
      cadence: "MONTHLY",
      nextOccurrence: d("2026-06-20"),
      isActive: true,
      accountName: "Checking",
      category: { id: "c1", name: "Subscriptions", icon: "Tv", color: "#378ADD" },
    });
  });

  it("preserves a null category", () => {
    const row = mapTemplateRow({
      id: "t2",
      name: "Salary",
      type: "INCOME",
      amount: 3000,
      currency: "USD",
      cadence: "MONTHLY",
      nextOccurrence: d("2026-07-01"),
      isActive: true,
      financialAccount: { name: "Checking" },
      category: null,
    });
    expect(row.category).toBeNull();
    expect(row.amount).toBe(3000);
  });
});

describe("mapDraftRow", () => {
  it("flattens a Prisma pending draft (+template) to a serializable row", () => {
    const row = mapDraftRow({
      id: "dr1",
      suggestedDate: d("2026-06-16"),
      suggestedAmount: "12.99",
      recurringTemplate: {
        id: "t1",
        name: "Netflix",
        type: "EXPENSE",
        currency: "USD",
        financialAccount: { name: "Checking" },
        category: { id: "c1", name: "Subscriptions", icon: "Tv", color: "#378ADD" },
      },
    });
    expect(row).toEqual({
      id: "dr1",
      suggestedDate: d("2026-06-16"),
      suggestedAmount: 12.99,
      templateId: "t1",
      templateName: "Netflix",
      type: "EXPENSE",
      currency: "USD",
      accountName: "Checking",
      category: { id: "c1", name: "Subscriptions", icon: "Tv", color: "#378ADD" },
    });
  });
});
