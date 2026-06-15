import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** Id applied to the <h2> so the section can reference it via aria-labelledby. */
  headingId?: string;
  className?: string;
}

/** Centered eyebrow + title + optional subtitle, reused across marketing sections. */
export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  headingId,
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn("mx-auto max-w-2xl text-center", className)}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-success">
        {eyebrow}
      </span>
      <h2
        id={headingId}
        className="mt-2 text-[26px] font-semibold tracking-tight text-ink sm:text-[32px]"
      >
        {title}
      </h2>
      {subtitle && (
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{subtitle}</p>
      )}
    </div>
  );
}
