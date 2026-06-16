"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { archiveBudget, unarchiveBudget } from "@/actions/budgets";
import { BudgetList } from "@/components/budgets/budget-list";
import { BudgetEmptyState } from "@/components/budgets/budget-empty-state";
import { BudgetFormDrawer } from "@/components/budgets/budget-form-drawer";
import type { BudgetListRow, BudgetSummary } from "@/types/dashboard";
import type { CategoryOption } from "@/types/transactions";

interface BudgetsViewProps {
  rows: BudgetListRow[];
  summary: BudgetSummary;
  availableCategories: CategoryOption[];
  period: { month: number; year: number };
}

interface DrawerState {
  open: boolean;
  editId: string | null;
  editCategoryName: string | null;
}

/** Shift a period by `delta` months, wrapping the year correctly. */
function shiftPeriod(month: number, year: number, delta: number) {
  const d = new Date(year, month - 1 + delta, 1);
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

export function BudgetsView({
  rows,
  summary,
  availableCategories,
  period,
}: BudgetsViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [drawer, setDrawer] = useState<DrawerState>({
    open: false,
    editId: null,
    editCategoryName: null,
  });

  const periodLabel = new Date(
    period.year,
    period.month - 1,
    1
  ).toLocaleString("en-US", { month: "long", year: "numeric" });

  function goToPeriod(delta: number) {
    const next = shiftPeriod(period.month, period.year, delta);
    router.push(`/budgets?month=${next.month}&year=${next.year}`);
  }

  const openCreate = () =>
    setDrawer({ open: true, editId: null, editCategoryName: null });
  const openEdit = (id: string, categoryName: string) =>
    setDrawer({ open: true, editId: id, editCategoryName: categoryName });
  const closeDrawer = () => setDrawer((d) => ({ ...d, open: false }));

  function handleArchive(id: string) {
    startTransition(async () => {
      const res = await archiveBudget(id);
      if (!res.success) {
        toast.error(res.error ?? "Could not archive the budget.");
        return;
      }
      toast("Budget archived", {
        duration: 8000,
        action: {
          label: "Undo",
          onClick: async () => {
            const undo = await unarchiveBudget(id);
            if (undo.success) router.refresh();
            else toast.error(undo.error ?? "Could not restore the budget.");
          },
        },
      });
      router.refresh();
    });
  }

  return (
    <>
      {/* Page header: period stepper + Add CTA */}
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-[20px] font-medium leading-none text-ink">
            Budgets
          </h1>
          <p className="mt-1.5 text-[12px] text-ink-3">
            Monthly spending ceilings per category
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1 rounded-lg border border-line bg-surface p-1">
          <button
            type="button"
            onClick={() => goToPeriod(-1)}
            aria-label="Previous month"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-32 text-center text-[12px] font-medium text-ink tabular-nums">
            {periodLabel}
          </span>
          <button
            type="button"
            onClick={() => goToPeriod(1)}
            aria-label="Next month"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-lg bg-success px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
        >
          <Plus size={16} />
          <span className="hidden sm:inline">Add budget</span>
        </button>
      </header>

      {rows.length === 0 ? (
        <BudgetEmptyState period={period} />
      ) : (
        <BudgetList
          rows={rows}
          summary={summary}
          periodLabel={periodLabel}
          onEdit={openEdit}
          onArchive={handleArchive}
          busy={isPending}
        />
      )}

      <BudgetFormDrawer
        open={drawer.open}
        editId={drawer.editId}
        editCategoryName={drawer.editCategoryName}
        period={period}
        availableCategories={availableCategories}
        onClose={closeDrawer}
      />
    </>
  );
}
