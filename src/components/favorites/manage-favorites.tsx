"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, Pencil, Trash2, X } from "lucide-react";
import { deleteFavorite, updateFavorite } from "@/actions/favorites";
import { formatCurrencyCents } from "@/lib/format";
import type { ManageableFavorite } from "@/types/favorites";

interface ManageFavoritesProps {
  favorites: ManageableFavorite[];
}

function typeLabel(type: ManageableFavorite["type"]): string {
  return type === "INCOME" ? "Income" : "Expense";
}

function summaryLine(favorite: ManageableFavorite): string {
  return [
    typeLabel(favorite.type),
    favorite.amount === null ? null : formatCurrencyCents(favorite.amount),
    favorite.categoryName,
    favorite.accountName,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

export function ManageFavorites({ favorites }: ManageFavoritesProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ManageableFavorite | null>(
    null
  );

  function startEdit(favorite: ManageableFavorite) {
    setEditId(favorite.id);
    setEditName(favorite.name);
  }

  function cancelEdit() {
    setEditId(null);
    setEditName("");
  }

  function saveEdit(id: string) {
    startTransition(async () => {
      const res = await updateFavorite(id, { name: editName });
      if (res.success) {
        cancelEdit();
        toast.success("Favorite renamed");
        router.refresh();
      } else {
        toast.error(res.error ?? "Could not rename the favorite.");
      }
    });
  }

  function handleDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    startTransition(async () => {
      const res = await deleteFavorite(id);
      if (res.success) {
        setDeleteTarget(null);
        toast.success("Favorite deleted");
        router.refresh();
      } else {
        toast.error(res.error ?? "Could not delete the favorite.");
      }
    });
  }

  return (
    <section
      aria-labelledby="favorites-heading"
      className="rounded-xl border border-line bg-surface p-6"
    >
      <h2 id="favorites-heading" className="text-[13px] font-medium text-ink">
        Favorites
      </h2>

      {favorites.length === 0 ? (
        <p className="mt-3 text-[12px] text-ink-2">
          Save a favorite from the transaction drawer to see it here.
        </p>
      ) : (
        <ul className="mt-4 flex max-h-105 flex-col gap-1 overflow-y-auto pr-1">
          {favorites.map((favorite) => {
            const editing = editId === favorite.id;
            return (
              <li
                key={favorite.id}
                className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2"
              >
                <div className="min-w-0 flex-1">
                  {editing ? (
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          saveEdit(favorite.id);
                        }
                        if (e.key === "Escape") {
                          cancelEdit();
                        }
                      }}
                      className="w-full rounded-md border border-line bg-app px-2 py-1 text-[13px] text-ink outline-none"
                    />
                  ) : (
                    <p className="truncate text-[13px] font-medium text-ink">
                      {favorite.name}
                    </p>
                  )}
                  <p className="mt-1 truncate text-[11px] text-ink-3">
                    {summaryLine(favorite)}
                  </p>
                  {favorite.accountArchived && (
                    <span className="mt-1.5 inline-flex rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                      Account archived · uses your default
                    </span>
                  )}
                </div>

                {editing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => saveEdit(favorite.id)}
                      disabled={isPending}
                      aria-label={`Save ${favorite.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface hover:text-success disabled:opacity-50"
                    >
                      <Check size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      aria-label={`Cancel editing ${favorite.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface hover:text-ink"
                    >
                      <X size={15} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => startEdit(favorite)}
                      aria-label={`Rename ${favorite.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface hover:text-ink"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(favorite)}
                      aria-label={`Delete ${favorite.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface hover:text-danger"
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDeleteFavoriteDialog
        name={deleteTarget?.name ?? null}
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        pending={isPending}
      />
    </section>
  );
}

interface ConfirmDeleteFavoriteDialogProps {
  name: string | null;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}

function ConfirmDeleteFavoriteDialog({
  name,
  open,
  onClose,
  onConfirm,
  pending,
}: ConfirmDeleteFavoriteDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="delete-favorite-title"
      onClose={onClose}
      className="m-auto w-[min(92vw,28rem)] rounded-xl border border-line bg-surface p-6 text-ink backdrop:bg-black/60"
    >
      <h3 id="delete-favorite-title" className="text-[15px] font-medium text-ink">
        Delete this favorite?
      </h3>
      <p className="mt-2 text-[12px] text-ink-2">
        This removes{" "}
        <span className="font-medium text-ink">{name ?? "this favorite"}</span>{" "}
        as a shortcut only. No transactions are affected. This cannot be undone.
      </p>

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 flex-1 items-center justify-center rounded-md border border-line text-[13px] font-medium text-ink transition-colors hover:bg-surface-2"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-danger text-[13px] font-medium text-white transition-colors hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending && <Loader2 size={15} className="animate-spin" />}
          Delete favorite
        </button>
      </div>
    </dialog>
  );
}
