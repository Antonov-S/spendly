const SKELETON_ROWS = 8;

/** Loading placeholder for the feed while the fetcher resolves (via Suspense). */
export function FeedSkeleton() {
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <div className="border-b border-line px-4 py-2">
        <div className="h-2.5 w-24 animate-pulse rounded bg-surface-2" />
      </div>
      <div className="flex flex-col">
        {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-line px-4 py-3"
          >
            <div className="h-5.5 w-5.5 shrink-0 animate-pulse rounded-md bg-surface-2" />
            <div className="h-2.5 w-40 animate-pulse rounded bg-surface-2" />
            <div className="ml-auto h-2.5 w-16 animate-pulse rounded bg-surface-2" />
          </div>
        ))}
      </div>
    </section>
  );
}
