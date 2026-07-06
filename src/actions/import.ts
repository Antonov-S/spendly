"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { dateInputToUtc } from "@/lib/date";
import {
  revalidateTransactionViews,
  revalidateCategoryViews,
} from "@/lib/revalidation";
import { DEFAULT_CATEGORY_ICON, DEFAULT_CATEGORY_COLOR } from "@/lib/constants";
import {
  IMPORT_MAX_ROWS,
  IMPORT_MAX_FILE_BYTES,
  IMPORT_PREVIEW_SAMPLE_SIZE,
  IMPORT_MAX_ISSUES,
  IMPORT_HIGH_SKIP_RATIO,
} from "@/lib/system-constants";
import {
  stripBomAndSepHint,
  detectDelimiter,
  parseCsv,
  detectDialect,
} from "@/lib/import/csv";
import { suggestMapping } from "@/lib/import/mapping";
import { normalizeCsvRow } from "@/lib/import/parse";
import { parseImportEnvelope } from "@/lib/import/json";
import {
  buildCategoryIndex,
  resolveCategory,
  normalizeCatKey,
} from "@/lib/import/resolve";
import { partitionForWrite } from "@/lib/import/dedup";
import { getImportTargets, countExistingForDedup } from "@/lib/db/import";
import { track } from "@/lib/analytics/track";
import { bucketCount } from "@/lib/analytics/events";
import { importOptionsSchema } from "@/lib/validations/import";
import type {
  ActionResult,
  CsvInspection,
  ImportOptions,
  ImportPreview,
  ImportResult,
  ImportIssue,
  NormalizedImportRow,
  PreviewRow,
  ResolvedRow,
} from "@/types/import";

/**
 * Data Import Server Actions (data-import-spec §3.2). `inspectCsv` and
 * `previewImport` never write; `commitImport` writes atomically. Each: auth →
 * per-user rate-limit → bounded read → the shared pure pipeline → preview | write.
 * Tier-agnostic (no `isPro` read, S6).
 */

const NOT_AUTHED: ActionResult<never> = {
  success: false,
  error: "You must be signed in.",
};
const RATE_LIMITED: ActionResult<never> = {
  success: false,
  error: "Too many import attempts. Please wait a moment and try again.",
};

const EMPTY_MESSAGE = "This file has no transactions to import.";
const CSV_UNREADABLE = "We couldn't read this file — is it a valid CSV export?";
const FILE_TOO_LARGE = "This file is too large to import.";

const tooManyRowsMessage = (max: number) =>
  `This file has more than ${max.toLocaleString("en-US")} rows. Split it and import in parts.`;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Read + size-guard the uploaded file from FormData (S4). */
async function readUpload(
  formData: FormData
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "No file was uploaded." };
  }
  if (file.size === 0) return { ok: false, error: EMPTY_MESSAGE };
  if (file.size > IMPORT_MAX_FILE_BYTES) {
    return { ok: false, error: FILE_TOO_LARGE };
  }
  return { ok: true, text: await file.text() };
}

/** Per-row "why invalid" message for the issues list (D5). */
function invalidReason(row: NormalizedImportRow): string {
  const missing: string[] = [];
  if (row.date === null) missing.push("date");
  if (row.amount === null) missing.push("amount");
  if (row.type === null) missing.push("type");
  return `Skipped — couldn't read ${missing.join(", ")}.`;
}

