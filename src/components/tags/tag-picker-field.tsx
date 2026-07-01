"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { TagChip } from "@/components/tags/tag-chip";
import { TagFormDrawer } from "@/components/tags/tag-form-drawer";
import { TAG_MAX_PER_TRANSACTION } from "@/lib/system-constants";
import { cn } from "@/lib/utils";
import type { TagOption } from "@/types/tags";

interface TagPickerFieldProps {
  tags: TagOption[];
  /** Currently-selected tag ids. */
  value: string[];
  onChange: (ids: string[]) => void;
}

/**
 * Multi-select tag picker for the transaction drawer (income/expense only).
 * Search-first: the "Add tag" control is a text-filtered combobox from day one so
 * it scales to large tag sets. Selected tags render as removable chips. An inline
 * "+ New tag" affordance creates a tag and immediately selects it from the row
 * `createTag` returns (mirrors `<CategoryPickerField>`). Enforces
 * `TAG_MAX_PER_TRANSACTION` client-side; the server enforces it too.
 */
export function TagPickerField({ tags, value, onChange }: TagPickerFieldProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  /** Tags created inline this session (merged with the prop list, deduped). */
  const [appended, setAppended] = useState<TagOption[]>([]);

  const seen = new Set(tags.map((t) => t.id));
  const allTags = useMemo(
    () =>
      [...tags, ...appended.filter((t) => !seen.has(t.id))].sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `seen` derives from `tags`
    [tags, appended]
  );
  const byId = new Map(allTags.map((t) => [t.id, t]));

  const selectedTags = value
    .map((id) => byId.get(id))
    .filter((t): t is TagOption => t !== undefined);

  const atCap = value.length >= TAG_MAX_PER_TRANSACTION;

  const available = allTags.filter(
    (t) =>
      !value.includes(t.id) &&
      t.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  function add(id: string) {
    if (value.includes(id) || atCap) return;
    onChange([...value, id]);
    setQuery("");
  }

  function remove(id: string) {
    onChange(value.filter((v) => v !== id));
  }

  function handleCreated(tag: TagOption) {
    setAppended((prev) =>
      prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]
    );
    if (value.length < TAG_MAX_PER_TRANSACTION) {
      onChange([...value, tag.id]);
    }
    setMenuOpen(false);
    setQuery("");
  }

  return (
    <>
      {/* Selected chips */}
      {selectedTags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selectedTags.map((tag) => (
            <TagChip key={tag.id} tag={tag} onRemove={() => remove(tag.id)} />
          ))}
        </div>
      )}

      {/* Search-first add control */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setMenuOpen(true)}
          disabled={atCap}
          placeholder={atCap ? `Up to ${TAG_MAX_PER_TRANSACTION} tags` : "Add tag…"}
          className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 disabled:opacity-60"
        />

        {menuOpen && !atCap && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setMenuOpen(false)}
            />
            <ul className="absolute left-0 top-full z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
              {available.length === 0 ? (
                <li className="px-3 py-2 text-[12px] text-ink-3">
                  {query.trim() ? "No matching tags" : "No tags yet"}
                </li>
              ) : (
                available.map((tag) => (
                  <li key={tag.id}>
                    <button
                      type="button"
                      onClick={() => add(tag.id)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink transition-colors hover:bg-surface-2"
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: tag.color ?? "#888780" }}
                      />
                      <span className="truncate">{tag.name}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        disabled={atCap}
        className={cn(
          "mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-success transition-opacity hover:opacity-80 disabled:opacity-50",
          atCap && "cursor-not-allowed"
        )}
      >
        <Plus size={13} /> New tag
      </button>

      <TagFormDrawer
        open={drawerOpen}
        editId={null}
        onClose={() => setDrawerOpen(false)}
        onCreated={handleCreated}
      />
    </>
  );
}
