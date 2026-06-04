import { cn } from "@/lib/utils";
import type { CategoryRef } from "@/types/dashboard";

/** Tinted rounded square holding a category's icon in its accent color. */
export function CategoryIcon({
  category,
  size = "md",
}: {
  category: CategoryRef;
  size?: "sm" | "md";
}) {
  const Icon = category.icon;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md",
        size === "sm" ? "h-[18px] w-[18px]" : "h-[22px] w-[22px]"
      )}
      // Dynamic per-category color from data — inline style is required here.
      style={{ backgroundColor: `${category.color}22` }}
    >
      <Icon
        size={size === "sm" ? 11 : 13}
        style={{ color: category.color }}
        strokeWidth={2}
      />
    </span>
  );
}
