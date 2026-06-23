import Link from "next/link";
import { Compass } from "lucide-react";

export const metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-app px-6 text-center">
      <div className="flex flex-col items-center rounded-xl border border-dashed border-line bg-surface px-6 py-16">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink-3">
          <Compass size={22} />
        </span>
        <p className="mt-4 text-[11px] font-medium uppercase tracking-wide text-ink-3">
          404
        </p>
        <h1 className="mt-1 text-[15px] font-medium text-ink">Page not found</h1>
        <p className="mt-1.5 max-w-xs text-[12px] text-ink-2">
          The page you’re looking for doesn’t exist or may have moved.
        </p>
        <Link
          href="/dashboard"
          className="mt-5 rounded-lg bg-success px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
