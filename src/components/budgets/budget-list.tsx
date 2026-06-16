"use client";

import { useState } from "react";
import { MoreHorizontal, AlertTriangle } from "lucide-react";
import { CategoryIcon } from "@/components/dashboard/category-icon";
import { formatCurrency } from "@/lib/format";
import { budgetState, budgetPercent, budgetColor } from "@/lib/budget";
import { resolveIcon } from "@/lib/icon-map";
import { cn } from "@/lib/utils";
import type { BudgetListRow, BudgetSummary } from "@/types/dashboard";

interface BudgetListProps {
  rows: BudgetListRow[];
  summary: BudgetSummary;
  periodLabel: string;
  onEdit: (id: string, categoryName: string) => void;
  onArchive: (id: string) => void;
  busy: boolean;
}

export function BudgetList({
  rows,
  summary,
  periodLabel,
  onEdit,
  onArchive,
  busy,
}: BudgetListProps) {
  return (
    <section className="flex flex-col rounded-xl border border-line bg-surface">
      {/* Remaining summary */}
      <div className="border-b border-line px-4 py-3.5">
        <p className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
          Remaining in {periodLabel}
        </p>
        <p className="mt-1 text-[24px] font-medium leading-none text-ink">
          {formatCurrency(summary.remaining)}
        </p>
        <p className="mt-1.5 text-[11px] text-ink-2">
          of {formatCurrency(summary.total)} budget · {summary.categoryCount}{" "}
          {summary.categoryCount === 1 ? "category" : "categories"} ·{" "}
          {summary.daysLeft} days left
        </p>
        {summary.hasMixedCurrencies && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-warning">
            <AlertTriangle size={12} />
            Mixed currencies — approximate total
          </p>
        )}
      </div>

      {/* Budget rows */}
      <ul className="flex flex-col">
        {rows.map((budget) => (
          <BudgetRowItem
            key={budget.id}
            budget={budget}
            onEdit={onEdit}
            onArchive={onArchive}
            busy={busy}
          />
        ))}
      </ul>
    </section>
  );
}

function BudgetRowItem({
  budget,
  onEdit,
  onArchive,
  busy,
}: {
  budget: BudgetListRow;
  onEdit: (id: string, categoryName: string) => void;
  onArchive: (id: string) => void;
  busy: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const state = budgetState(budget.spent, budget.limit);
  const percent = budgetPercent(budget.spent, budget.limit);
  const color = budgetColor(state);
  const category = {
    name: budget.category.name,
    color: budget.category.color,
    icon: resolveIcon(budget.category.icon),
  };

  return (
    <li className="relative border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => onEdit(budget.id, budget.category.name)}
        className="flex w-full flex-col gap-2 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
      >
        <div className="flex items-center gap-2">
          <CategoryIcon category={category} size="sm" />
          <span className="text-[12px] text-ink">{category.name}</span>
          <span
            className={cn(
              "ml-auto mr-8 text-[11px] tabular-nums",
              state === "danger" ? "text-danger" : "text-ink-3"
            )}
          >
            {formatCurrency(budget.spent)} / {formatCurrency(budget.limit)}
          </span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full"
            style={{ width: `${percent}%`, backgroundColor: color }}
          />
        </div>
      </button>

      {/* Overflow menu trigger */}
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Budget actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <MoreHorizontal size={16} />
      </button>

      {menuOpen && (
        <>
          {/* Light-dismiss backdrop */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            className="absolute right-3 top-9 z-50 min-w-32 overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setMenuOpen(false);
                onArchive(budget.id);
              }}
              className="w-full px-3 py-2 text-left text-[12px] text-danger transition-colors hover:bg-surface-2 disabled:opacity-60"
            >
              Archive budget
            </button>
          </div>
        </>
      )}
    </li>
  );
}
