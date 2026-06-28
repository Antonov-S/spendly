import { CATEGORY_NAME_MAX } from "@/lib/system-constants";
import type { CategoryResolution } from "@/types/import";

/**
 * Category resolution (data-import-spec C2) — the one source of truth for turning
 * a row's category *text* into an existing id, a to-be-created name, or null.
 * Pure: works only off the owned category index (never a source id), never
 * invents an id.
 */

/**
 * Normalize a category name to its match key: trim → collapse internal whitespace
 * runs to one space → Unicode NFC → lower-case (locale-independent). Both the
 * incoming text and existing names go through this, so `"  Coffee  "`, `"coffee"`,
 * and an NFC/NFD-divergent `"café"` all resolve to one category.
 */
export function normalizeCatKey(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFC")
    .toLowerCase();
}

/** Build `normalizeCatKey(name) → categoryId` once from the visible categories. */
export function buildCategoryIndex(
  cats: { id: string; name: string }[]
): Map<string, string> {
  const index = new Map<string, string>();
  for (const c of cats) {
    const key = normalizeCatKey(c.name);
    // First wins on a key collision (system seed precedes user dupes by query order).
    if (!index.has(key)) index.set(key, c.id);
  }
  return index;
}

export type ResolveCategoryResult =
  | { categoryId: string }
  | { createName: string }
  | { categoryId: null };

/**
 * Resolve one row's category text against the owned index under the chosen policy:
 *  - matched existing key      → `{ categoryId }`
 *  - unmatched, non-empty, CREATE → `{ createName }` (the trimmed display name)
 *  - unmatched + UNCATEGORIZED, or empty/blank → `{ categoryId: null }`
 *
 * A name longer than the category cap can't be created, so under CREATE it falls
 * back to `{ categoryId: null }` rather than minting a truncated category (D9).
 * The normalizer already nulls over-cap category text, so this is belt-and-braces.
 */
export function resolveCategory(
  text: string | null,
  index: Map<string, string>,
  policy: CategoryResolution
): ResolveCategoryResult {
  if (text == null) return { categoryId: null };
  const display = text.trim().replace(/\s+/g, " ");
  if (display === "") return { categoryId: null };

  const key = normalizeCatKey(display);
  const existing = index.get(key);
  if (existing) return { categoryId: existing };

  if (policy === "CREATE" && display.length <= CATEGORY_NAME_MAX) {
    return { createName: display };
  }
  return { categoryId: null };
}
