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
import { createCategory, updateCategory, getCategoryForEdit } from "@/actions/categories";
import {
  CATEGORY_ICONS,
  CATEGORY_COLORS,
  DEFAULT_CATEGORY_ICON,
  DEFAULT_CATEGORY_COLOR,
} from "@/lib/constants";
import { resolveIcon } from "@/lib/icon-map";
import type { LucideIcon } from "lucide-react";
import { BREAKPOINTS } from "@/lib/system-constants";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import type { CategoryOption } from "@/types/transactions";

/** A whitelisted icon name — the only values the create/update actions accept. */
type CategoryIcon = (typeof CATEGORY_ICONS)[number];

interface CategoryFormDrawerProps {
  open: boolean;
  /** Category id to edit; null = create mode. */
  editId: string | null;
  onClose: () => void;
  /** Called with the persisted row on a successful create (e.g. to auto-select it). */
  onCreated?: (category: CategoryOption) => void;
}

export function CategoryFormDrawer({
  open,
  editId,
  onClose,
  onCreated,
}: CategoryFormDrawerProps) {
  const router = useRouter();
  const isDesktop = useMediaQuery(`(min-width: ${BREAKPOINTS.mobile}px)`);
  const [isPending, startTransition] = useTransition();

  const [loadingEdit, setLoadingEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<CategoryIcon>(DEFAULT_CATEGORY_ICON);
  const [color, setColor] = useState<string>(DEFAULT_CATEGORY_COLOR);

  const isEdit = editId !== null;

  // Reset / pre-fill whenever the drawer opens.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError(null);

    if (editId) {
      setLoadingEdit(true);
      getCategoryForEdit(editId).then((res) => {
        if (!active) return;
        setLoadingEdit(false);
        if (!res.success || !res.data) {
          setError(res.error ?? "Could not load the category.");
          return;
        }
        setName(res.data.name);
        // Stored icons come from the CATEGORY_ICONS whitelist (enforced on write);
        // fall back defensively rather than casting an arbitrary string.
        setIcon(
          CATEGORY_ICONS.find((i) => i === res.data!.icon) ?? DEFAULT_CATEGORY_ICON
        );
        setColor(res.data.color);
      });
    } else {
      setName("");
      setIcon(DEFAULT_CATEGORY_ICON);
      setColor(DEFAULT_CATEGORY_COLOR);
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
        const res = await updateCategory({ id: editId, name: trimmed, icon, color });
        if (res.success) {
          onClose();
          toast.success("Category updated");
          router.refresh();
        } else {
          setError(res.error ?? "Something went wrong.");
        }
      } else {
        const res = await createCategory({ name: trimmed, icon, color });
        if (res.success) {
          onClose();
          toast.success("Category created");
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
          <SheetTitle>{isEdit ? "Edit category" : "New category"}</SheetTitle>
          <SheetDescription className="sr-only">
            Choose a name, icon, and color for your category.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {/* Live preview */}
          <PreviewChip
            Icon={resolveIcon(icon)}
            color={color}
            name={name.trim() || "Category name"}
          />

          {/* Name */}
          <div className="mb-4">
            <Label>Name</Label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Hobbies"
              maxLength={50}
              className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3"
            />
          </div>

          {/* Icon */}
          <div className="mb-4">
            <Label>Icon</Label>
            <div className="grid grid-cols-6 gap-2">
              {CATEGORY_ICONS.map((n) => {
                const Ico = resolveIcon(n);
                const selected = n === icon;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setIcon(n)}
                    aria-label={n}
                    aria-pressed={selected}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-lg border text-ink-2 transition-colors hover:text-ink",
                      selected
                        ? "border-success bg-success/10 text-ink"
                        : "border-line bg-app"
                    )}
                  >
                    <Ico size={18} aria-hidden />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Color */}
          <div>
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_COLORS.map((c) => {
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
                      selected
                        ? "border-ink scale-110"
                        : "border-transparent"
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
            {busy ? "Saving…" : isEdit ? "Save category" : "Create category"}
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

/** Live preview chip: the selected icon tinted on the selected color + the name. */
function PreviewChip({
  Icon,
  color,
  name,
}: {
  Icon: LucideIcon;
  color: string;
  name: string;
}) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span
        className="flex h-10 w-10 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${color}1A`, color }}
      >
        <Icon size={20} aria-hidden />
      </span>
      <span className="text-[14px] font-medium text-ink">{name}</span>
    </div>
  );
}
