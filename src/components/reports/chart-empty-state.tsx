/**
 * Active-guidance empty state inside a `ChartCard`. Plain text (already
 * accessible) plus an optional CTA — the trend/category cards pass an "Add
 * transaction" action that opens the global drawer; the balance "no accounts in
 * view" case passes no action.
 */
export function ChartEmptyState({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
      <p className="max-w-60 text-[12px] text-ink-2">{message}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
