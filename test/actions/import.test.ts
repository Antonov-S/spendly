import { describe, it, expect, vi, beforeEach } from "vitest";
import { inspectCsv, previewImport, commitImport } from "@/actions/import";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { getImportTargets, countExistingForDedup } from "@/lib/db/import";
import { IMPORT_MAX_ROWS } from "@/lib/system-constants";
import type { ImportOptions } from "@/types/import";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/revalidation", () => ({
  revalidateTransactionViews: vi.fn(),
  revalidateCategoryViews: vi.fn(),
}));
vi.mock("@/lib/db/import", () => ({
  getImportTargets: vi.fn(),
  countExistingForDedup: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    financialAccount: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const mockAuth = vi.mocked(auth);
const mockRateLimit = vi.mocked(checkRateLimit);
const mockTargets = vi.mocked(getImportTargets);
const mockExisting = vi.mocked(countExistingForDedup);
const accountFindFirst = vi.mocked(prisma.financialAccount.findFirst);
const txn = vi.mocked(prisma.$transaction);

const CSV_HEADER = "Date,Amount,Type,Category,Merchant,Note";
const CSV_MAPPING = {
  date: 0,
  amount: 1,
  type: 2,
  category: 3,
  merchant: 4,
  note: 5,
};

const csvOpts: ImportOptions = {
  format: "csv",
  accountId: "a1",
  categoryResolution: "CREATE",
  skipDuplicates: true,
  mapping: CSV_MAPPING,
  dateFormat: "YYYY-MM-DD",
  decimal: ".",
};

function fd(text: string, name = "x.csv"): FormData {
  const form = new FormData();
  form.append("file", new File([text], name));
  return form;
}

/** Tracks tx.transaction.createMany calls so we can assert the written rows. */
let txCreateMany: ReturnType<typeof vi.fn>;
let catCreateMany: ReturnType<typeof vi.fn>;

/** Wire `$transaction` to run the callback against a tx mock; categories re-query
 * returns the system seed plus any created names. */
function wireWrite(freshCats: { id: string; name: string }[]) {
  catCreateMany = vi.fn(async ({ data }: { data: unknown[] }) => ({
    count: data.length,
  }));
  txCreateMany = vi.fn(async ({ data }: { data: unknown[] }) => ({
    count: data.length,
  }));
  const tx = {
    category: {
      createMany: catCreateMany,
      findMany: vi.fn(async () => freshCats),
    },
    transaction: { createMany: txCreateMany },
  };
  txn.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
  mockRateLimit.mockResolvedValue({
    success: true,
    remaining: 10,
    reset: 0,
    retryAfterSeconds: 0,
  });
  accountFindFirst.mockResolvedValue({
    currency: "EUR",
    name: "Checking",
  } as never);
  mockTargets.mockResolvedValue({
    accounts: [{ id: "a1", name: "Checking" }],
    categories: [{ id: "sys-dining", name: "Dining" }],
  });
  mockExisting.mockResolvedValue(new Map());
  wireWrite([{ id: "sys-dining", name: "Dining" }]);
});

describe("authentication (S1)", () => {
  it("rejects all three actions when not signed in, with no write", async () => {
    mockAuth.mockResolvedValue(null as never);
    expect((await inspectCsv(fd(CSV_HEADER))).success).toBe(false);
    expect((await previewImport(fd(CSV_HEADER), csvOpts)).success).toBe(false);
    expect((await commitImport(fd(CSV_HEADER), csvOpts)).success).toBe(false);
    expect(txn).not.toHaveBeenCalled();
  });
});

describe("rate limiting (S3)", () => {
  it("short-circuits before any parsing or DB work", async () => {
    mockRateLimit.mockResolvedValue({
      success: false,
      remaining: 0,
      reset: 0,
      retryAfterSeconds: 30,
    });
    const res = await previewImport(fd(CSV_HEADER), csvOpts);
    expect(res.success).toBe(false);
    expect(mockTargets).not.toHaveBeenCalled();
    expect(accountFindFirst).not.toHaveBeenCalled();
  });
});

describe("target ownership (C1/S2)", () => {
  it("errors when the account is not owned/active", async () => {
    accountFindFirst.mockResolvedValue(null as never);
    const res = await commitImport(
      fd(`${CSV_HEADER}\n2026-03-04,5,INCOME,,,`),
      csvOpts
    );
    expect(res.success).toBe(false);
    expect(txn).not.toHaveBeenCalled();
  });
});

describe("previewImport is a dry run (D6)", () => {
  it("performs no write", async () => {
    const res = await previewImport(
      fd(`${CSV_HEADER}\n2026-03-04,12.50,EXPENSE,Dining,Pret,lunch`),
      csvOpts
    );
    expect(res.success).toBe(true);
    expect(txn).not.toHaveBeenCalled();
  });
});

describe("commitImport write (D2/D7)", () => {
  it("writes categories then transactions with signed amount + account currency", async () => {
    // "Coffee" is not in the index → created; "Dining" matches.
    wireWrite([
      { id: "sys-dining", name: "Dining" },
      { id: "new-coffee", name: "Coffee" },
    ]);
    const csv = [
      CSV_HEADER,
      "2026-03-04,12.50,EXPENSE,Dining,Pret,lunch",
      "2026-03-05,9,EXPENSE,Coffee,Cafe,",
    ].join("\n");

    const res = await commitImport(fd(csv), csvOpts);
    expect(res.success).toBe(true);

    expect(catCreateMany).toHaveBeenCalledTimes(1);
    const catArg = catCreateMany.mock.calls[0][0] as {
      data: { name: string; isSystem: boolean }[];
      skipDuplicates: boolean;
    };
    expect(catArg.data).toEqual([
      expect.objectContaining({ name: "Coffee", isSystem: false }),
    ]);

    const txArg = txCreateMany.mock.calls[0][0] as {
      data: {
        amount: number;
        currency: string;
        categoryId: string | null;
        type: string;
      }[];
    };
    expect(txArg.data).toHaveLength(2);
    expect(txArg.data[0]).toMatchObject({
      amount: -12.5, // EXPENSE → negative
      currency: "EUR", // from account, not file
      categoryId: "sys-dining",
      type: "EXPENSE",
    });
    expect(txArg.data[1].categoryId).toBe("new-coffee");

    if (res.success) {
      expect(res.data.created).toBe(2);
      expect(res.data.categoriesCreated).toBe(1);
    }
  });
});

describe("classification counts (D1/D5)", () => {
  it("counts transfers and invalid rows separately and imports the rest", async () => {
    const csv = [
      CSV_HEADER,
      "2026-03-04,10,EXPENSE,Dining,Pret,ok",
      "2026-03-04,50,TRANSFER,,,",
      "bad-date,xyz,EXPENSE,,,",
    ].join("\n");

    const res = await previewImport(fd(csv), csvOpts);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.totalRows).toBe(3);
      expect(res.data.toCreate).toBe(1);
      expect(res.data.transfersSkipped).toBe(1);
      expect(res.data.invalidSkipped).toBe(1);
    }
  });
});

