/** Plan status pill — green for Pro, neutral for Free. Shared by /profile and /settings. */
export function PlanBadge({ isPro }: { isPro: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        isPro
          ? "border-success/30 bg-success/10 text-success"
          : "border-line text-ink-2"
      }`}
    >
      {isPro ? "Pro" : "Free"}
    </span>
  );
}
