import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HOW_IT_WORKS_SECTION_ENABLED } from "@/lib/constants";
import { MARKETING_COPY } from "@/lib/marketing/copy";
import { DashboardPreview } from "@/components/marketing/dashboard-preview";
import { HeroAnimation } from "@/components/marketing/hero-animation";

const PREVIEW_ANCHOR = "hero-dashboard";

/**
 * Public landing hero. The headline, subheadline, and CTAs are the real
 * semantic content and the LCP — fully usable before (and without) the
 * decorative cube animation. The right column server-renders the static
 * phase-4 dashboard; <HeroAnimation> layers the chaos→clarity motion on top
 * after hydration, on the animated render path only.
 */
export function Hero() {
  // The features section isn't built yet, so the secondary CTA points at the
  // live preview (a real, working destination) rather than a dead anchor.
  const secondaryHref = HOW_IT_WORKS_SECTION_ENABLED
    ? "#how-it-works"
    : `#${PREVIEW_ANCHOR}`;

  return (
    <section className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 items-center gap-10 px-6 py-12 md:min-h-[90vh] md:grid-cols-2 md:gap-8 md:py-0">
      {/* Copy + CTAs — the value proposition, independent of the animation. */}
      <div className="max-w-xl">
        <span className="inline-flex items-center rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-medium text-ink-2">
          {MARKETING_COPY.eyebrow}
        </span>
        <h1 className="mt-5 text-[34px] font-semibold leading-[1.1] tracking-tight text-ink sm:text-[44px]">
          {MARKETING_COPY.headline}
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-2 sm:text-[16px]">
          {MARKETING_COPY.subheadline}
        </p>

        <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <Link
            href="/register"
            className="flex h-11 items-center justify-center gap-1.5 rounded-lg bg-success px-6 text-[14px] font-semibold text-white ring-1 ring-inset ring-white/15 transition-colors hover:bg-success/90"
          >
            {MARKETING_COPY.primaryCta}
            <ArrowRight size={16} strokeWidth={2.5} />
          </Link>
          <Link
            href={secondaryHref}
            className="flex h-11 items-center justify-center rounded-lg border border-line bg-surface px-6 text-[14px] font-medium text-ink transition-colors hover:bg-surface-2"
          >
            {MARKETING_COPY.secondaryCta}
          </Link>
        </div>

        <p className="mt-5 text-[12px] text-ink-3">{MARKETING_COPY.reassurance}</p>
      </div>

      {/* Stage: static dashboard reveal (phase 4) + cube animation overlay. */}
      <div id={PREVIEW_ANCHOR} className="relative scroll-mt-20">
        <DashboardPreview />
        <HeroAnimation />
      </div>
    </section>
  );
}
