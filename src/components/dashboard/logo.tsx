import { Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

interface LogoProps {
  /** Render the "Spendly" wordmark next to the mark. */
  showWordmark?: boolean;
  /** Extra classes for the wordmark (e.g. responsive hiding). */
  wordmarkClassName?: string;
  className?: string;
}

/**
 * Spendly brand mark: a wallet glyph in a rounded green token — a direct,
 * personal-finance read (spending money), not market/trading.
 */
export function Logo({
  showWordmark = true,
  wordmarkClassName,
  className,
}: LogoProps) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-success">
        <Wallet size={16} className="text-white" strokeWidth={2.2} />
      </span>
      {showWordmark && (
        <span
          className={cn(
            "text-[15px] font-medium tracking-tight text-ink",
            wordmarkClassName
          )}
        >
          Spendly
        </span>
      )}
    </span>
  );
}
