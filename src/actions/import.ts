"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { dateInputToUtc } from "@/lib/date";
import {
  revalidateTransactionViews,
  revalidateCategoryViews,
  revalidateTagViews,
} from "@/lib/revalidation";
import {
  DEFAULT_CATEGORY_ICON,
  DEFAULT_CATEGORY_COLOR,
  SPLIT_LABEL,
} from "@/lib/constants";
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
import { acceptSplits } from "@/lib/import/split-gate";
import {
  buildCategoryIdSet,
  buildCategoryIndex,
  buildTagIndex,
  resolveCategory,
  resolveSplitCategory,
  resolveTag,
  normalizeCatKey,
} from "@/lib/import/resolve";
import { normalizeLabelKey } from "@/lib/text";
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
  ResolvedImportSplit,
  ImportTagRegistryEntry,
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

type ImportCandidateRow = NormalizedImportRow & {
  date: string;
  amount: number;
  type: "INCOME" | "EXPENSE";
};

function isInvalidRow(row: NormalizedImportRow): boolean {
  return row.date === null || row.amount === null || row.type === null;
}

function hasEnrichment(row: ResolvedRow): boolean {
  return (
    row.splits.length > 0 ||
    row.tagIds.length > 0 ||
    row.createTagNames.length > 0
  );
}

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
  | {
      ok: true;
      rows: NormalizedImportRow[];
      tagRegistry: ImportTagRegistryEntry[];
    }
  | { ok: false; error: string } {
  if (opts.format === "json") {
    const env = parseImportEnvelope(text);
    if (!env.ok) return { ok: false, error: env.message };
    if (env.rows.length > IMPORT_MAX_ROWS) {
      return { ok: false, error: tooManyRowsMessage(IMPORT_MAX_ROWS) };
    }
    return { ok: true, rows: env.rows, tagRegistry: env.tagRegistry };
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
  return { ok: true, rows, tagRegistry: [] };
}

interface PipelineData {
  totalRows: number;
  toCreate: ResolvedRow[];
  duplicatesSkipped: number;
  invalidSkipped: number;
  transfersSkipped: number;
  newCategoryNames: string[];
  newTags: ImportTagRegistryEntry[];
  splitTransactions: number;
  tagsToLink: number;
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
  const survivors: ImportCandidateRow[] = [];
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
    if (isInvalidRow(row)) {
      invalidSkipped++;
      issues.push({ source: row.source, kind: "invalid", message: invalidReason(row) });
      continue;
    }
    survivors.push(row as ImportCandidateRow);
  }

  // Resolve D2 split-line category attribution and D4 tag labels before D5 dedup.
  const targets = await getImportTargets(userId);
  const index = buildCategoryIndex(targets.categories);
  const categoryIdSet = buildCategoryIdSet(targets.categories);
  const catNameById = new Map(targets.categories.map((c) => [c.id, c.name]));
  const tagIndex = buildTagIndex(targets.tags);
  const registryColorByKey = new Map(
    produced.tagRegistry.map((t) => [normalizeLabelKey(t.name), t.color])
  );
  const newNameByKey = new Map<string, string>();
  const newTagByKey = new Map<string, ImportTagRegistryEntry>();
  const labelBySource = new Map<number, string | null>();
  const tagCountBySource = new Map<number, number>();
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

    // D3: malformed or invalid split payloads degrade to flat rows with issues.
    const gate = acceptSplits(row);
    let splits: ResolvedImportSplit[] = [];
    if (!gate.ok) {
      issues.push({
        source: row.source,
        kind: "split",
        message: gate.reason,
      });
    } else if (gate.splits.length > 0) {
      splits = gate.splits.map((split) => {
        // D2: resolve by exported name first, then same-user/system id fallback.
        const resolvedSplit = resolveSplitCategory(
          split,
          index,
          categoryIdSet,
          opts.categoryResolution
        );
        if (resolvedSplit.createCategoryName) {
          const key = normalizeCatKey(resolvedSplit.createCategoryName);
          if (!newNameByKey.has(key)) {
            newNameByKey.set(key, resolvedSplit.createCategoryName);
          }
        }
        return {
          ...resolvedSplit,
          amount: split.amount,
          note: split.note,
        };
      });
      categoryId = null;
      createCategoryName = null;
      label = `${SPLIT_LABEL} · ${splits.length}`;
    }

    const tagIds: string[] = [];
    const createTagNames: string[] = [];
    for (const tagName of row.tags) {
      const tag = resolveTag(tagName, tagIndex);
      if (tag.tagId !== null) {
        tagIds.push(tag.tagId);
      } else {
        createTagNames.push(tag.createName);
        const key = normalizeLabelKey(tag.createName);
        if (!newTagByKey.has(key)) {
          newTagByKey.set(key, {
            name: tag.createName,
            color: registryColorByKey.get(key) ?? null,
          });
        }
      }
    }

    labelBySource.set(row.source, label);
    tagCountBySource.set(row.source, tagIds.length + createTagNames.length);
    resolved.push({
      source: row.source,
      date: row.date,
      amount: row.amount,
      type: row.type,
      merchant: row.merchant,
      note: row.note,
      categoryId,
      createCategoryName,
      splits,
      tagIds,
      createTagNames,
    });
  }
  const newCategoryNames = [...newNameByKey.values()];
  const newTags = [...newTagByKey.values()];

  // D5: dedup identity stays date + signed amount + type + merchant + note.
  // Splits and tags do not affect whether a row is considered already present.
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
  const tagsToLink = new Set<string>();
  for (const row of toCreate) {
    for (const tagId of row.tagIds) tagsToLink.add(`id:${tagId}`);
    for (const tagName of row.createTagNames) {
      tagsToLink.add(`name:${normalizeLabelKey(tagName)}`);
    }
  }
  const splitTransactions = toCreate.filter((r) => r.splits.length > 0).length;

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
        tagCount: tagCountBySource.get(row.source) ?? 0,
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
      newTags,
      splitTransactions,
      tagsToLink: tagsToLink.size,
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
      splitTransactions: d.splitTransactions,
      tagsToLink: d.tagsToLink,
      newTags: d.newTags.map((tag) => tag.name),
      sample: d.sample,
      issues: d.issues.slice(0, IMPORT_MAX_ISSUES),
      issueCount: d.issues.length,
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
    const { created, categoriesCreated, tagsCreated } = await prisma.$transaction(
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

        // Re-query to resolve created names → ids; race-safe if createMany
        // skipped a category a parallel import already inserted (§7.2).
        const freshCats = await tx.category.findMany({
          where: { OR: [{ userId: null }, { userId }] },
          select: { id: true, name: true },
        });
        const freshIndex = buildCategoryIndex(freshCats);

        let tagsCreated = 0;
        if (d.newTags.length > 0) {
          const res = await tx.tag.createMany({
            data: d.newTags.map((tag) => ({
              name: tag.name,
              userId,
              color: tag.color,
            })),
            skipDuplicates: true,
          });
          tagsCreated = res.count;
        }
        const freshTags = await tx.tag.findMany({
          where: { userId },
          select: { id: true, name: true },
        });
        const freshTagIndex = buildTagIndex(freshTags);

        const resolveRowCategoryId = (r: ResolvedRow): string | null => {
          let categoryId = r.categoryId;
          if (categoryId === null && r.createCategoryName) {
            categoryId =
              freshIndex.get(normalizeCatKey(r.createCategoryName)) ?? null;
          }
          return categoryId;
        };

        const resolveSplitCategoryId = (s: ResolvedImportSplit): string | null => {
          if (s.categoryId) return s.categoryId;
          if (s.createCategoryName) {
            return freshIndex.get(normalizeCatKey(s.createCategoryName)) ?? null;
          }
          return null;
        };

        const buildBaseTransactionData = (
          r: ResolvedRow,
          categoryId: string | null
        ) => {
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
        };

        // D6: plain rows keep the fast createMany path; enriched rows use
        // per-row create so splits and tag joins are written atomically.
        const data = d.toCreate
          .filter((r) => !hasEnrichment(r))
          .map((r) => buildBaseTransactionData(r, resolveRowCategoryId(r)));

        let created = 0;
        if (data.length > 0) {
          const res = await tx.transaction.createMany({ data });
          created += res.count;
        }

        const enriched = d.toCreate.filter(hasEnrichment);
        for (const r of enriched) {
          const createdTx = await tx.transaction.create({
            data: {
              ...buildBaseTransactionData(r, resolveRowCategoryId(r)),
              ...(r.splits.length > 0
                ? {
                    splits: {
                      createMany: {
                        data: r.splits.map((s) => ({
                          categoryId: resolveSplitCategoryId(s),
                          amount: round2(s.amount),
                          note: s.note,
                        })),
                      },
                    },
                  }
                : {}),
            },
            select: { id: true },
          });
          const tagIds = [
            ...r.tagIds,
            ...r.createTagNames
              .map((name) => freshTagIndex.get(normalizeLabelKey(name)) ?? null)
              .filter((id): id is string => id !== null),
          ];
          if (tagIds.length > 0) {
            await tx.transactionTag.createMany({
              data: [...new Set(tagIds)].map((tagId) => ({
                transactionId: createdTx.id,
                tagId,
              })),
            });
          }
          created++;
        }
        return { created, categoriesCreated, tagsCreated };
      }
    );

    revalidateTransactionViews();
    revalidateCategoryViews();
    revalidateTagViews();

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
        tagsCreated,
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
