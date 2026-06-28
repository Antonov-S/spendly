import { describe, it, expect } from "vitest";
import { IMPORT_MAX_ROWS } from "@/lib/system-constants";
import { parseCsv } from "@/lib/import/csv";
import { normalizeCsvRow } from "@/lib/import/parse";
import { buildCategoryIndex, resolveCategory } from "@/lib/import/resolve";
import { partitionForWrite, dedupKey } from "@/lib/import/dedup";
import type { ImportMapping, ResolvedRow } from "@/types/import";

/**
 * Bound/complexity smoke (data-import-spec §10.4): the pure pipeline over the
 * configured row ceiling must complete well within a generous budget, and
 * `partitionForWrite` must stay map-based (no O(n²)) at the 10K boundary. Not a
 * benchmark — a correctness-of-complexity guard against a future refactor.
 */

const MAPPING: ImportMapping = {
  date: 0,
  amount: 1,
  type: 2,
  category: 3,
  merchant: 4,
  note: 5,
};

describe("pure pipeline at the row ceiling", () => {
  it(`runs ${IMPORT_MAX_ROWS} rows end-to-end within budget`, () => {
    const header = "Date,Amount,Type,Category,Merchant,Note\n";
    const lines: string[] = [];
    for (let i = 0; i < IMPORT_MAX_ROWS; i++) {
      // Vary date + amount so rows are mostly distinct (exercises the dedup map).
      const day = String((i % 28) + 1).padStart(2, "0");
      lines.push(`2026-03-${day},${(i % 500) + 0.5},EXPENSE,Dining,M${i},n`);
    }
    const text = header + lines.join("\n");

    const start = Date.now();

    const grid = parseCsv(text, ",");
    const [, ...data] = grid;
    expect(data).toHaveLength(IMPORT_MAX_ROWS);

    const index = buildCategoryIndex([{ id: "c-dining", name: "Dining" }]);
    const resolved: ResolvedRow[] = [];
    for (let i = 0; i < data.length; i++) {
      const row = normalizeCsvRow(data[i], MAPPING, "YYYY-MM-DD", ".", i + 1);
      if (row.date === null || row.amount === null || row.type === "TRANSFER") {
        continue;
      }
      const cat = resolveCategory(row.categoryText, index, "UNCATEGORIZED");
      resolved.push({
        source: row.source,
        date: row.date,
        amount: row.amount,
        type: row.type as "INCOME" | "EXPENSE",
        merchant: row.merchant,
        note: row.note,
        categoryId: "categoryId" in cat ? cat.categoryId : null,
        createCategoryName: null,
      });
    }

    const { toCreate } = partitionForWrite(resolved, new Map(), true);
    const elapsed = Date.now() - start;

    expect(resolved).toHaveLength(IMPORT_MAX_ROWS);
    expect(toCreate.length).toBeGreaterThan(0);
    // Generous ceiling — the pure pass should be well under a second.
    expect(elapsed).toBeLessThan(4000);
  });

  it("partitionForWrite is map-based: a fully-existing batch creates zero", () => {
    const rows: ResolvedRow[] = [];
    const existing = new Map<string, number>();
    for (let i = 0; i < 5000; i++) {
      const r: ResolvedRow = {
        source: i + 1,
        date: "2026-03-04",
        amount: i + 1,
        type: "EXPENSE",
        merchant: `M${i}`,
        note: null,
        categoryId: null,
        createCategoryName: null,
      };
      rows.push(r);
      const key = dedupKey({
        date: r.date,
        amount: -r.amount,
        type: r.type,
        merchant: r.merchant,
        note: r.note,
      });
      existing.set(key, 1);
    }

    const start = Date.now();
    const { toCreate, duplicatesSkipped } = partitionForWrite(rows, existing, true);
    const elapsed = Date.now() - start;

    expect(toCreate).toHaveLength(0);
    expect(duplicatesSkipped).toBe(5000);
    expect(elapsed).toBeLessThan(1000);
  });
});
