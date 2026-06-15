/**
 * Marketing copy for the public homepage hero. Centralized so the headline /
 * subheadline stay in sync between the rendered hero and the page's SEO
 * metadata (no duplicated magic strings).
 */
// Headline is split so the hero can accent the pivot word ("Clarity"); the full
// `headline` string is composed from the parts (no drift) and stays the single
// source for the <title> and SEO metadata.
const HEADLINE_LEAD = "Turn Financial Chaos Into";
const HEADLINE_ACCENT = "Clarity";

export const MARKETING_COPY = {
  eyebrow: "Conscious money tracking",
  headlineLead: HEADLINE_LEAD,
  headlineAccent: HEADLINE_ACCENT,
  headline: `${HEADLINE_LEAD} ${HEADLINE_ACCENT}`,
  subheadline:
    "Track spending consciously, set honest budgets, and reach your goals — no bank syncing, no autopilot.",
  primaryCta: "Get Started Free",
  secondaryCta: "See how it works",
  reassurance: "Free to start. No credit card required.",
} as const;

/** In-page anchor links shown in the primary nav (desktop + mobile menu). */
export const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
] as const;

/** Closing conversion strip below pricing. */
export const CTA_BANNER_COPY = {
  headline: "Start tracking with intention today",
  primaryCta: "Get Started Free",
  reassurance: "Free to start. No credit card required.",
} as const;

/**
 * Footer content. Link columns only reference pages that exist — no Legal /
 * Changelog dead links (principle #6). The copyright year is computed at render
 * in the footer component, not stored here.
 */
export const FOOTER_COPY = {
  tagline:
    "Conscious money tracking — fast manual entry, clear budgets, honest goals.",
  rightsReserved: "All rights reserved.",
  columns: [
    {
      title: "Product",
      links: [
        { label: "Features", href: "#features" },
        { label: "Pricing", href: "#pricing" },
      ],
    },
    {
      title: "Account",
      links: [
        { label: "Sign in", href: "/sign-in" },
        { label: "Create account", href: "/register" },
      ],
    },
  ],
} as const;
