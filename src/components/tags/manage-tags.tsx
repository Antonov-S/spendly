"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { TagFormDrawer } from "@/components/tags/tag-form-drawer";
import { TagChip } from "@/components/tags/tag-chip";
import { ConfirmDeleteTagDialog } from "@/components/tags/confirm-delete-dialog";
import { deleteTag } from "@/actions/tags";
import type { ManageableTag } from "@/types/tags";

interface ManageTagsProps {
  tags: ManageableTag[];
}

/** "Used by N transactions", omitting the clause at zero. */
function usageLine(t: ManageableTag): string {
  return t.transactionCount > 0
    ? `Used by ${t.transactionCount} transaction${
        t.transactionCount === 1 ? "" : "s"
      }`
    : "Not used yet";
}

/**
 * The "Tags" management card on /settings: the user's tags with create / edit /
 * delete. Tags are always user-owned (there is no system tier), so every row is
 * editable and deletable.
 */
export function ManageTags({ tags }: ManageTagsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManageableTag | null>(null);

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
      const res = await deleteTag(id);
      if (res.success) {
        setDeleteTarget(null);
        toast.success("Tag deleted");
        router.refresh();
      } else {
        toast.error(res.error ?? "Could not delete the tag.");
      }
    });
  }

  return (
    <section
      aria-labelledby="tags-heading"
      className="rounded-xl border border-line bg-surface p-6"
    >
      <div className="flex items-center justify-between">
        <h2 id="tags-heading" className="text-[13px] font-medium text-ink">
          Tags
        </h2>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-md border border-line px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-2"
        >
          Add tag
        </button>
      </div>

      {tags.length === 0 ? (
        <p className="mt-3 text-[12px] text-ink-2">
          You haven&apos;t created any tags yet. Add tags to a transaction to
          group spending across categories — like{" "}
          <span className="text-ink">vacation-2026</span> or{" "}
          <span className="text-ink">reimbursable</span>.
        </p>
      ) : (
        <ul className="mt-4 flex max-h-105 flex-col gap-1 overflow-y-auto pr-1">
          {tags.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2"
            >
              <div className="min-w-0 flex-1">
                <TagChip tag={t} />
                <p className="mt-1 truncate text-[11px] text-ink-3">
                  {usageLine(t)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => openEdit(t.id)}
                aria-label={`Edit ${t.name}`}
                className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface hover:text-ink"
              >
                <Pencil size={15} />
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(t)}
                aria-label={`Delete ${t.name}`}
                className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface hover:text-danger"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <TagFormDrawer
        open={drawerOpen}
        editId={editId}
        onClose={() => setDrawerOpen(false)}
      />

      <ConfirmDeleteTagDialog
        name={deleteTarget?.name ?? null}
        transactionCount={deleteTarget?.transactionCount ?? 0}
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        pending={isPending}
      />
    </section>
  );
}
