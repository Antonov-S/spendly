"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { CategoryFormDrawer } from "@/components/categories/category-form-drawer";
import { ConfirmDeleteCategoryDialog } from "@/components/categories/confirm-delete-dialog";
import { deleteCategory } from "@/actions/categories";
import { resolveIcon } from "@/lib/icon-map";
import type { ManageableCategory } from "@/types/categories";

interface ManageCategoriesProps {
  categories: ManageableCategory[];
}

/** "N transactions · M budgets · K recurring", omitting zero-count clauses. */
function usageLine(c: ManageableCategory): string {
  const parts: string[] = [];
  if (c.transactionCount > 0) {
    parts.push(`${c.transactionCount} transaction${c.transactionCount === 1 ? "" : "s"}`);
  }
  if (c.budgetCount > 0) {
    parts.push(`${c.budgetCount} budget${c.budgetCount === 1 ? "" : "s"}`);
  }
  if (c.recurringCount > 0) {
    parts.push(`${c.recurringCount} recurring`);
  }
  return parts.length > 0 ? `Used by ${parts.join(" · ")}` : "Not used yet";
}

/**
 * The "Categories" management card on /settings: list of the user's own
 * categories with create / edit / delete. System categories are never shown here
 * (they're immutable and excluded by `getManageableCategories`).
 */
export function ManageCategories({ categories }: ManageCategoriesProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManageableCategory | null>(null);

  function openCreate() {
    setEditId(null);
    setDrawerOpen(true);
  }

  function openEdit(id: string) {
    setEditId(id);
    setDrawerOpen(true);
  }

  function handleDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    startTransition(async () => {
      const res = await deleteCategory(id);
      if (res.success) {
        setDeleteTarget(null);
        toast.success("Category deleted");
        router.refresh();
      } else {
        toast.error(res.error ?? "Could not delete the category.");
      }
    });
  }

  return (
    <section
      aria-labelledby="categories-heading"
      className="rounded-xl border border-line bg-surface p-6"
    >
      <div className="flex items-center justify-between">
        <h2 id="categories-heading" className="text-[13px] font-medium text-ink">
          Categories
        </h2>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-md border border-line px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-2"
        >
          Add category
        </button>
      </div>

      {categories.length === 0 ? (
        <p className="mt-3 text-[12px] text-ink-2">
          You haven&apos;t created any categories yet. The 20 built-in categories
          are always available.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-1">
          {categories.map((c) => {
            const Icon = resolveIcon(c.icon);
            return (
              <li
                key={c.id}
                className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2"
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${c.color}1A`, color: c.color }}
                >
                  <Icon size={16} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">
                    {c.name}
                  </p>
                  <p className="truncate text-[11px] text-ink-3">{usageLine(c)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => openEdit(c.id)}
                  aria-label={`Edit ${c.name}`}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface hover:text-ink"
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(c)}
                  aria-label={`Delete ${c.name}`}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface hover:text-danger"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <CategoryFormDrawer
        open={drawerOpen}
        editId={editId}
        onClose={() => setDrawerOpen(false)}
      />

      <ConfirmDeleteCategoryDialog
        name={deleteTarget?.name ?? null}
        transactionCount={deleteTarget?.transactionCount ?? 0}
        recurringCount={deleteTarget?.recurringCount ?? 0}
        budgetCount={deleteTarget?.budgetCount ?? 0}
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        pending={isPending}
      />
    </section>
  );
}
