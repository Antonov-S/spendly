"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { seedPresetBudgets } from "@/actions/budgets";
import { ONBOARDING_COPY } from "@/lib/constants";

interface OnboardingBudgetsStepProps {
  /** Called after seeding or skipping — advances the flow to Step 3. */
  onDone: () => void;
}

/**
 * Step 2 (optional) — seed starter budgets for the current month via the
 * existing `seedPresetBudgets` action, or skip. Seeded budgets are EUR (Part A).
 * Skipping loses nothing: the same action is reachable later from the Budgets
 * empty state.
 */
export function OnboardingBudgetsStep({ onDone }: OnboardingBudgetsStepProps) {
  const [isPending, startTransition] = useTransition();

  function handleSeed() {
    startTransition(async () => {
      const now = new Date();
      const res = await seedPresetBudgets(now.getMonth() + 1, now.getFullYear());
      if (!res.success) {
        toast.error(res.error ?? "Could not add starter budgets.");
        return;
      }
      const created = res.data?.created ?? 0;
      toast.success(
        created > 0
          ? `Added ${created} ${created === 1 ? "budget" : "budgets"}`
          : "No new budgets to add"
      );
      onDone();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={handleSeed}
        disabled={isPending}
        className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-success text-[13px] font-medium text-white transition-colors hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending && <Loader2 size={15} className="animate-spin" />}
        {ONBOARDING_COPY.budgets.primary}
      </button>

      <button
        type="button"
        onClick={onDone}
        disabled={isPending}
        className="text-center text-[12px] font-medium text-ink-2 transition-colors hover:text-ink disabled:opacity-60"
      >
        {ONBOARDING_COPY.budgets.skip}
      </button>
    </div>
  );
}
