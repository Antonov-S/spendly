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
import { createTag, updateTag, getTagForEdit } from "@/actions/tags";
import { TagChip } from "@/components/tags/tag-chip";
import { TAG_COLORS, DEFAULT_TAG_COLOR } from "@/lib/constants";
import { BREAKPOINTS, TAG_NAME_MAX } from "@/lib/system-constants";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import type { TagOption } from "@/types/tags";

interface TagFormDrawerProps {
  open: boolean;
  /** Tag id to edit; null = create mode. */
  editId: string | null;
  onClose: () => void;
  /** Called with the persisted row on a successful create (e.g. to auto-select it). */
  onCreated?: (tag: TagOption) => void;
}

export function TagFormDrawer({
  open,
  editId,
  onClose,
  onCreated,
}: TagFormDrawerProps) {
  const router = useRouter();
  const isDesktop = useMediaQuery(`(min-width: ${BREAKPOINTS.mobile}px)`);
  const [isPending, startTransition] = useTransition();

  const [loadingEdit, setLoadingEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(DEFAULT_TAG_COLOR);

  const isEdit = editId !== null;

  // Reset / pre-fill whenever the drawer opens.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError(null);

    if (editId) {
      setLoadingEdit(true);
      getTagForEdit(editId).then((res) => {
        if (!active) return;
        setLoadingEdit(false);
        if (!res.success || !res.data) {
          setError(res.error ?? "Could not load the tag.");
          return;
        }
        setName(res.data.name);
        setColor(res.data.color);
      });
    } else {
      setName("");
      setColor(DEFAULT_TAG_COLOR);
    }

    return () => {
      active = false;
    };
  }, [open, editId]);

  const busy = isPending || loadingEdit;
  const canSubmit = name.trim().length > 0;

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const trimmed = name.trim();
      if (editId !== null) {
        // color: null clears it back to a neutral chip.
        const res = await updateTag({ id: editId, name: trimmed, color });
        if (res.success) {
          onClose();
          toast.success("Tag updated");
          router.refresh();
        } else {
          setError(res.error ?? "Something went wrong.");
        }
      } else {
        const res = await createTag({
          name: trimmed,
          ...(color ? { color } : {}),
        });
        if (res.success) {
          onClose();
          toast.success("Tag created");
          onCreated?.(res.data);
          router.refresh();
        } else {
          setError(res.error ?? "Something went wrong.");
        }
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
          <SheetTitle>{isEdit ? "Edit tag" : "New tag"}</SheetTitle>
          <SheetDescription className="sr-only">
            Choose a name and an optional color for your tag.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {/* Live preview */}
          <div className="mb-5">
            <TagChip tag={{ name: name.trim() || "Tag name", color }} />
          </div>

          {/* Name */}
          <div className="mb-4">
            <Label>Name</Label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. vacation-2026"
              maxLength={TAG_NAME_MAX}
              className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3"
            />
          </div>

          {/* Color (optional) */}
          <div>
            <Label>Color (optional)</Label>
            <div className="flex flex-wrap items-center gap-2">
              {/* "No color" — neutral chip */}
              <button
                type="button"
                onClick={() => setColor(null)}
                aria-label="No color"
                aria-pressed={color === null}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border-2 text-[13px] text-ink-3 transition-transform",
                  color === null ? "border-ink scale-110" : "border-line"
                )}
              >
                <span aria-hidden>∅</span>
              </button>
              {TAG_COLORS.map((c) => {
                const selected = c === color;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={c}
                    aria-pressed={selected}
                    className={cn(
                      "h-7 w-7 rounded-full border-2 transition-transform",
                      selected ? "border-ink scale-110" : "border-transparent"
                    )}
                    style={{ backgroundColor: c }}
                  />
                );
              })}
            </div>
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
            {busy ? "Saving…" : isEdit ? "Save tag" : "Create tag"}
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