describe("high-skip warning (T5)", () => {
  it("flips on at/above the ratio", async () => {
    const csv = [
      CSV_HEADER,
      "2026-03-04,10,EXPENSE,Dining,Pret,ok",
      "2026-03-04,1,TRANSFER,,,",
      "2026-03-04,2,TRANSFER,,,",
      "2026-03-04,3,TRANSFER,,,",
      "2026-03-04,4,TRANSFER,,,",
    ].join("\n");
    const res = await previewImport(fd(csv), csvOpts);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.highSkip).toBe(true); // 4/5 = 0.8
  });
});

describe("category create race-safety (§7.2)", () => {
  it("links to an existing id when createMany inserts zero rows", async () => {
    // createMany returns count 0 (parallel import already created it), but the
    // re-query still finds Coffee → the transaction links to it.
    catCreateMany = vi.fn(async () => ({ count: 0 }));
    txCreateMany = vi.fn(async ({ data }: { data: unknown[] }) => ({
      count: data.length,
    }));
    txn.mockImplementation(async (fn: (t: unknown) => unknown) =>
      fn({
        category: {
          createMany: catCreateMany,
          findMany: vi.fn(async () => [
            { id: "sys-dining", name: "Dining" },
            { id: "race-coffee", name: "Coffee" },
          ]),
        },
        transaction: { createMany: txCreateMany },
      })
    );

    const res = await commitImport(
      fd(`${CSV_HEADER}\n2026-03-05,9,EXPENSE,Coffee,Cafe,`),
      csvOpts
    );
    expect(res.success).toBe(true);
    const txArg = txCreateMany.mock.calls[0][0] as {
      data: { categoryId: string | null }[];
    };
    expect(txArg.data[0].categoryId).toBe("race-coffee");
    if (res.success) expect(res.data.created).toBe(1);
  });
});

