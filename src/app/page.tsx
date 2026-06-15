import type { Metadata } from "next";
import { redirectIfAuthenticated } from "@/lib/auth/guards";
import { Logo } from "@/components/dashboard/logo";
import { Hero } from "@/components/marketing/hero";
import { MARKETING_COPY } from "@/lib/marketing/copy";
import Link from "next/link";

const pageTitle = `Spendly — ${MARKETING_COPY.headline}`;

export const metadata: Metadata = {
  title: pageTitle,
  description: MARKETING_COPY.subheadline,
  openGraph: {
    title: pageTitle,
    description: MARKETING_COPY.subheadline,
    siteName: "Spendly",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: pageTitle,
    description: MARKETING_COPY.subheadline,
  },
};

export default async function Home() {
  // Signed-in visitors skip the marketing page and land on their dashboard.
  await redirectIfAuthenticated();

  return (
    <main className="flex min-h-full flex-1 flex-col">
      {/* Slim marketing header — logo + a path to sign in. */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <Link
          href="/sign-in"
          className="text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
        >
          Sign in
        </Link>
      </header>

      <Hero />
    </main>
  );
}
