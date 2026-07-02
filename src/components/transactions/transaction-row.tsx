"use client";

import { useState } from "react";
import { ArrowLeftRight, ChevronDown } from "lucide-react";
import { CategoryIcon } from "@/components/dashboard/category-icon";
import { TagChipRow } from "@/components/tags/tag-chip";
import { formatCurrency, formatSigned } from "@/lib/format";
import { resolveIcon } from "@/lib/icon-map";
import { TYPE_BORDER_COLOR } from "@/lib/transactions";
import { SPLIT_ICON, UNCATEGORIZED } from "@/lib/constants";
import { TAG_CHIPS_VISIBLE_MAX } from "@/lib/system-constants";
import { cn } from "@/lib/utils";
import type { CategoryRef } from "@/types/dashboard";
import type { FeedSplit, FeedTransaction } from "@/types/transactions";

/** Columns: Description | Category | Account | Amount (date lives in the group header). */
const ROW_GRID =
  "grid items-center gap-3 grid-cols-[1fr_auto] md:grid-cols-[minmax(0,1.7fr)_1.1fr_1fr_minmax(72px,auto)]";

const UNCATEGORIZED_REF: CategoryRef = {
  name: UNCATEGORIZED.name,
  color: UNCATEGORIZED.color,
  icon: resolveIcon(UNCATEGORIZED.icon),
};

const SplitIcon = resolveIcon(SPLIT_ICON);

function toCategoryRef(category: FeedSplit["category"]): CategoryRef {
  return category
    ? {
        name: category.name,
        color: category.color,
        icon: resolveIcon(category.icon),
      }
    : UNCATEGORIZED_REF;
}

export function TransactionRow({
  txn,
  onSelect,
}: {
  txn: FeedTransaction;
  /** Open the edit drawer for this row. */
  onSelect: () => void;
}) {
  const isTransfer = txn.type === "TRANSFER";
  const isIncome = txn.type === "INCOME";
  const isSplit = txn.isSplit;
  const [expanded, setExpanded] = useState(false);
  const panelId = `split-panel-${txn.id}`;

  const category: CategoryRef = txn.category
    ? {
        name: txn.category.name,
        color: txn.category.color,
        icon: resolveIcon(txn.category.icon),
      }
    : UNCATEGORIZED_REF;

  const accountLabel =
    isTransfer && txn.counterpartyAccountName
      ? `${txn.accountName} → ${txn.counterpartyAccountName}`
      : txn.accountName;

  // Secondary (mobile) label under the description.
  const secondaryLabel = isTransfer
    ? accountLabel
    : isSplit
      ? `Split · ${txn.splits.length}`
      : category.name;

  return (
    <div
      className="border-b border-line"
      style={{ boxShadow: `inset 2px 0 0 ${TYPE_BORDER_COLOR[txn.type]}` }}
    >
      <div className="flex items-stretch">
        {/* Main row — click opens the edit drawer (unchanged for non-split rows). */}
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            ROW_GRID,
            "flex-1 cursor-pointer px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
          )}
        >
          {/* Description (+ mobile secondary line) */}
          <div className="flex min-w-0 items-center gap-2.5">
            {isTransfer ? (
              <span className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-3">
                <ArrowLeftRight size={13} strokeWidth={2} />
              </span>
            ) : (
              <CategoryIcon category={category} />
            )}
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[12px] text-ink">
                {txn.description}
              </span>
              <span className="truncate text-[10px] text-ink-3 md:hidden">
                {secondaryLabel}
              </span>
              {/* Tag chips — metadata under the description, bounded per §10.3. */}
              <TagChipRow
                tags={txn.tags}
                visibleMax={TAG_CHIPS_VISIBLE_MAX}
                className="mt-1"
              />
            </span>
          </div>

          {/* Category (hidden for transfers and on mobile) */}
          <div className="hidden min-w-0 items-center gap-1.5 md:flex">
            {!isTransfer &&
              (isSplit ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2">
                  <SplitIcon size={12} strokeWidth={2} aria-hidden />
                  Split · {txn.splits.length}
                </span>
              ) : (
                <>
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: category.color }}
                  />
                  <span className="truncate text-[12px] text-ink-2">
                    {category.name}
                  </span>
                </>
              ))}
          </div>

          {/* Account */}
          <span className="hidden truncate text-[12px] text-ink-3 md:block">
            {accountLabel}
          </span>

          {/* Amount — magnitude in grey for transfers, signed otherwise */}
          <span
            className={cn(
              "text-right text-[12px] font-medium tabular-nums",
              isTransfer ? "text-ink-3" : isIncome ? "text-success" : "text-ink"
            )}
          >
            {isTransfer ? formatCurrency(txn.amount) : formatSigned(txn.amount)}
          </span>
        </button>

        {/* Split disclosure — dedicated control so expand can't be confused with
            edit (the whole main area click-edits). Split rows only. */}
        {isSplit && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={expanded ? "Hide split details" : "Show split details"}
            className="flex shrink-0 items-center px-3 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2"
          >
            <ChevronDown
              size={16}
              aria-hidden
              className={cn("transition-transform", expanded && "rotate-180")}
            />
          </button>
        )}
      </div>

      {/* Expanded split lines. */}
      {isSplit && expanded && (
        <div id={panelId} className="bg-app/40 px-4 pb-2.5 pl-11">
          {txn.splits.map((split) => {
            const ref = toCategoryRef(split.category);
            return (
              <div
                key={split.id}
                className="flex items-center gap-2 py-1 text-[12px]"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: ref.color }}
                />
                <span className="text-ink-2">{ref.name}</span>
                {split.note && (
                  <span className="truncate text-[11px] text-ink-3">
                    · {split.note}
                  </span>
                )}
                <span className="ml-auto shrink-0 tabular-nums text-ink">
                  {formatCurrency(split.amount)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