/** Turn the raw upload into normalized rows, or a distinct structural error (D5). */
function produceNormalized(
  opts: ImportOptions,
  text: string
):
  | { ok: true; rows: NormalizedImportRow[] }
  | { ok: false; error: string } {
  if (opts.format === "json") {
    const env = parseImportEnvelope(text);
    if (!env.ok) return { ok: false, error: env.message };
    if (env.rows.length > IMPORT_MAX_ROWS) {
      return { ok: false, error: tooManyRowsMessage(IMPORT_MAX_ROWS) };
    }
    return { ok: true, rows: env.rows };
  }

  const clean = stripBomAndSepHint(text);
  if (clean.trim() === "") return { ok: false, error: EMPTY_MESSAGE };

  const delimiter = detectDelimiter(clean);
  const grid = parseCsv(clean, delimiter);
  if (grid.length === 0) return { ok: false, error: CSV_UNREADABLE };

  const [header, ...data] = grid;
  if (header.length === 0 || header.every((h) => h.trim() === "")) {
    return { ok: false, error: CSV_UNREADABLE };
  }
  if (data.length === 0) return { ok: false, error: EMPTY_MESSAGE };
  if (data.length > IMPORT_MAX_ROWS) {
    return { ok: false, error: tooManyRowsMessage(IMPORT_MAX_ROWS) };
  }
  if (!opts.mapping || opts.mapping.date === null || opts.mapping.amount === null) {
    return { ok: false, error: "Map the Date and Amount columns to continue." };
  }

  const dateFormat = opts.dateFormat ?? "YYYY-MM-DD";
  const rows = data.map((r, i) =>
    normalizeCsvRow(r, opts.mapping!, dateFormat, opts.decimal, i + 1)
  );
  return { ok: true, rows };
}

interface PipelineData {
  totalRows: number;
  toCreate: ResolvedRow[];
  duplicatesSkipped: number;
  invalidSkipped: number;
  transfersSkipped: number;
  newCategoryNames: string[];
  issues: ImportIssue[];
  sample: PreviewRow[];
  highSkip: boolean;
  account: { currency: string; name: string };
}

/**
 * The shared parse → classify → resolve → dedup pipeline (data-import-spec §3),
 * run identically by preview and commit (D6). The DB reads (category index +
 * existing-count) happen here, so the commit re-derives `toCreate` against current
 * state and the preview is advisory.
 */
async function buildPipeline(
  userId: string,
  opts: ImportOptions,
  text: string,
  account: { currency: string; name: string }
): Promise<{ ok: true; data: PipelineData } | { ok: false; error: string }> {
  const produced = produceNormalized(opts, text);
  if (!produced.ok) return produced;
  const normalized = produced.rows;
  const totalRows = normalized.length;

  // Classify: transfers + invalid rows are skipped and reported (D1/D5).
  const issues: ImportIssue[] = [];
  let transfersSkipped = 0;
  let invalidSkipped = 0;
  const survivors: NormalizedImportRow[] = [];
  for (const row of normalized) {
    if (row.type === "TRANSFER") {
      transfersSkipped++;
      issues.push({
        source: row.source,
        kind: "transfer",
        message: "Transfer skipped — a transfer needs two accounts.",
      });
      continue;
    }
    if (row.date === null || row.amount === null || row.type === null) {
      invalidSkipped++;
      issues.push({ source: row.source, kind: "invalid", message: invalidReason(row) });
      continue;
    }
    survivors.push(row);
  }

  // Resolve categories against the owned index (C2).
  const targets = await getImportTargets(userId);
  const index = buildCategoryIndex(targets.categories);
  const catNameById = new Map(targets.categories.map((c) => [c.id, c.name]));
  const newNameByKey = new Map<string, string>();
  const labelBySource = new Map<number, string | null>();
  const resolved: ResolvedRow[] = [];

  for (const row of survivors) {
    const res = resolveCategory(row.categoryText, index, opts.categoryResolution);
    let categoryId: string | null = null;
    let createCategoryName: string | null = null;
    let label: string | null = null;

    if ("createName" in res) {
      createCategoryName = res.createName;
      const key = normalizeCatKey(res.createName);
      if (!newNameByKey.has(key)) newNameByKey.set(key, res.createName);
      label = `+ ${res.createName}`;
    } else {
      categoryId = res.categoryId;
      label = categoryId ? catNameById.get(categoryId) ?? null : null;
    }

    labelBySource.set(row.source, label);
    resolved.push({
      source: row.source,
      date: row.date as string,
      amount: row.amount as number,
      type: row.type as "INCOME" | "EXPENSE",
      merchant: row.merchant,
      note: row.note,
      categoryId,
      createCategoryName,
    });
  }
  const newCategoryNames = [...newNameByKey.values()];

  // Dedup against current ledger state (D4).
  const existing = await countExistingForDedup(
    userId,
    opts.accountId,
    resolved.map((r) => r.date)
  );
  const { toCreate, duplicatesSkipped } = partitionForWrite(
    resolved,
    existing,
    opts.skipDuplicates
  );
  const createSources = new Set(toCreate.map((r) => r.source));

  // Sample table (first N normalized rows, with resolved label + flags).
  const sample: PreviewRow[] = normalized
    .slice(0, IMPORT_PREVIEW_SAMPLE_SIZE)
    .map((row) => {
      const isSurvivor = labelBySource.has(row.source);
      const signed =
        row.amount !== null && row.type
          ? row.type === "EXPENSE"
            ? -row.amount
            : row.amount
          : null;
      return {
        source: row.source,
        date: row.date,
        amount: signed,
        type: row.type,
        category: isSurvivor ? labelBySource.get(row.source) ?? null : null,
        merchant: row.merchant,
        note: row.note,
        willCreate: createSources.has(row.source),
        truncated: row.merchantTruncated || row.noteTruncated,
      };
    });

  const notCreated = duplicatesSkipped + invalidSkipped + transfersSkipped;
  const highSkip = totalRows > 0 && notCreated / totalRows >= IMPORT_HIGH_SKIP_RATIO;

  return {
    ok: true,
    data: {
      totalRows,
      toCreate,
      duplicatesSkipped,
      invalidSkipped,
      transfersSkipped,
      newCategoryNames,
      issues,
      sample,
      highSkip,
      account,
    },
  };
}

