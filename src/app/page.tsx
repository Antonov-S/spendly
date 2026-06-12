import Link from "next/link";
import { Logo } from "@/components/dashboard/logo";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-app px-6 text-center">
      <Logo />
      <h1 className="mt-8 max-w-md text-[26px] font-medium text-ink">
        Track your money with intention.
      </h1>
      <p className="mt-3 max-w-sm text-[13px] text-ink-2">
        Fast manual entry, clear budgets, honest goals.
      </p>

      <div className="mt-8 flex items-center gap-3">
        <Link
          href="/register"
          className="flex h-9 items-center rounded-md bg-success px-5 text-[13px] font-medium text-white transition-colors hover:bg-success/90"
        >
          Get started
        </Link>
        <Link
          href="/sign-in"
          className="flex h-9 items-center rounded-md border border-line bg-surface px-5 text-[13px] font-medium text-ink transition-colors hover:bg-surface-2"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}
