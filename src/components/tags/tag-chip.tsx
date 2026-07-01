import { cn } from "@/lib/utils";
import type { FeedTag } from "@/types/transactions";
import type { TagOption } from "@/types/tags";

/** The minimum a chip needs to render: a name + an optional color. */
type ChipTag = Pick<FeedTag | TagOption, "name" | "color">;

/**
 * A small presentational tag chip — a colored dot + the name — shared by feed
 * rows, the picker's selected list, and the manage list. When `color` is null it
 * renders in a neutral style. Optionally shows a remove (×) affordance for the
 * picker's editable chips.
 */
export function TagChip({
  tag,
  onRemove,
  className,
}: {
  tag: ChipTag;
  /** When provided, renders a × button that calls this on click. */
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface-2 py-0.5 pl-2 pr-2 text-[11px] text-ink-2",
        onRemove && "pr-1",
        className
      )}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: tag.color ?? "var(--color-ink-3, #888780)" }}
        aria-hidden
      />
      <span className="truncate">{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${tag.name}`}
          className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-line hover:text-ink"
        >
          <span aria-hidden className="text-[13px] leading-none">
            ×
          </span>
        </button>
      )}
    </span>
  );
}

/**
 * Render a bounded row of chips with a `+N` overflow pill once the count exceeds
 * `visibleMax`. Used by the feed row (§10.3). Tags are assumed pre-sorted by name.
 */
export function TagChipRow({
  tags,
  visibleMax,
  className,
}: {
  tags: FeedTag[];
  visibleMax: number;
  className?: string;
}) {
  if (tags.length === 0) return null;
  const visible = tags.slice(0, visibleMax);
  const overflow = tags.length - visible.length;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {visible.map((tag) => (
        <TagChip key={tag.id} tag={tag} />
      ))}
      {overflow > 0 && (
        <span className="inline-flex items-center rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] text-ink-3">
          +{overflow}
        </span>
      )}
    </div>
  );
}