/** Verify the target account is owned + active and return its currency/name (C1). */
async function getOwnedTarget(
  userId: string,
  accountId: string
): Promise<{ currency: string; name: string } | null> {
  return prisma.financialAccount.findFirst({
    where: { id: accountId, userId, isArchived: false },
    select: { currency: true, name: true },
  });
}

/**
 * Inspect a CSV: detect dialect + suggest a mapping to drive the mapping UI. No
 * write. JSON skips this step (its envelope is self-describing).
 */
export async function inspectCsv(
  formData: FormData
): Promise<ActionResult<CsvInspection>> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  const rl = await checkRateLimit("import", userId);
  if (!rl.success) return RATE_LIMITED;

  const upload = await readUpload(formData);
  if (!upload.ok) return { success: false, error: upload.error };

  const clean = stripBomAndSepHint(upload.text);
  if (clean.trim() === "") return { success: false, error: EMPTY_MESSAGE };

  const delimiter = detectDelimiter(clean);
  const grid = parseCsv(clean, delimiter);
  if (grid.length === 0) return { success: false, error: CSV_UNREADABLE };

  const [header, ...data] = grid;
  if (header.length === 0 || header.every((h) => h.trim() === "")) {
    return { success: false, error: CSV_UNREADABLE };
  }
  if (data.length === 0) return { success: false, error: EMPTY_MESSAGE };
  if (data.length > IMPORT_MAX_ROWS) {
    return { success: false, error: tooManyRowsMessage(IMPORT_MAX_ROWS) };
  }

  const suggestedMapping = suggestMapping(header);
  const dialect = detectDialect(
    data,
    delimiter,
    suggestedMapping.amount,
    suggestedMapping.date
  );

  return {
    success: true,
    data: {
      headers: header,
      sampleRows: data.slice(0, IMPORT_PREVIEW_SAMPLE_SIZE),
      suggestedMapping,
      dataRowCount: data.length,
      dialect,
    },
  };
}

/** Dry-run the full pipeline and return the counts the user will confirm (D6). */
export async function previewImport(
  formData: FormData,
  opts: ImportOptions
): Promise<ActionResult<ImportPreview>> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  const rl = await checkRateLimit("import", userId);
  if (!rl.success) return RATE_LIMITED;

  const parsed = importOptionsSchema.safeParse(opts);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const upload = await readUpload(formData);
  if (!upload.ok) return { success: false, error: upload.error };

  const account = await getOwnedTarget(userId, parsed.data.accountId);
  if (!account) return { success: false, error: "Account not found." };

  const pipe = await buildPipeline(userId, parsed.data, upload.text, account);
  if (!pipe.ok) return { success: false, error: pipe.error };
  const d = pipe.data;

  return {
    success: true,
    data: {
      totalRows: d.totalRows,
      toCreate: d.toCreate.length,
      duplicatesSkipped: d.duplicatesSkipped,
      invalidSkipped: d.invalidSkipped,
      transfersSkipped: d.transfersSkipped,
      newCategories: d.newCategoryNames,
      sample: d.sample,
      issues: d.issues.slice(0, IMPORT_MAX_ISSUES),
      issuesTruncated: d.issues.length > IMPORT_MAX_ISSUES,
      highSkip: d.highSkip,
      currency: d.account.currency,
      accountName: d.account.name,
    },
  };
}

