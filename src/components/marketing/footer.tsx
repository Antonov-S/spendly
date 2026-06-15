import Link from "next/link";
import { Logo } from "@/components/dashboard/logo";
import { FOOTER_COPY } from "@/lib/marketing/copy";

/** Site footer. Link columns reference only real pages; year computed at render. */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-8 px-6 py-12 lg:grid-cols-4">
        {/* Brand + tagline */}
        <div className="col-span-2">
          <Logo />
          <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-ink-2">
            {FOOTER_COPY.tagline}
          </p>
        </div>

        {/* Link columns */}
        {FOOTER_COPY.columns.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2 className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
              {column.title}
            </h2>
            <ul className="mt-3 flex flex-col gap-2">
              {column.links.map((link) => (
                <li key={link.label}>
                  {link.href.startsWith("#") ? (
                    <a
                      href={link.href}
                      className="text-[13px] text-ink-2 transition-colors hover:text-ink"
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      href={link.href}
                      className="text-[13px] text-ink-2 transition-colors hover:text-ink"
                    >
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      {/* Copyright */}
      <div className="border-t border-line">
        <div className="mx-auto w-full max-w-6xl px-6 py-5">
          <p className="text-[12px] text-ink-3">
            © {year} Spendly. {FOOTER_COPY.rightsReserved}
          </p>
        </div>
      </div>
    </footer>
  );
}
