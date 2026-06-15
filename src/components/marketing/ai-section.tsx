import { Check, Sparkles } from "lucide-react";
import { SectionWrapper } from "@/components/marketing/section-wrapper";
import { AI_SECTION, AI_CAPABILITIES, AI_SAMPLE_TAGS } from "@/lib/marketing/ai";

/**
 * Marketing surface for the planned Pro AI-categorization feature. The right
 * column is a purely decorative mock (no live AI call) and is hidden from the
 * accessibility tree; the left column carries the real copy.
 */
export function AiSection() {
  return (
    <SectionWrapper id="ai" labelledBy="ai-heading">
      <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
        {/* Left: copy + capability checklist */}
        <div>
          <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-[11px] font-medium text-success">
            <Sparkles size={12} strokeWidth={2.2} />
            {AI_SECTION.badge}
          </span>
          <h2
            id="ai-heading"
            className="mt-4 text-[26px] font-semibold tracking-tight text-ink sm:text-[32px]"
          >
            {AI_SECTION.title}
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
            {AI_SECTION.subtitle}
          </p>

          <ul className="mt-6 flex flex-col gap-3">
            {AI_CAPABILITIES.map((capability) => (
              <li key={capability} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/15">
                  <Check size={13} className="text-success" strokeWidth={2.5} />
                </span>
                <span className="text-[14px] leading-relaxed text-ink">
                  {capability}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Right: decorative auto-tagging mock (non-semantic). */}
        <div
          aria-hidden
          className="overflow-hidden rounded-xl border border-line bg-app shadow-2xl shadow-black/40"
        >
          {/* Window chrome */}
          <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2.5">
            <span className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
            </span>
            <span className="ml-2 flex-1 truncate rounded-md bg-app px-3 py-1 text-center text-[10px] text-ink-3">
              {AI_SECTION.mockTitle}
            </span>
          </div>

          {/* Auto-tagged transaction rows */}
          <div className="flex flex-col divide-y divide-line">
            {AI_SAMPLE_TAGS.map((tag) => (
              <div key={tag.merchant} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">
                    {tag.merchant}
                  </p>
                  <p className="text-[11px] text-ink-3">{tag.amount}</p>
                </div>
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium"
                  style={{ backgroundColor: `${tag.color}1f`, color: tag.color }}
                >
                  <Sparkles size={11} strokeWidth={2.2} />
                  {tag.category}
                </span>
              </div>
            ))}
          </div>

          {/* Confirm-before-apply caption */}
          <div className="border-t border-line px-4 py-2.5 text-center text-[10px] text-ink-3">
            {AI_SECTION.mockFooter}
          </div>
        </div>
      </div>
    </SectionWrapper>
  );
}
