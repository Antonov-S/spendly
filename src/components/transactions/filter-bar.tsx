"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, ChevronDown, Check } from "lucide-react";
import { TRANSACTION_TYPE_FILTERS, SEARCH_DEBOUNCE_MS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { CategoryOption } from "@/types/transactions";

interface FilterBarProps {
  categories: CategoryOption[];
}

/**
 * Filter controls for the transactions feed. All state is mirrored to the URL
 * (type / from / to / category / q) so it's shareable and back/forward-safe.
 * The account scope lives in the global topbar selector, not here.
 */
export function FilterBar({ categories }: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentType = searchParams.get("type");
  const selectedCategoryIds =
    searchParams.get("category")?.split(",").filter(Boolean) ?? [];
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const q = searchParams.get("q") ?? "";

  // Category filtering is meaningless for transfers (they have no category).
  const categoryDisabled = currentType === "TRANSFER";

  function commit(params: URLSearchParams) {
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    commit(params);
  }

  function toggleCategory(id: string) {
    const next = new Set(selectedCategoryIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setParam("category", [...next].join(",") || null);
  }

  // Debounced search: keep the input snappy, update the URL after a pause.
  const [searchValue, setSearchValue] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setSearchValue(q);
  }, [q]);

  useEffect(() => () => clearTimeout(timer.current), []);

  function onSearchChange(value: string) {
    setSearchValue(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setParam("q", value.trim() || null),
      SEARCH_DEBOUNCE_MS
    );
  }

  const [categoryOpen, setCategoryOpen] = useState(false);
  const selectedCount = selectedCategoryIds.length;

  return (
    <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
      {/* Type pills — full width on mobile, each pill sharing the row evenly */}
      <div className="flex w-full items-center gap-0.5 rounded-md border border-line bg-surface p-0.5 md:w-auto">
        {TRANSACTION_TYPE_FILTERS.map((pill) => {
          const active = (pill.value ?? null) === (currentType ?? null);
          return (
            <button
              key={pill.label}
              type="button"
              onClick={() => setParam("type", pill.value)}
              className={cn(
                "flex-1 rounded px-2.5 py-1 text-[11px] transition-colors md:flex-none",
                active
                  ? "bg-surface-2 text-ink"
                  : "text-ink-3 hover:text-ink-2"
              )}
            >
              {pill.label}
            </button>
          );
        })}
      </div>

      {/* Date range — full width on mobile, inputs split across the row */}
      <div className="flex w-full items-center gap-2 md:w-auto">
        <input
          type="date"
          aria-label="From date"
          value={from}
          max={to || undefined}
          onChange={(e) => setParam("from", e.target.value || null)}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-[11px] text-ink-2 scheme-dark md:flex-none"
        />
        <span className="text-[11px] text-ink-3">–</span>
        <input
          type="date"
          aria-label="To date"
          value={to}
          min={from || undefined}
          onChange={(e) => setParam("to", e.target.value || null)}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-[11px] text-ink-2 scheme-dark md:flex-none"
        />
      </div>

      {/* Category + search share one row on mobile; `md:contents` dissolves
          the wrapper on desktop so both rejoin the main flex row. */}
      <div className="flex w-full gap-2 md:contents">
      {/* Category multi-select */}
      <div className="relative">
        <button
          type="button"
          disabled={categoryDisabled}
          onClick={() => setCategoryOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={categoryOpen}
          className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11px] text-ink-2 transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          {selectedCount > 0 ? `Categories · ${selectedCount}` : "Categories"}
          <ChevronDown size={13} className="text-ink-3" />
        </button>

        {categoryOpen && !categoryDisabled && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setCategoryOpen(false)}
            />
            <ul
              role="listbox"
              aria-multiselectable
              className="absolute left-0 top-full z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-xl"
            >
              {categories.map((category) => {
                const checked = selectedCategoryIds.includes(category.id);
                return (
                  <li key={category.id} role="option" aria-selected={checked}>
                    <button
                      type="button"
                      onClick={() => toggleCategory(category.id)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-ink-2 transition-colors hover:bg-surface-2"
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: category.color }}
                      />
                      <span className="flex-1 truncate">{category.name}</span>
                      {checked && (
                        <Check size={14} className="shrink-0 text-success" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {/* Search — fills the rest of the mobile row, fixed width / right-aligned on desktop */}
      <div className="relative flex-1 md:ml-auto md:flex-none">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
        />
        <input
          type="search"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search…"
          aria-label="Search transactions"
          className="w-full rounded-md border border-line bg-surface py-1.5 pl-8 pr-2.5 text-[12px] text-ink placeholder:text-ink-3 md:w-44"
        />
      </div>
      </div>
    </div>
  );
}
