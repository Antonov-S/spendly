"use client";

import { useState } from "react";
import { CategoryFormDrawer } from "@/components/categories/category-form-drawer";
import type { CategoryOption } from "@/types/transactions";

interface CategoryPickerFieldProps {
  categories: CategoryOption[];
  /** Selected category id; "" means the empty option (when `emptyLabel` is set). */
  value: string;
  onChange: (id: string) => void;
  /**
   * Label for the leading empty option (e.g. "Uncategorized" / "No category").
   * Omit to require a selection (budgets).
   */
  emptyLabel?: string;
  /** When true the select is read-only and the "+ New category" affordance hides. */
  disabled?: boolean;
}

/**
 * The category `<select>` plus an inline "+ New category" affordance, shared by
 * the transaction / budget / recurring drawers. On create the new category is
 * appended locally and auto-selected from the row `createCategory` returns — no
 * optimistic guess, no dependency on the subsequent `router.refresh()` to make
 * the option selectable.
 */
export function CategoryPickerField({
  categories,
  value,
  onChange,
  emptyLabel,
  disabled = false,
}: CategoryPickerFieldProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** Categories created inline this session (merged with the prop list, deduped). */
  const [appended, setAppended] = useState<CategoryOption[]>([]);

  const seen = new Set(categories.map((c) => c.id));
  const options = [...categories, ...appended.filter((c) => !seen.has(c.id))];

  function handleCreated(category: CategoryOption) {
    setAppended((prev) =>
      prev.some((c) => c.id === category.id) ? prev : [...prev, category]
    );
    onChange(category.id);
  }

  return (
    <>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none disabled:opacity-60"
      >
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {!disabled && (
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="mt-1.5 text-[12px] font-medium text-success transition-opacity hover:opacity-80"
        >
          + New category
        </button>
      )}

      <CategoryFormDrawer
        open={drawerOpen}
        editId={null}
        onClose={() => setDrawerOpen(false)}
        onCreated={handleCreated}
      />
    </>
  );
}