/**
 * Run the identical pipeline, then write atomically: created categories then
 * transactions inside one `$transaction` via `createMany` (D7). The commit is
 * authoritative — it re-derives `toCreate` and flags `divergedFromPreview` when
 * the count differs from the preview's `expectedCreate` (D6).
 */
export async function commitImport(
  formData: FormData,
  opts: ImportOptions,
  expectedCreate?: number
): Promise<ActionResult<ImportResult>> {
  const session = await auth();
  if (!session?.user?.id) return NOT_AUTHED;
  const userId = session.user.id;

  const rl = await checkRateLimit("import", userId);
  if (!rl.success) return RATE_LIMITED;

  const parsed = importOptionsSchema.safeParse(opts);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const upload = await readUpload(formData);
  if (!upload.ok) return { success: false, error: upload.error };

  const account = await getOwnedTarget(userId, parsed.data.accountId);
  if (!account) return { success: false, error: "Account not found." };

  const pipe = await buildPipeline(userId, parsed.data, upload.text, account);
  if (!pipe.ok) return { success: false, error: pipe.error };
  const d = pipe.data;

  try {
    const { created, categoriesCreated } = await prisma.$transaction(
      async (tx) => {
        let categoriesCreated = 0;
        if (d.newCategoryNames.length > 0) {
          const res = await tx.category.createMany({
            data: d.newCategoryNames.map((name) => ({
              name,
              userId,
              isSystem: false,
              icon: DEFAULT_CATEGORY_ICON,
              color: DEFAULT_CATEGORY_COLOR,
            })),
            skipDuplicates: true,
          });
          categoriesCreated = res.count;
        }

        // Re-query to resolve created names → ids — race-safe even when our
        // createMany skipped a name a parallel import already inserted (§7.2).
        const freshCats = await tx.category.findMany({
          where: { OR: [{ userId: null }, { userId }] },
          select: { id: true, name: true },
        });
        const freshIndex = buildCategoryIndex(freshCats);

        const data = d.toCreate.map((r) => {
          let categoryId = r.categoryId;
          if (categoryId === null && r.createCategoryName) {
            categoryId =
              freshIndex.get(normalizeCatKey(r.createCategoryName)) ?? null;
          }
          const mag = round2(r.amount);
          return {
            userId,
            type: r.type,
            amount: r.type === "EXPENSE" ? -mag : mag,
            currency: account.currency,
            date: dateInputToUtc(r.date),
            financialAccountId: parsed.data.accountId,
            categoryId,
            merchant: r.merchant,
            note: r.note,
          };
        });

        let created = 0;
        if (data.length > 0) {
          const res = await tx.transaction.createMany({ data });
          created = res.count;
        }
        return { created, categoriesCreated };
      }
    );

    revalidateTransactionViews();
    revalidateCategoryViews();

    // Volume counts are bucketed, never raw — a raw count leaks ledger size.
    void track("import_committed", {
      format: parsed.data.format,
      createdBucket: bucketCount(created),
      skippedBucket: bucketCount(
        d.duplicatesSkipped + d.invalidSkipped + d.transfersSkipped
      ),
    });

    const divergedFromPreview =
      typeof expectedCreate === "number" && created !== expectedCreate;

    return {
      success: true,
      data: {
        created,
        categoriesCreated,
        duplicatesSkipped: d.duplicatesSkipped,
        invalidSkipped: d.invalidSkipped,
        transfersSkipped: d.transfersSkipped,
        divergedFromPreview,
      },
    };
  } catch (error) {
    console.error("commitImport failed", error);
    return { success: false, error: "Could not import — nothing was written." };
  }
}
