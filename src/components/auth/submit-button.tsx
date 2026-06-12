"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SubmitButtonProps {
  children: React.ReactNode;
  /** Force the pending state when the parent drives submission itself. */
  pending?: boolean;
  className?: string;
}

/**
 * Primary form submit button. Reflects the enclosing form's pending state
 * (via `useFormStatus`) unless the parent passes `pending` explicitly.
 */
export function SubmitButton({
  children,
  pending: pendingProp,
  className,
}: SubmitButtonProps) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;

  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "flex h-9 w-full items-center justify-center gap-2 rounded-md bg-success text-[13px] font-medium text-white transition-colors hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
    >
      {pending && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}
