import type { HelpSection as HelpSectionData } from "@/lib/help/content";

/**
 * One Help FAQ card: a labelled section with a tinted icon square, an optional
 * intro, and a list of term/detail explainer lines. Server component — no
 * client JS. The `id` makes the card an anchor target for the table of contents
 * and deep links.
 */
export function HelpSection({ section }: { section: HelpSectionData }) {
  const headingId = `${section.id}-heading`;
  const Icon = section.icon;

  return (
    <section
      id={section.id}
      aria-labelledby={headingId}
      className="scroll-mt-20 rounded-xl border border-line bg-surface p-6"
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          // Decorative per-section accent from data — inline tint is required.
          style={{ backgroundColor: `${section.color}22` }}
          aria-hidden="true"
        >
          <Icon size={18} style={{ color: section.color }} strokeWidth={2} />
        </span>
        <h2 id={headingId} className="text-[14px] font-medium text-ink">
          {section.title}
        </h2>
      </div>

      {section.intro && (
        <p className="mt-3 text-[12px] text-ink-2">{section.intro}</p>
      )}

      <ul className="mt-4 space-y-4">
        {section.items.map((item, i) => (
          <li key={i}>
            {item.term && (
              <p className="text-[12px] font-medium text-ink">{item.term}</p>
            )}
            <p className="text-[12px] leading-relaxed text-ink-2">
              {item.detail}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
