import type { Metadata } from "next";
import { redirectIfAuthenticated } from "@/lib/auth/guards";
import { Nav } from "@/components/marketing/nav";
import { Hero } from "@/components/marketing/hero";
import { Features } from "@/components/marketing/features";
import { AiSection } from "@/components/marketing/ai-section";
import { Pricing } from "@/components/marketing/pricing";
import { CtaBanner } from "@/components/marketing/cta-banner";
import { Footer } from "@/components/marketing/footer";
import { MARKETING_COPY } from "@/lib/marketing/copy";

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
    <>
      <Nav />
      {/* pt clears the fixed nav so the hero never tucks under it. */}
      <main className="flex min-h-full flex-1 flex-col pt-14 md:pt-16">
        <Hero />
        <Features />
        <AiSection />
        <Pricing />
        <CtaBanner />
      </main>
      <Footer />
    </>
  );
}
