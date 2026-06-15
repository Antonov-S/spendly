import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CTA_BANNER_COPY } from "@/lib/marketing/copy";

/** Closing conversion strip — a single primary action into registration. */
export function CtaBanner() {
  return (
    <section aria-labelledby="cta-heading" className="px-6 py-16 sm:py-20">
      <div className="mx-auto flex max-w-4xl flex-col items-center rounded-2xl border border-line bg-surface px-6 py-12 text-center">
        <h2
          id="cta-heading"
          className="text-[24px] font-semibold tracking-tight text-ink sm:text-[30px]"
        >
          {CTA_BANNER_COPY.headline}
        </h2>
        <Link
          href="/register"
          className="mt-6 inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-success px-6 text-[14px] font-semibold text-white ring-1 ring-inset ring-white/15 transition-colors hover:bg-success/90"
        >
          {CTA_BANNER_COPY.primaryCta}
          <ArrowRight size={16} strokeWidth={2.5} />
        </Link>
        <p className="mt-4 text-[12px] text-ink-3">
          {CTA_BANNER_COPY.reassurance}
        </p>
      </div>
    </section>
  );
}
