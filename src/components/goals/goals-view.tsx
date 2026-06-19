"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { completeGoal, deleteGoal } from "@/actions/goals";
import { GoalCard } from "@/components/goals/goal-card";
import { GoalEmptyState } from "@/components/goals/goal-empty-state";
import { GoalFormDrawer } from "@/components/goals/goal-form-drawer";
import { ContributionDrawer } from "@/components/goals/contribution-drawer";
import { ConfirmDeleteGoalDialog } from "@/components/goals/confirm-delete-dialog";
import type { GoalCard as GoalCardData } from "@/types/goals";

interface GoalsViewProps {
  goals: GoalCardData[];
}

interface FormState {
  open: boolean;
  editId: string | null;
}

export function GoalsView({ goals }: GoalsViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [form, setForm] = useState<FormState>({ open: false, editId: null });
  const [contributionGoalId, setContributionGoalId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const active = goals.filter((g) => !g.isCompleted);
  const completed = goals.filter((g) => g.isCompleted);

  // Re-derive the targeted goals from props so they stay live across refreshes.
  const contributionGoal = goals.find((g) => g.id === contributionGoalId) ?? null;
  const deleteGoalCard = goals.find((g) => g.id === deleteId) ?? null;

  const openCreate = () => setForm({ open: true, editId: null });
  const openEdit = (id: string) => setForm({ open: true, editId: id });
  const closeForm = () => setForm((f) => ({ ...f, open: false }));

  function handleComplete(id: string) {
    startTransition(async () => {
      const res = await completeGoal(id);
      if (res.success) {
        toast.success("Goal marked complete");
        router.refresh();
      } else {
        toast.error(res.error ?? "Could not complete the goal.");
      }
    });
  }

  function handleDelete() {
    if (!deleteId) return;
    startTransition(async () => {
      const res = await deleteGoal(deleteId);
      if (res.success) {
        setDeleteId(null);
        toast.success("Goal deleted");
        router.refresh();
      } else {
        toast.error(res.error ?? "Could not delete the goal.");
      }
    });
  }

  if (goals.length === 0) {
    return (
      <>
        <Header onCreate={openCreate} />
        <GoalEmptyState onCreate={openCreate} />
        <GoalFormDrawer open={form.open} editId={form.editId} onClose={closeForm} />
      </>
    );
  }

  return (
    <>
      <Header onCreate={openCreate} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {active.map((goal) => (
          <GoalCard
            key={goal.id}
            goal={goal}
            onEdit={openEdit}
            onAddContribution={setContributionGoalId}
            onComplete={handleComplete}
            onDelete={setDeleteId}
          />
        ))}
      </div>

      {completed.length > 0 && (
        <section className="mt-2">
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-ink-3">
            Completed
          </h2>
          <div className="grid grid-cols-1 gap-3 opacity-70 sm:grid-cols-2 lg:grid-cols-3">
            {completed.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                onEdit={openEdit}
                onAddContribution={setContributionGoalId}
                onComplete={handleComplete}
                onDelete={setDeleteId}
              />
            ))}
          </div>
        </section>
      )}

      <GoalFormDrawer open={form.open} editId={form.editId} onClose={closeForm} />

      <ContributionDrawer
        open={contributionGoal !== null}
        goalId={contributionGoal?.id ?? null}
        goalName={contributionGoal?.name ?? null}
        contributions={contributionGoal?.contributions ?? []}
        onClose={() => setContributionGoalId(null)}
      />

      <ConfirmDeleteGoalDialog
        name={deleteGoalCard?.name ?? null}
        contributionCount={deleteGoalCard?.contributions.length ?? 0}
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        pending={isPending}
      />
    </>
  );
}

function Header({ onCreate }: { onCreate: () => void }) {
  return (
    <header className="flex items-center gap-3">
      <div>
        <h1 className="text-[20px] font-medium leading-none text-ink">Goals</h1>
        <p className="mt-1.5 text-[12px] text-ink-3">
          Track savings targets with manual contributions
        </p>
      </div>

      <button
        type="button"
        onClick={onCreate}
        className="ml-auto flex items-center gap-1.5 rounded-lg bg-success px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
      >
        <Plus size={16} />
        <span className="hidden sm:inline">Add goal</span>
      </button>
    </header>
  );
}
