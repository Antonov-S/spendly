import { describe, expect, it } from "vitest";
import {
  EXPORT_JSON_SCHEMA_VERSION,
  SPLIT_MAX_LINES,
  TAG_MAX_PER_TRANSACTION,
} from "@/lib/system-constants";
import { parseImportEnvelope } from "@/lib/import/json";
import { acceptSplits } from "@/lib/import/split-gate";
import {
  buildCategoryIdSet,
  buildCategoryIndex,
  buildTagIndex,
  resolveCategory,
  resolveSplitCategory,
  resolveTag,
} from "@/lib/import/resolve";
import { partitionForWrite } from "@/lib/import/dedup";
import { normalizeLabelKey } from "@/lib/text";
import type { ExportEnvelope, FullExport } from "@/types/export";
import type { NormalizedImportRow, ResolvedImportSplit, ResolvedRow } from "@/types/import";

const fixture = {
  schemaVersion: EXPORT_JSON_SCHEMA_VERSION,
  exportedAt: "2026-07-07T00:00:00.000Z",
  data: {
    accounts: [],
    categories: [],
    budgets: [],
    goals: [],
    recurringTemplates: [],
    tags: [
      { id: "tag-trip", name: "Trip", color: "#378ADD", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "tag-receipt", name: "Receipt", color: null, createdAt: "2026-01-01T00:00:00.000Z" },
      ...Array.from({ length: TAG_MAX_PER_TRANSACTION }, (_, i) => ({
        id: `tag-cap-${i}`,
        name: `Cap ${i}`,
        color: i % 2 === 0 ? "#1D9E75" : null,
        createdAt: "2026-01-01T00:00:00.000Z",
      })),
    ],
    transactions: [
      {
        id: "tx-split",
        date: "2026-06-15",
        amount: -80,
        type: "EXPENSE",
        category: null,
        account: "Checking",
        merchant: "Market",
        note: "weekly",
        isTransferLeg: false,
        transferPairId: null,
        financialAccountId: "acc",
        categoryId: null,
        recurringTemplateId: null,
        isSplit: true,
        splits: [
          { categoryId: "cat-food", category: "Food", amount: 55, note: "groceries" },
          { categoryId: "cat-home", category: "Home", amount: 20, note: null },
          { categoryId: null, category: null, amount: 5, note: "unknown" },
        ],
        tags: ["Trip"],
        createdAt: "2026-06-15T10:00:00.000Z",
      },
      {
        id: "tx-income",
        date: "2026-06-16",
        amount: 100,
        type: "INCOME",
        category: "Salary",
        account: "Checking",
        merchant: "Client",
        note: null,
        isTransferLeg: false,
        transferPairId: null,
        financialAccountId: "acc",
        categoryId: "cat-salary",
        recurringTemplateId: null,
        isSplit: false,
        splits: [],
        tags: ["Receipt"],
        createdAt: "2026-06-16T10:00:00.000Z",
      },
      {
        id: "tx-at-caps",
        date: "2026-06-17",
        amount: -20,
        type: "EXPENSE",
        category: null,
        account: "Checking",
        merchant: "Caps",
        note: "maxed",
        isTransferLeg: false,
        transferPairId: null,
        financialAccountId: "acc",
        categoryId: null,
        recurringTemplateId: null,
        isSplit: true,
        splits: Array.from({ length: SPLIT_MAX_LINES }, (_, i) => ({
          categoryId: `cat-cap-${i}`,
          category: `Cap ${i}`,
          amount: 1,
          note: i === 0 ? "first" : null,
        })),
        tags: Array.from({ length: TAG_MAX_PER_TRANSACTION }, (_, i) => `Cap ${i}`),
        createdAt: "2026-06-17T10:00:00.000Z",
      },
      {
        id: "tx-v2-id-fallback",
        date: "2026-06-18",
        amount: -30,
        type: "EXPENSE",
        category: null,
        account: "Checking",
        merchant: "Renamed",
        note: null,
        isTransferLeg: false,
        transferPairId: null,
        financialAccountId: "acc",
        categoryId: null,
        recurringTemplateId: null,
        isSplit: true,
        splits: [
          { categoryId: "cat-old", category: null, amount: 10, note: null },
          { categoryId: "cat-food", category: "Food", amount: 20, note: null },
        ],
        tags: [],
        createdAt: "2026-06-18T10:00:00.000Z",
      },
      {
        id: "tx-v3-renamed-id-fallback",
        date: "2026-06-19",
        amount: -18,
        type: "EXPENSE",
        category: null,
        account: "Checking",
        merchant: "Renamed V3",
        note: null,
        isTransferLeg: false,
        transferPairId: null,
        financialAccountId: "acc",
        categoryId: null,
        recurringTemplateId: null,
        isSplit: true,
        splits: [
          {
            categoryId: "cat-renamed",
            category: "Old Exported Name",
            amount: 8,
            note: null,
          },
          { categoryId: "cat-home", category: "Home", amount: 10, note: null },
        ],
        tags: [],
        createdAt: "2026-06-19T10:00:00.000Z",
      },
      {
        id: "tx-transfer",
        date: "2026-06-20",
        amount: -25,
        type: "TRANSFER",
        category: null,
        account: "Checking",
        merchant: null,
        note: null,
        isTransferLeg: true,
        transferPairId: "pair",
        financialAccountId: "acc",
        categoryId: null,
        recurringTemplateId: null,
        isSplit: false,
        splits: [],
        tags: [],
        createdAt: "2026-06-20T10:00:00.000Z",
      },
      {
        id: "tx-plain",
        date: "2026-06-21",
        amount: -12,
        type: "EXPENSE",
        category: null,
        account: "Checking",
        merchant: "Cash",
        note: null,
        isTransferLeg: false,
        transferPairId: null,
        financialAccountId: "acc",
        categoryId: null,
        recurringTemplateId: null,
        isSplit: false,
        splits: [],
        tags: [],
        createdAt: "2026-06-21T10:00:00.000Z",
      },
    ],
  },
} satisfies ExportEnvelope<FullExport>;

