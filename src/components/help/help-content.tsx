import { HelpCircle, List } from "lucide-react";
import { HELP_SECTIONS } from "@/lib/help/content";
import { HELP_TOC_MIN_SECTIONS } from "@/lib/system-constants";
import { HelpSection } from "@/components/help/help-section";

/**
 * The full Help / FAQ body: a page header, an optional in-page table of
 * contents (rendered only once the page is long enough to need it — §7), then
 * one card per section. All static and server-rendered; anchors are plain
 * links paired with the `scroll-smooth` already on <html>.
 */
export function HelpContent() {
  const showToc = HELP_SECTIONS.length >= HELP_TOC_MIN_SECTIONS;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="mb-6 flex items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: "#1D9E7522" }}
          aria-hidden="true"
        >
          <HelpCircle size={22} className="text-success" strokeWidth={2} />
        </span>
        <div>
          <h1 className="text-[18px] font-medium leading-tight text-ink">Help</h1>
          <p className="mt-0.5 text-[12px] text-ink-2">
            How Spendly works, and answers to the questions that come up most.
          </p>
        </div>
      </header>

      {showToc && (
        <nav
          aria-label="On this page"
          className="mb-6 rounded-xl border border-success/30 bg-success/5 p-4 ring-1 ring-success/10"
        >
          <div className="mb-3 flex items-center gap-2">
            <List size={14} className="text-success" strokeWidth={2.5} />
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink">
              On this page
            </p>
          </div>
          <ul className="flex flex-wrap gap-2">
            {HELP_SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="inline-flex rounded-md border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:border-success/40 hover:bg-success/10 hover:text-ink"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="space-y-4">
        {HELP_SECTIONS.map((section) => (
          <HelpSection key={section.id} section={section} />
        ))}
      </div>
    </div>
  );
}
