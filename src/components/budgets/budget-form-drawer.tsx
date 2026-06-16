"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  createBudget,
  updateBudget,
  getBudgetForEdit,
  type MutationResult,
} from "@/actions/budgets";
import { BREAKPOINTS } from "@/lib/system-constants";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import type { CategoryOption } from "@/types/transactions";

interface BudgetFormDrawerProps {
  open: boolean;
  /** Budget id to edit; null = create mode. */
  editId: string | null;
  /** Category name shown (disabled) when editing — period/category are fixed. */
  editCategoryName: string | null;
  period: { month: number; year: number };
  /** Categories with no active budget this period (create picker). */
  availableCategories: CategoryOption[];
  onClose: () => void;
}

export function BudgetFormDrawer({
  open,
  editId,
  editCategoryName,
  period,
  availableCategories,
  onClose,
}: BudgetFormDrawerProps) {
  const router = useRouter();
  const isDesktop = useMediaQuery(`(min-width: ${BREAKPOINTS.mobile}px)`);
  const [isPending, startTransition] = useTransition();

  const [loadingEdit, setLoadingEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const isEdit = editId !== null;

  const periodLabel = new Date(
    period.year,
    period.month - 1,
    1
  ).toLocaleString("en-US", { month: "long", year: "numeric" });

  // Reset / pre-fill whenever the drawer opens.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError(null);

    if (editId) {
      setLoadingEdit(true);
      getBudgetForEdit(editId).then((res) => {
        if (!active) return;
        setLoadingEdit(false);
        if (!res.success || !res.data) {
          setError(res.error ?? "Could not load the budget.");
          return;
        }
        setAmount(String(res.data.amount));
        setCategoryId(res.data.categoryId);
      });
    } else {
      setAmount("");
      setCategoryId("");
    }

    return () => {
      active = false;
    };
  }, [open, editId]);

  // Default the category to the first available option (create mode).
  useEffect(() => {
    if (!open || isEdit) return;
    setCategoryId((prev) => prev || availableCategories[0]?.id || "");
  }, [open, isEdit, availableCategories]);

  const noCategories = !isEdit && availableCategories.length === 0;
  const busy = isPending || loadingEdit;

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      let res: MutationResult;
      if (editId !== null) {
        res = await updateBudget(editId, { amount: Number(amount) });
      } else {
        res = await createBudget({
          categoryId,
          amount: Number(amount),
          month: period.month,
          year: period.year,
        });
      }

      if (res.success) {
        onClose();
        toast.success(isEdit ? "Budget updated" : "Budget added");
        router.refresh();
      } else {
        setError(res.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        className={cn(
          "gap-0 p-0",
          isDesktop
            ? "w-full sm:max-w-105"
            : "h-[90vh] rounded-t-2xl border-t border-line"
        )}
      >
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit budget" : "Add budget"}</SheetTitle>
          <SheetDescription className="sr-only">
            Set a monthly spending ceiling for a category.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {/* Period (read-only — the budget's identity) */}
          <div className="mb-4">
            <Label>Period</Label>
            <p className="rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink-2">
              {periodLabel}
            </p>
          </div>

          {/* Category — fixed in edit mode */}
          <div className="mb-4">
            <Label>Category</Label>
            {isEdit ? (
              <p className="rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink-2">
                {editCategoryName ?? "—"}
              </p>
            ) : (
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={noCategories}
                className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none disabled:opacity-60"
              >
                {noCategories && <option value="">No categories left</option>}
                {availableCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Amount */}
          <div>
            <Label>Monthly limit</Label>
            <div className="flex items-center rounded-lg border border-line bg-app px-3">
              <span className="text-[22px] font-medium text-ink-3">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent py-2.5 pl-1 text-[22px] font-medium text-ink outline-none placeholder:text-ink-3"
              />
            </div>
          </div>
        </div>

        <SheetFooter>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          {noCategories && (
            <p className="text-[12px] text-ink-3">
              Every category already has a budget this month.
            </p>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy || noCategories}
            className="w-full rounded-lg bg-success py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save budget"}
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[11px] font-medium text-ink-2">
      {children}
    </label>
  );
}
