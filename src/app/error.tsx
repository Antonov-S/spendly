"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/**
 * App-level error boundary. Next.js requires this to be a client component.
 * Catches runtime errors in route segments so users see a styled recovery
 * card instead of an unstyled framework error page.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error for observability (§12.1) rather than swallowing it.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-app px-6 text-center">
      <div
        role="alert"
        className="flex flex-col items-center rounded-xl border border-dashed border-line bg-surface px-6 py-16"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink-3">
          <AlertTriangle size={22} />
        </span>
        <h1 className="mt-4 text-[15px] font-medium text-ink">
          Something went wrong
        </h1>
        <p className="mt-1.5 max-w-xs text-[12px] text-ink-2">
          An unexpected error occurred. You can try again, or head back to your
          dashboard.
        </p>
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-success px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="rounded-lg border border-line px-4 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
