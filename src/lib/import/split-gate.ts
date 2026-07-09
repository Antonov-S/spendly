import {
  SPLIT_MAX_LINES,
  SPLIT_MIN_LINES,
} from "@/lib/system-constants";
import { round2 } from "@/lib/money";
import type {
  NormalizedImportRow,
  NormalizedImportSplit,
} from "@/types/import";

type SplitGateRow = NormalizedImportRow & {
  amount: number;
  type: "INCOME" | "EXPENSE";
};

export type AcceptedSplits = {
  ok: true;
  splits: NormalizedImportSplit[];
};

export type DegradedSplits = {
  ok: false;
  reason: string;
};

export type SplitGateResult = AcceptedSplits | DegradedSplits;

/**
 * Import-only split validator (data-portability-hardening D3). Mirrors the
 * transaction drawer invariants but degrades invalid split attribution to a flat
 * row with a visible preview issue instead of rejecting import.
 */
export function acceptSplits(row: SplitGateRow): SplitGateResult {
  if (row.splitPayloadMalformed) {
    return { ok: false, reason: "Split ignored — couldn't read split lines." };
  }
  if (row.splits.length === 0) return { ok: true, splits: [] };

  if (row.type !== "EXPENSE") {
    return { ok: false, reason: "Split ignored — only expenses can be split." };
  }
  if (row.splits.length < SPLIT_MIN_LINES) {
    return {
      ok: false,
      reason: `Split ignored — add at least ${SPLIT_MIN_LINES} lines.`,
    };
  }
  if (row.splits.length > SPLIT_MAX_LINES) {
    return {
      ok: false,
      reason: `Split ignored — up to ${SPLIT_MAX_LINES} lines are supported.`,
    };
  }
  if (row.splits.some((s) => round2(s.amount) <= 0)) {
    return {
      ok: false,
      reason: "Split ignored — each line must be greater than zero.",
    };
  }

  const sum = round2(row.splits.reduce((acc, s) => acc + s.amount, 0));
  if (sum !== round2(row.amount)) {
    return { ok: false, reason: "Split ignored — lines don't add up to the amount." };
  }

  return { ok: true, splits: row.splits };
}
