/**
 * Shared text-normalization helpers. One canonical "match key" pipeline used
 * anywhere a user-entered label must be compared case/whitespace/Unicode-
 * insensitively — category resolution (import) and merchant grouping
 * (subscription detection). Extracting it here keeps those surfaces from
 * drifting into two "almost the same" normalizers.
 */

/**
 * Normalize a user-entered label to its match key: trim → collapse internal
 * whitespace runs to one space → Unicode NFC → lower-case (locale-independent).
 * So `"  NETFLIX "`, `"netflix"`, and an NFC/NFD-divergent `"café"` all resolve
 * to one key.
 */
export function normalizeLabelKey(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFC")
    .toLowerCase();
}
