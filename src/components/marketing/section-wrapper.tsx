import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionWrapperProps {
  /** Anchor id for nav links (e.g. "features", "pricing"). */
  id?: string;
  /** Heading id this section is labelled by, for `aria-labelledby`. */
  labelledBy?: string;
  /**
   * Raise the section onto a subtly lighter, full-bleed background band so
   * adjacent sections read as distinct shelves instead of one flat scroll.
   */
  raised?: boolean;
  /** Applied to the inner max-width content container. */
  className?: string;
  children: ReactNode;
}

/**
 * Shared marketing-section frame: a full-bleed band (optionally raised one tone)
 * with a centered max-width content container, consistent padding, and a
 * `scroll-mt` offset so anchored sections clear the fixed nav when jumped to.
 */
export function SectionWrapper({
  id,
  labelledBy,
  raised,
  className,
  children,
}: SectionWrapperProps) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn(
        "scroll-mt-20 px-6 py-16 sm:py-20",
        raised && "bg-sidebar"
      )}
    >
      <div className={cn("mx-auto w-full max-w-6xl", className)}>{children}</div>
    </section>
  );
}
