import { describe, it, expect } from "vitest";
import { parseImportEnvelope } from "@/lib/import/json";

function envelope(
  transactions: unknown[],
  schemaVersion = 1,
  tags: unknown[] = []
): string {
  return JSON.stringify({
    schemaVersion,
    exportedAt: "2026-06-28T00:00:00.000Z",
    data: { transactions, tags },
  });
}

describe("parseImportEnvelope", () => {
  it("parses a valid v1 envelope into normalized rows", () => {
    const text = envelope([
      {
        date: "2026-03-04",
        amount: -12.5,
        type: "EXPENSE",
        category: "Dining",
        merchant: "Pret",
        note: "lunch",
      },
    ]);
    const res = parseImportEnvelope(text);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]).toMatchObject({ amount: 12.5, type: "EXPENSE" });
    }
  });

  it("rejects a higher schemaVersion with the newer-version message", () => {
    const res = parseImportEnvelope(envelope([{ date: "x", amount: 1, type: "INCOME" }], 4));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("bad_envelope");
      expect(res.message).toMatch(/newer version/i);
    }
  });

  it("accepts a v2 envelope", () => {
    const res = parseImportEnvelope(
      envelope([{ date: "2026-06-15", amount: 10, type: "EXPENSE" }], 2)
    );
    expect(res.ok).toBe(true);
  });

  it("accepts a v3 envelope with splits, tags, and a registry", () => {
    const res = parseImportEnvelope(
      envelope(
        [
          {
            date: "2026-06-15",
            amount: -10,
            type: "EXPENSE",
            splits: [
              { categoryId: "c1", category: "Groceries", amount: 6, note: "food" },
              { categoryId: "c2", category: "Home", amount: 4, note: null },
            ],
            tags: ["Trip", "trip", "Receipt"],
          },
        ],
        3,
        [
          { id: "t1", name: "Trip", color: "#378ADD" },
          { id: "t2", name: "Bad", color: "blue" },
        ]
      )
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rows[0].splits).toHaveLength(2);
      expect(res.rows[0].tags).toEqual(["Trip", "Receipt"]);
      expect(res.tagRegistry).toEqual([
        { name: "Trip", color: "#378ADD" },
        { name: "Bad", color: null },
      ]);
    }
  });

  it("ignores unknown extra fields on the envelope and on a transaction (forward-compat)", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      futureKey: "ignored",
      data: {
        transactions: [
          { date: "2026-03-04", amount: 5, type: "INCOME", futureField: 42 },
        ],
        budgets: [{ anything: true }],
      },
    });
    const res = parseImportEnvelope(text);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rows).toHaveLength(1);
  });

  it("returns an unreadable error for invalid JSON syntax", () => {
    const res = parseImportEnvelope("{ not json ");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("unreadable");
  });

  it("returns an empty error (distinct from unreadable) for transactions: []", () => {
    const res = parseImportEnvelope(envelope([]));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("empty");
      expect(res.message).toMatch(/no transactions/i);
    }
  });

  it("returns a bad_envelope error for a shape that isn't an export", () => {
    const res = parseImportEnvelope(JSON.stringify({ hello: "world" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("bad_envelope");
  });

  it("keeps a row missing a required field (it becomes invalid downstream, not a whole-file reject)", () => {
    const text = envelope([
      { date: "2026-03-04", amount: 5, type: "INCOME" }, // complete
      { date: "2026-03-05", amount: -15, merchant: "No Type Co" }, // missing type
    ]);
    const res = parseImportEnvelope(text);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rows).toHaveLength(2);
      expect(res.rows[1].type).toBeNull(); // → invalid row in the action, not a structural error
    }
  });

  it("normalizes a TRANSFER row (flagged/skipped downstream, not here)", () => {
    const res = parseImportEnvelope(
      envelope([{ date: "2026-03-04", amount: 50, type: "TRANSFER" }])
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rows[0].type).toBe("TRANSFER");
  });
});
