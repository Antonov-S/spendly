import "server-only";

interface RevocationRow {
  sessionEpoch: number;
  deletedAt: Date | null;
}

/**
 * A token is revoked when its user row is gone, the account is soft-deleted,
 * or the server-side epoch differs from the epoch stamped into the token.
 * Tokens minted before this feature carry no epoch and are treated as epoch 0.
 */
export function isTokenRevoked(
  tokenEpoch: unknown,
  row: RevocationRow | null
): boolean {
  if (!row || row.deletedAt) return true;
  const epoch = typeof tokenEpoch === "number" ? tokenEpoch : 0;
  return row.sessionEpoch !== epoch;
}