describe("preview == commit (D6)", () => {
  const csv = [
    CSV_HEADER,
    "2026-03-04,10,EXPENSE,Dining,Pret,ok",
    "2026-03-05,20,INCOME,,,",
  ].join("\n");

  it("commit's created equals the preview's toCreate over unchanged state", async () => {
    const preview = await previewImport(fd(csv), csvOpts);
    expect(preview.success).toBe(true);
    const expected = preview.success ? preview.data.toCreate : -1;

    const commit = await commitImport(fd(csv), csvOpts, expected);
    expect(commit.success).toBe(true);
    if (commit.success) {
      expect(commit.data.created).toBe(expected);
      expect(commit.data.divergedFromPreview).toBe(false);
    }
  });

  it("flags divergence when the ledger gained a matching row between calls", async () => {
    const preview = await previewImport(fd(csv), csvOpts);
    const expected = preview.success ? preview.data.toCreate : -1;

    // A matching expense landed in the account between preview and commit.
    const { dedupKey } = await import("@/lib/import/dedup");
    const key = dedupKey({
      date: "2026-03-04",
      amount: -10,
      type: "EXPENSE",
      merchant: "Pret",
      note: "ok",
    });
    mockExisting.mockResolvedValue(new Map([[key, 1]]));

    const commit = await commitImport(fd(csv), csvOpts, expected);
    expect(commit.success).toBe(true);
    if (commit.success) {
      expect(commit.data.created).toBe(expected - 1); // one now deduped
      expect(commit.data.divergedFromPreview).toBe(true);
    }
  });
});

describe("distinct structural errors (D5)", () => {
  it("empty (header-only) file", async () => {
    const res = await previewImport(fd(`${CSV_HEADER}\n`), csvOpts);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/no transactions/i);
    expect(txn).not.toHaveBeenCalled();
  });

  it("unreadable JSON", async () => {
    const jsonOpts: ImportOptions = { ...csvOpts, format: "json", mapping: null };
    const res = await previewImport(fd("{ not json", "x.json"), jsonOpts);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/couldn't read/i);
  });

  it("over the row cap", async () => {
    const rows = Array(IMPORT_MAX_ROWS + 1)
      .fill("2026-03-04,1,INCOME,,,")
      .join("\n");
    const res = await previewImport(fd(`${CSV_HEADER}\n${rows}`), csvOpts);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/more than/i);
    expect(txn).not.toHaveBeenCalled();
  });

  it("bad JSON envelope (newer schemaVersion)", async () => {
    const jsonOpts: ImportOptions = { ...csvOpts, format: "json", mapping: null };
    const envelope = JSON.stringify({
      schemaVersion: 3,
      data: { transactions: [{ date: "2026-03-04", amount: 1, type: "INCOME" }] },
    });
    const res = await previewImport(fd(envelope, "x.json"), jsonOpts);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/newer version/i);
  });
});

describe("inspectCsv", () => {
  it("returns headers, suggested mapping, dialect, and row count", async () => {
    const csv = [CSV_HEADER, "2026-03-04,12.50,EXPENSE,Dining,Pret,lunch"].join(
      "\n"
    );
    const res = await inspectCsv(fd(csv));
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.headers).toEqual([
        "Date",
        "Amount",
        "Type",
        "Category",
        "Merchant",
        "Note",
      ]);
      expect(res.data.suggestedMapping.date).toBe(0);
      expect(res.data.suggestedMapping.amount).toBe(1);
      expect(res.data.dataRowCount).toBe(1);
      expect(res.data.dialect.dateFormat).toBe("YYYY-MM-DD");
    }
  });
});
