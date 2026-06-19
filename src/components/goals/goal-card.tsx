"use client";

import { useState } from "react";
import { MoreHorizontal, Plus, Check } from "lucide-react";
import { goalProgressPercent } from "@/lib/goals";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { GoalCard as GoalCardData } from "@/types/goals";

interface GoalCardProps {
  goal: GoalCardData;
  onEdit: (id: string) => void;
  onAddContribution: (id: string) => void;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
}

export function GoalCard({
  goal,
  onEdit,
  onAddContribution,
  onComplete,
  onDelete,
}: GoalCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const barPercent = goalProgressPercent(goal.saved, goal.target);
  // True percent (uncapped) for the label — can exceed 100 when overfunded.
  const truePercent =
    goal.target > 0 ? Math.round((goal.saved / goal.target) * 100) : 0;
  const overfunded = goal.saved > goal.target;

  return (
    <section className="relative flex flex-col rounded-xl border border-line bg-surface p-4">
      {/* Header: name + badges + menu */}
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: goal.color }}
        />
        <h3 className="truncate text-[13px] font-medium text-ink">{goal.name}</h3>

        {goal.isCompleted && (
          <span className="rounded bg-success/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-success">
            Completed
          </span>
        )}
        {goal.overdue && (
          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-warning">
            Overdue
          </span>
        )}
        {overfunded && (
          <span className="rounded bg-info/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-info">
            Over 100%
          </span>
        )}

        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Goal actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <MoreHorizontal size={16} />
        </button>
      </div>

      {/* Amounts */}
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-[18px] font-medium tabular-nums text-ink">
          {formatCurrency(goal.saved)}
        </span>
        <span className="text-[12px] tabular-nums text-ink-3">
          / {formatCurrency(goal.target)}
        </span>
        <span
          className={cn(
            "ml-auto text-[12px] tabular-nums",
            overfunded ? "text-info" : "text-ink-3"
          )}
        >
          {truePercent}%
        </span>
      </div>

      {/* Progress track (clamped to 100%) */}
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full"
          style={{ width: `${barPercent}%`, backgroundColor: goal.color }}
        />
      </div>

      {/* Footer: target date + quick add */}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[11px] text-ink-3">
          {goal.targetDate
            ? `Target ${formatDate(goal.targetDate)}`
            : "No target date"}
        </span>
        <button
          type="button"
          onClick={() => onAddContribution(goal.id)}
          className="ml-auto flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <Plus size={12} /> Contribution
        </button>
      </div>

      {/* Overflow menu */}
      {menuOpen && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            className="absolute right-4 top-11 z-50 min-w-40 overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
          >
            <MenuItem
              onClick={() => {
                setMenuOpen(false);
                onEdit(goal.id);
              }}
            >
              Edit
            </MenuItem>
            <MenuItem
              onClick={() => {
                setMenuOpen(false);
                onAddContribution(goal.id);
              }}
            >
              Add contribution
            </MenuItem>
            {!goal.isCompleted && (
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  onComplete(goal.id);
                }}
              >
                <Check size={13} /> Mark complete
              </MenuItem>
            )}
            <MenuItem
              danger
              onClick={() => {
                setMenuOpen(false);
                onDelete(goal.id);
              }}
            >
              Delete
            </MenuItem>
          </div>
        </>
      )}
    </section>
  );
}

function MenuItem({
  onClick,
  danger = false,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-surface-2",
        danger ? "text-danger" : "text-ink"
      )}
    >
      {children}
    </button>
  );
}

/** "YYYY-MM-DD" → "Jun 20, 2026" without a timezone shift. */
function formatDate(value: string): string {
  return new Date(value + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
