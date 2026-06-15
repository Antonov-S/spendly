import { SectionWrapper } from "@/components/marketing/section-wrapper";
import { SectionHeading } from "@/components/marketing/section-heading";
import { FEATURES, FEATURES_SECTION } from "@/lib/marketing/features";

/** Six-card feature grid. Each card is a real, shipped MVP capability. */
export function Features() {
  return (
    <SectionWrapper id="features" labelledBy="features-heading" raised>
      <SectionHeading
        eyebrow={FEATURES_SECTION.eyebrow}
        title={FEATURES_SECTION.title}
        subtitle={FEATURES_SECTION.subtitle}
        headingId="features-heading"
      />

      <ul className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => {
          const Icon = feature.icon;
          return (
            <li
              key={feature.title}
              className="rounded-xl border border-line bg-surface p-5 transition-colors hover:bg-surface-2"
            >
              <span
                className="flex h-10 w-10 items-center justify-center rounded-lg"
                // Dynamic per-feature accent from data — inline style required.
                style={{ backgroundColor: `${feature.color}22` }}
              >
                <Icon size={20} style={{ color: feature.color }} strokeWidth={2} />
              </span>
              <h3 className="mt-4 text-[15px] font-semibold text-ink">
                {feature.title}
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
                {feature.description}
              </p>
            </li>
          );
        })}
      </ul>
    </SectionWrapper>
  );
}
