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
  createGoal,
  updateGoal,
  getGoalForEdit,
  type MutationResult,
} from "@/actions/goals";
import { BREAKPOINTS } from "@/lib/system-constants";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

interface GoalFormDrawerProps {
  open: boolean;
  /** Goal id to edit; null = create mode. */
  editId: string | null;
  onClose: () => void;
}

export function GoalFormDrawer({ open, editId, onClose }: GoalFormDrawerProps) {
  const router = useRouter();
  const isDesktop = useMediaQuery(`(min-width: ${BREAKPOINTS.mobile}px)`);
  const [isPending, startTransition] = useTransition();

  const [loadingEdit, setLoadingEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [targetDate, setTargetDate] = useState("");

  const isEdit = editId !== null;

  // Reset / pre-fill whenever the drawer opens.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError(null);

    if (editId) {
      setLoadingEdit(true);
      getGoalForEdit(editId).then((res) => {
        if (!active) return;
        setLoadingEdit(false);
        if (!res.success || !res.data) {
          setError(res.error ?? "Could not load the goal.");
          return;
        }
        setName(res.data.name);
        setTargetAmount(String(res.data.targetAmount));
        setTargetDate(res.data.targetDate ?? "");
      });
    } else {
      setName("");
      setTargetAmount("");
      setTargetDate("");
    }

    return () => {
      active = false;
    };
  }, [open, editId]);

  const busy = isPending || loadingEdit;
  const canSubmit = name.trim().length > 0 && Number(targetAmount) > 0;

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const payload = {
        name: name.trim(),
        targetAmount: Number(targetAmount),
        targetDate: targetDate ? targetDate : null,
      };
      let res: MutationResult;
      if (editId !== null) {
        res = await updateGoal(editId, payload);
      } else {
        res = await createGoal(payload);
      }

      if (res.success) {
        onClose();
        toast.success(isEdit ? "Goal updated" : "Goal created");
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
          <SheetTitle>{isEdit ? "Edit goal" : "New goal"}</SheetTitle>
          <SheetDescription className="sr-only">
            Set a savings target and an optional target date.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {/* Name */}
          <div className="mb-4">
            <Label>Name</Label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Japan trip"
              maxLength={80}
              className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3"
            />
          </div>

          {/* Target amount */}
          <div className="mb-4">
            <Label>Target amount</Label>
            <div className="flex items-center rounded-lg border border-line bg-app px-3">
              <span className="text-[22px] font-medium text-ink-3">€</span>
              <input
                type="text"
                inputMode="decimal"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent py-2.5 pl-1 text-[22px] font-medium text-ink outline-none placeholder:text-ink-3"
              />
            </div>
          </div>

          {/* Target date (optional) */}
          <div>
            <Label>Target date (optional)</Label>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none"
            />
          </div>
        </div>

        <SheetFooter>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy || !canSubmit}
            className="w-full rounded-lg bg-success py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Saving…" : isEdit ? "Save goal" : "Create goal"}
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
