"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { CategoryIcon } from "@/components/dashboard/category-icon";
import { ConfirmDeleteDialog } from "@/components/recurring/confirm-delete-dialog";
import {
  pauseTemplate,
  resumeTemplate,
  deleteTemplate,
} from "@/actions/recurring";
import { formatCadence } from "@/lib/recurring";
import { formatCurrency } from "@/lib/format";
import { toDateInputValue } from "@/lib/date";
import { resolveIcon } from "@/lib/icon-map";
import { cn } from "@/lib/utils";
import type { TemplateRow } from "@/lib/recurring";

interface TemplatesListProps {
  templates: TemplateRow[];
  onEdit: (id: string) => void;
}

/** Format a stored calendar date as "Jun 16, 2026". */
function formatDate(date: Date): string {
  return new Date(toDateInputValue(date) + "T00:00:00").toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", year: "numeric" }
  );
}

export function TemplatesList({ templates, onEdit }: TemplatesListProps) {
  const active = templates.filter((t) => t.isActive);
  const paused = templates.filter((t) => !t.isActive);

  return (
    <div className="flex flex-col gap-4">
      {active.length > 0 && (
        <TemplateSection title="Recurring rules" templates={active} onEdit={onEdit} />
      )}
      {paused.length > 0 && (
        <TemplateSection
          title="Paused"
          templates={paused}
          onEdit={onEdit}
          dimmed
        />
      )}
    </div>
  );
}

function TemplateSection({
  title,
  templates,
  onEdit,
  dimmed = false,
}: {
  title: string;
  templates: TemplateRow[];
  onEdit: (id: string) => void;
  dimmed?: boolean;
}) {
  return (
    <section className={cn("rounded-xl border border-line bg-surface", dimmed && "opacity-70")}>
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[13px] font-medium text-ink">{title}</h2>
      </div>
      <ul className="flex flex-col">
        {templates.map((t) => (
          <TemplateRowItem key={t.id} template={t} onEdit={onEdit} />
        ))}
      </ul>
    </section>
  );
}

function TemplateRowItem({
  template,
  onEdit,
}: {
  template: TemplateRow;
  onEdit: (id: string) => void;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isIncome = template.type === "INCOME";

  function runAction(
    action: () => Promise<{ success: boolean; error?: string }>,
    successMsg: string
  ) {
    startTransition(async () => {
      const res = await action();
      if (res.success) {
        toast.success(successMsg);
        router.refresh();
      } else {
        toast.error(res.error ?? "Something went wrong.");
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteTemplate(template.id);
      if (res.success) {
        setConfirmOpen(false);
        toast.success("Template deleted");
        router.refresh();
      } else {
        toast.error(res.error ?? "Could not delete the template.");
      }
    });
  }

  return (
    <li className="relative border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => onEdit(template.id)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
      >
        {template.category ? (
          <CategoryIcon
            category={{
              name: template.category.name,
              color: template.category.color,
              icon: resolveIcon(template.category.icon),
            }}
          />
        ) : (
          <span className="h-5.5 w-5.5 shrink-0 rounded-md bg-surface-2" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-ink">
              {template.name}
            </span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium",
                isIncome
                  ? "bg-success/15 text-success"
                  : "bg-danger/10 text-danger"
              )}
            >
              {isIncome ? "Income" : "Expense"}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-ink-3">
            Next {formatDate(template.nextOccurrence)} · {template.accountName}
          </p>
        </div>

        <span className="mr-8 shrink-0 text-right text-[12px] tabular-nums text-ink-2">
          {formatCurrency(template.amount)}
          <span className="text-ink-3"> / {formatCadence(template.cadence)}</span>
        </span>
      </button>

      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Template actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <MoreHorizontal size={16} />
      </button>

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
            className="absolute right-3 top-11 z-50 min-w-36 overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              disabled={isPending}
              onClick={() => {
                setMenuOpen(false);
                onEdit(template.id);
              }}
              className="w-full px-3 py-2 text-left text-[12px] text-ink transition-colors hover:bg-surface-2 disabled:opacity-60"
            >
              Edit
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={isPending}
              onClick={() => {
                setMenuOpen(false);
                if (template.isActive) {
                  runAction(() => pauseTemplate(template.id), "Template paused");
                } else {
                  runAction(() => resumeTemplate(template.id), "Template resumed");
                }
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-ink transition-colors hover:bg-surface-2 disabled:opacity-60"
            >
              {template.isActive ? (
                <>
                  <Pause size={13} /> Pause
                </>
              ) : (
                <>
                  <Play size={13} /> Resume
                </>
              )}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={isPending}
              onClick={() => {
                setMenuOpen(false);
                setConfirmOpen(true);
              }}
              className="w-full px-3 py-2 text-left text-[12px] text-danger transition-colors hover:bg-surface-2 disabled:opacity-60"
            >
              Delete
            </button>
          </div>
        </>
      )}

      <ConfirmDeleteDialog
        name={template.name}
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDelete}
        pending={isPending}
      />
    </li>
  );
}