function resolveRows(rows: NormalizedImportRow[]): ResolvedRow[] {
  const categories = [
    { id: "cat-food", name: "Food" },
    { id: "cat-home", name: "Home" },
    { id: "cat-old", name: "Old Name" },
    { id: "cat-renamed", name: "Current Name" },
    { id: "cat-salary", name: "Salary" },
    ...Array.from({ length: SPLIT_MAX_LINES }, (_, i) => ({
      id: `cat-cap-${i}`,
      name: `Cap ${i}`,
    })),
  ];
  const index = buildCategoryIndex(categories);
  const ids = buildCategoryIdSet(categories);
  const tags = [{ id: "tag-trip", name: "Trip" }];
  const tagIndex = buildTagIndex(tags);
  const resolved: ResolvedRow[] = [];

  for (const row of rows) {
    if (row.type === "TRANSFER" || row.date === null || row.amount === null || row.type === null) {
      continue;
    }
    const category = resolveCategory(row.categoryText, index, "CREATE");
    const splitGate = acceptSplits(
      row as NormalizedImportRow & {
        amount: number;
        type: "INCOME" | "EXPENSE";
      }
    );
    const splits: ResolvedImportSplit[] = splitGate.ok
      ? splitGate.splits.map((split) => ({
          ...resolveSplitCategory(split, index, ids, "CREATE"),
          amount: split.amount,
          note: split.note,
        }))
      : [];
    const tagIds: string[] = [];
    const createTagNames: string[] = [];
    for (const tagName of row.tags) {
      const tag = resolveTag(tagName, tagIndex);
      if (tag.tagId !== null) tagIds.push(tag.tagId);
      else createTagNames.push(tag.createName);
    }
    resolved.push({
      source: row.source,
      date: row.date,
      amount: row.amount,
      type: row.type,
      merchant: row.merchant,
      note: row.note,
      categoryId:
        splits.length > 0 ? null : "categoryId" in category ? category.categoryId : null,
      createCategoryName:
        splits.length > 0 ? null : "createName" in category ? category.createName : null,
      splits,
      tagIds,
      createTagNames,
    });
  }

  return resolved;
}

describe("JSON export -> import round-trip fixture", () => {
  it("preserves split attribution and tag associations for rows that will be created", () => {
    const parsed = parseImportEnvelope(JSON.stringify(fixture));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const resolved = resolveRows(parsed.rows);
    const { toCreate, duplicatesSkipped } = partitionForWrite(resolved, new Map(), true);

    expect(duplicatesSkipped).toBe(0);
    expect(parsed.rows[5]).toMatchObject({ source: 6, type: "TRANSFER" });
    expect(resolved.some((r) => r.source === 6)).toBe(false);
    expect(toCreate).toHaveLength(6);

    const split = toCreate.find((r) => r.source === 1);
    expect(split?.splits).toEqual([
      { categoryId: "cat-food", createCategoryName: null, amount: 55, note: "groceries" },
      { categoryId: "cat-home", createCategoryName: null, amount: 20, note: null },
      { categoryId: null, createCategoryName: null, amount: 5, note: "unknown" },
    ]);
    expect(split?.tagIds).toEqual(["tag-trip"]);

    const taggedIncome = toCreate.find((r) => r.source === 2);
    expect(taggedIncome?.createTagNames).toEqual(["Receipt"]);
    const registryColor = new Map(
      parsed.tagRegistry.map((tag) => [normalizeLabelKey(tag.name), tag.color])
    );
    expect(registryColor.get("receipt")).toBeNull();

    const caps = toCreate.find((r) => r.source === 3);
    expect(caps?.splits).toHaveLength(SPLIT_MAX_LINES);
    expect(caps?.splits[0]).toEqual({
      categoryId: "cat-cap-0",
      createCategoryName: null,
      amount: 1,
      note: "first",
    });
    expect(caps?.createTagNames).toEqual(
      Array.from({ length: TAG_MAX_PER_TRANSACTION }, (_, i) => `Cap ${i}`)
    );

    const idFallback = toCreate.find((r) => r.source === 4);
    expect(idFallback?.splits.map((s) => s.categoryId)).toEqual([
      "cat-old",
      "cat-food",
    ]);

    const renamedFallback = toCreate.find((r) => r.source === 5);
    expect(renamedFallback?.splits.map((s) => s.categoryId)).toEqual([
      "cat-renamed",
      "cat-home",
    ]);
    expect(renamedFallback?.splits[0].createCategoryName).toBeNull();

    const plain = toCreate.find((r) => r.source === 7);
    expect(plain?.splits).toEqual([]);
    expect(plain?.tagIds).toEqual([]);
    expect(plain?.createTagNames).toEqual([]);
  });
});
